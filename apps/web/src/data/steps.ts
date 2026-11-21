import type { ClinicalRole, QueueItem, ServiceType, StepStatus, SyncOp, VisitStepView } from "@er/shared";
import type { StepField } from "../lib/stepFields";
import { db, getPackageMeta, mergeVisit, type LocalVisit, type OutboxEntry } from "./db";
import { enqueue } from "./patients";
import { requestSync } from "./sync";
import { normalizeFolio } from "../lib/folio";
import { request } from "../lib/http";

// Visit steps per specialist (SPEC 6.3.1). "Pacientes esperándome" reads only local data so it works
// without signal: package/pull visits, visits registered on this tablet and GET /api/queue when online.

type StepOp = Extract<SyncOp, { kind: "UPDATE_SERVICE_FIELDS" | "COMPLETE_STEP" }>;
type CompleteStepOp = Extract<SyncOp, { kind: "COMPLETE_STEP" }>;

export interface QueueEntry {
  visitId: string;
  folio: string;
  patientId: string;
  fullName: string;
  registeredAt: string;
  steps: VisitStepView[];
}

const stepKey = (folio: string, role: ClinicalRole) => `${normalizeFolio(folio)}|${role}`;

/** Steps this tablet already completed (still in the outbox), keyed by folio + role. */
export function completedStepKeys(outbox: Pick<OutboxEntry, "op">[]): Set<string> {
  const keys = new Set<string>();
  for (const { op } of outbox) if (op.kind === "COMPLETE_STEP") keys.add(stepKey(op.folio, op.role));
  return keys;
}

/**
 * Visits with `role`'s step PENDING, oldest registration first. A step completed on this tablet but not
 * yet confirmed by the server (op still in the outbox) is treated as done.
 */
export function filterQueue(
  visits: LocalVisit[],
  names: Map<string, string>,
  role: ClinicalRole,
  completed: Set<string>,
): QueueEntry[] {
  const entries: QueueEntry[] = [];
  for (const v of visits) {
    if (!v.folio || !v.steps) continue;
    const mine = v.steps.find((s) => s.role === role);
    if (!mine || mine.status !== "PENDING" || completed.has(stepKey(v.folio, role))) continue;
    entries.push({
      visitId: v.id,
      folio: v.folio,
      patientId: v.patientId,
      fullName: names.get(v.patientId) ?? v.patientName ?? "",
      registeredAt: v.registeredAt ?? `${v.date}T00:00:00.000Z`,
      steps: v.steps,
    });
  }
  return entries.sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.folio.localeCompare(b.folio));
}

export async function loadQueue(role: ClinicalRole): Promise<QueueEntry[]> {
  const visits = await db.visits.toArray();
  const ids = [...new Set(visits.map((v) => v.patientId))];
  const patients = await db.patients.bulkGet(ids);
  const names = new Map(patients.filter((p) => p !== undefined).map((p) => [p.id, p.fullName]));
  const open = await db.outbox.where("status").anyOf("pending", "failed").toArray();
  return filterQueue(visits, names, role, completedStepKeys(open));
}

/** With signal: stores today's queue from the server so it keeps working when the signal drops. */
export async function refreshQueueFromServer(): Promise<void> {
  if (!navigator.onLine) return;
  const data = await request<QueueItem[] | { items: QueueItem[] }>("/api/queue");
  const items = Array.isArray(data) ? data : data.items;
  const pkg = await getPackageMeta();
  await db.transaction("rw", db.visits, async () => {
    for (const item of items) {
      const existing = await db.visits.get(item.visitId);
      const incoming: LocalVisit = {
        id: item.visitId,
        patientId: item.patientId,
        campaignId: existing?.campaignId ?? pkg?.campaignId ?? "",
        campaignName: existing?.campaignName ?? pkg?.campaign.name ?? "",
        date: existing?.date ?? item.registeredAt.slice(0, 10),
        folio: item.folio,
        serviceTypes: existing?.serviceTypes ?? [],
        steps: item.steps,
        registeredAt: item.registeredAt,
        patientName: item.fullName,
        patientBirthDate: item.birthDate,
      };
      await db.visits.put(mergeVisit(incoming, existing));
    }
  });
}

export async function findVisitByFolio(folio: string): Promise<LocalVisit | null> {
  return (await db.visits.where("folio").equals(normalizeFolio(folio)).first()) ?? null;
}

/** Name of the visit's patient known on this device, if any. */
export async function knownPatientName(visit: LocalVisit | null): Promise<string | null> {
  if (!visit) return null;
  return (await db.patients.get(visit.patientId))?.fullName ?? visit.patientName ?? null;
}

/** Step state shown on the record: local overlay of what this tablet already finished. */
export function applyLocalStep(steps: VisitStepView[], role: ClinicalRole, status: StepStatus, by: string): VisitStepView[] {
  const at = new Date().toISOString();
  const next = steps.some((s) => s.role === role)
    ? steps.map((s) => (s.role === role ? { ...s, status, completedBy: by, completedAt: at } : s))
    : [...steps, { role, status, completedBy: by, completedAt: at }];
  return next;
}

type OpIds = { opId: string; deviceId: string; at: string };

export interface StepOpIds {
  fields: Record<"BREAST_REVIEW" | "PAP", OpIds>;
  done: OpIds;
  skip: OpIds;
}

/**
 * Ops for "Guardar y terminar" / "Se retiró": one UPDATE_SERVICE_FIELDS per service with the typed
 * fields (BREAST_REVIEW for mamaria.json, PAP for citologia.json), then COMPLETE_STEP.
 */
export function buildStepOps(input: {
  kind: "DONE" | "SKIPPED";
  role: ClinicalRole;
  fields: Pick<StepField, "key" | "serviceType">[];
  values: Record<string, string>;
  base: { campaignId: string; folio: string; confirmedName: string };
  ids: StepOpIds;
  reason?: string;
}): StepOp[] {
  const { kind, role, base, ids } = input;
  if (kind === "SKIPPED") {
    return [{ ...ids.skip, ...base, kind: "COMPLETE_STEP", role, status: "SKIPPED", reason: (input.reason ?? "").trim() }];
  }
  const byService = new Map<ServiceType, Record<string, string>>();
  for (const f of input.fields) {
    const v = (input.values[f.key] ?? "").trim();
    if (!v) continue;
    byService.set(f.serviceType, { ...(byService.get(f.serviceType) ?? {}), [f.key]: v });
  }
  const ops: StepOp[] = [];
  for (const [serviceType, data] of byService) {
    const meta = serviceType === "PAP" ? ids.fields.PAP : ids.fields.BREAST_REVIEW;
    ops.push({ ...meta, ...base, kind: "UPDATE_SERVICE_FIELDS", serviceType, fields: data });
  }
  ops.push({ ...ids.done, ...base, kind: "COMPLETE_STEP", role, status: "DONE" });
  return ops;
}

/** Queues the step ops and marks the step on this tablet right away. */
export async function saveStep(ops: StepOp[], staffName: string): Promise<void> {
  const complete = ops.find((o): o is CompleteStepOp => o.kind === "COMPLETE_STEP");
  await db.transaction("rw", db.visits, db.outbox, async () => {
    for (const op of ops) await enqueue(op);
    if (!complete) return;
    const visit = await db.visits.where("folio").equals(normalizeFolio(complete.folio)).first();
    if (visit) {
      await db.visits.update(visit.id, {
        steps: applyLocalStep(visit.steps ?? [], complete.role, complete.status, staffName),
      });
    }
  });
  requestSync();
}
