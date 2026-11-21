import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  isClinicalRole,
  isValidFolio,
  nameSimilarity,
  SIMILAR_NAME_THRESHOLD,
  type MatchScore,
  type OpResult,
  type PatientFields,
  type StaffProfile,
  type SyncOp,
} from "@er/shared";
import { db } from "./db";
import { writeAudit } from "./audit";
import { valkey } from "./valkey";
import { scoreMainCandidates } from "./matchCandidates";
import { fieldsFor, templateFieldLabel, templateIdForService } from "./templates";

// Single write path (SPEC 8): every create/update of patients and visits goes through here,
// online or offline. Each op is applied once (Valkey fast path + AppliedOp table) under a
// per-patient lock, and a field changed on both sides becomes a SyncConflict (SPEC 6.5).

const OP_TTL_SECONDS = 14 * 24 * 60 * 60;
const LOCK_TTL_MS = 5000;
const LOCK_RETRIES = 20;
const LOCK_RETRY_DELAY_MS = 50;

type Tx = Prisma.TransactionClient;
type OpOf<K extends SyncOp["kind"]> = Extract<SyncOp, { kind: K }>;
type PatientField = keyof PatientFields;

/** Thrown inside the transaction to roll it back and answer REJECTED with a plain Spanish message. */
class OpRejected extends Error {}

/** The visit a station op points to (campaign + folio) has not reached the server yet. */
class OpWaiting extends Error {}

type StationOp = OpOf<"UPDATE_SERVICE_FIELDS"> | OpOf<"COMPLETE_STEP">;

function isStationOp(op: SyncOp): op is StationOp {
  return op.kind === "UPDATE_SERVICE_FIELDS" || op.kind === "COMPLETE_STEP";
}

// Shown on the tablet as-is: plain language, no system words (CLAUDE.md).
const WAITING_MESSAGE = "Esperando a que llegue la visita";

/** Spanish labels for conflict messages (shown to the person syncing). */
export const FIELD_LABELS: Record<PatientField, string> = {
  formId: "ID del formato",
  fullName: "nombre",
  givenNames: "nombre(s)",
  paternalSurname: "apellido paterno",
  maternalSurname: "apellido materno",
  birthDate: "fecha de nacimiento",
  birthState: "entidad de nacimiento",
  phone: "teléfono",
  mobile: "celular",
  residence: "residencia",
  localityId: "localidad",
  affiliation: "afiliación",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RELEASE_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/**
 * Per-patient lock in Valkey. If Valkey is unreachable we continue without it:
 * the transaction and the unique AppliedOp row still keep the write safe.
 */
export const LOCK_BUSY_MESSAGE = "Otra tableta está guardando a esta paciente; se reintenta solo.";

async function acquirePatientLock(patientId: string, opId: string) {
  const key = `lock:patient:${patientId}`;
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      const ok = await valkey.set(key, opId, "PX", LOCK_TTL_MS, "NX");
      if (ok === "OK") {
        return {
          acquired: true,
          release: async () => {
            await valkey.eval(RELEASE_LOCK_SCRIPT, 1, key, opId).catch(() => undefined);
          },
        };
      }
    } catch {
      return { acquired: true, release: async () => undefined };
    }
    await sleep(LOCK_RETRY_DELAY_MS);
  }
  return { acquired: false, release: async () => undefined };
}

/** Valkey fast path for idempotency. Returns false when the op id was already seen. */
async function reserveOpId(opId: string): Promise<boolean> {
  try {
    return (await valkey.set(`op:${opId}`, "1", "EX", OP_TTL_SECONDS, "NX")) === "OK";
  } catch {
    return true; // Valkey down: the AppliedOp table is the durable defense.
  }
}

async function forgetOpId(opId: string) {
  await valkey.del(`op:${opId}`).catch(() => undefined);
}

function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (!field) return true;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}

/**
 * Server-side role check per op kind (rule 7). Returns a Spanish message when the op is not
 * allowed for this staff member; nothing is reserved or written in that case.
 */
function authorizeOp(op: SyncOp, staff: StaffProfile): string | null {
  switch (op.kind) {
    case "CREATE_PATIENT":
    case "UPDATE_PATIENT":
    case "CREATE_VISIT":
      return staff.role === "intake" ? null : "Solo captura puede registrar pacientes y visitas.";
    case "UPDATE_SERVICE_FIELDS": {
      if (!isClinicalRole(staff.role)) return "Solo consulta clínica puede llenar campos del formato.";
      const keys = Object.keys(op.fields);
      if (keys.length === 0) return "No hay campos que guardar.";
      const allowed = new Set(fieldsFor(templateIdForService(op.serviceType), staff.role));
      const foreign = keys.filter((key) => !allowed.has(key));
      // Field keys are template codes, never patient data.
      if (foreign.length > 0) {
        const templateId = templateIdForService(op.serviceType);
        const labels = foreign.map((key) => templateFieldLabel(key, templateId));
        return `Estos campos no son de tu especialidad: ${labels.join(", ")}.`;
      }
      return null;
    }
    case "COMPLETE_STEP":
      if (op.role !== staff.role) return "Solo el especialista de este paso puede cerrarlo.";
      if (op.status === "SKIPPED" && !op.reason) return "Escribe el motivo para omitir este paso.";
      return null;
  }
}

/** The visit with this short folio in the campaign, if it has reached the server. */
function findVisitByFolio(client: Tx, campaignId: string, folio: string) {
  return client.visit.findUnique({
    where: { campaignId_folio: { campaignId, folio } },
    include: { patient: { select: { id: true, fullName: true } } },
  });
}

/** Applies one op. Never throws for business errors; unexpected errors bubble up (500, device retries). */
export async function applySyncOp(op: SyncOp, staff: StaffProfile): Promise<OpResult> {
  const denied = authorizeOp(op, staff);
  if (denied) return { opId: op.opId, status: "REJECTED", message: denied };
  if (!(await reserveOpId(op.opId))) return { opId: op.opId, status: "DUPLICATE" };

  let keepOpId = false;
  let lock: { acquired: boolean; release: () => Promise<void> } = {
    acquired: true,
    release: async () => undefined,
  };
  try {
    // Station ops lock the patient of the visit they point to; WAITING keeps nothing on the server.
    let patientId: string;
    if (isStationOp(op)) {
      const visit = await findVisitByFolio(db, op.campaignId, op.folio);
      if (!visit) throw new OpWaiting();
      patientId = visit.patientId;
    } else {
      patientId = op.patientId;
    }
    lock = await acquirePatientLock(patientId, op.opId);
    if (!lock.acquired) {
      // Another tablet is writing this patient right now: retryable, like the folio WAITING path.
      // Nothing is recorded and the Valkey op key is released in `finally`, so the device resends it.
      return { opId: op.opId, status: "WAITING", message: LOCK_BUSY_MESSAGE };
    }
    const result = await db.$transaction(async (tx) => {
      if (await tx.appliedOp.findUnique({ where: { opId: op.opId } })) {
        return { opId: op.opId, status: "DUPLICATE" } satisfies OpResult;
      }
      let outcome: OpResult;
      switch (op.kind) {
        case "CREATE_PATIENT":
          outcome = await createPatient(tx, op, staff);
          break;
        case "UPDATE_PATIENT":
          outcome = await updatePatient(tx, op, staff);
          break;
        case "CREATE_VISIT":
          outcome = await createVisit(tx, op, staff);
          break;
        case "UPDATE_SERVICE_FIELDS":
        case "COMPLETE_STEP":
          outcome = await applyStationOp(tx, op, staff);
          break;
      }
      // Same transaction as the change: an op is either fully applied and recorded, or neither.
      await tx.appliedOp.create({ data: { opId: op.opId, deviceId: op.deviceId, userId: staff.id } });
      return outcome;
    });
    keepOpId = true;
    return result;
  } catch (error) {
    if (error instanceof OpWaiting) {
      // Not recorded anywhere: the device keeps the op and the retry can apply it later.
      return { opId: op.opId, status: "WAITING", message: WAITING_MESSAGE };
    }
    if (error instanceof OpRejected) {
      return { opId: op.opId, status: "REJECTED", message: error.message };
    }
    if (isUniqueViolation(error, "opId")) {
      keepOpId = true;
      return { opId: op.opId, status: "DUPLICATE" };
    }
    if (isUniqueViolation(error)) {
      return { opId: op.opId, status: "REJECTED", message: "Este registro ya existe con otro envío." };
    }
    throw error;
  } finally {
    if (!keepOpId) await forgetOpId(op.opId);
    await lock.release();
  }
}

/** Only the fields present in the op (undefined means "not sent"). */
function definedFields(fields: Partial<PatientFields>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<PatientFields>;
}

async function assertLocality(tx: Tx, localityId: string | null | undefined) {
  if (!localityId) return;
  const exists = await tx.locality.findUnique({ where: { id: localityId }, select: { id: true } });
  if (!exists) throw new OpRejected("La localidad no existe. Actualiza el paquete de jornada.");
}

function parseFieldVersions(raw: string): Record<string, number> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function createPatient(tx: Tx, op: OpOf<"CREATE_PATIENT">, staff: StaffProfile): Promise<OpResult> {
  const existing = await tx.patient.findUnique({ where: { id: op.patientId }, select: { id: true } });
  if (existing) throw new OpRejected("Este expediente ya estaba registrado con otro envío.");

  const fields = definedFields(op.fields) as PatientFields;
  await assertLocality(tx, fields.localityId);
  const fieldVersions = Object.fromEntries(Object.keys(fields).map((key) => [key, 1]));

  await tx.patient.create({
    data: {
      ...fields,
      id: op.patientId,
      createdBy: staff.id,
      deviceId: op.deviceId,
      version: 1,
      fieldVersions: JSON.stringify(fieldVersions),
    },
  });

  await writeAudit(
    {
      actorId: staff.id,
      action: "PATIENT_CREATE",
      deviceId: op.deviceId,
      entity: "Patient",
      entityId: op.patientId,
      detail: `decision=${op.decision}`,
    },
    tx,
  );
  if (op.decision === "REJECTED_MATCH") {
    // Candidate ids are opaque record ids, never personal data.
    const ids = op.rejectedCandidateIds.filter((id) => /^[A-Za-z0-9-]{1,64}$/.test(id)).slice(0, 20);
    await writeAudit(
      {
        actorId: staff.id,
        action: "MATCH_REJECTED",
        deviceId: op.deviceId,
        entity: "Patient",
        entityId: op.patientId,
        detail: `rejected=${ids.join(",")}`,
      },
      tx,
    );
  }
  await openMatchReviews(tx, op, staff, fields);
  return { opId: op.opId, status: "APPLIED" };
}

/**
 * Duplicate detection on sync (SPEC 6.5.5): a patient registered offline is scored against
 * existing records with the same rules as search. Every STRONG candidate the person did not
 * reject ("Es otra persona") opens a MatchReview for a human to decide. Never merges by itself.
 */
async function openMatchReviews(
  tx: Tx,
  op: OpOf<"CREATE_PATIENT">,
  staff: StaffProfile,
  fields: PatientFields,
) {
  const rejected = new Set(op.rejectedCandidateIds);
  // The matcher compares one query phone against both candidate phones: try each of ours.
  const phones = [...new Set([fields.mobile, fields.phone].filter((p): p is string => !!p))];
  const best = new Map<string, MatchScore>();
  for (const phone of phones.length > 0 ? phones : [undefined]) {
    const scores = await scoreMainCandidates(
      {
        fullName: fields.fullName,
        birthDate: fields.birthDate,
        phone,
        formId: fields.formId ?? undefined,
        birthState: fields.birthState ?? undefined,
      },
      { client: tx, excludeIds: [op.patientId] },
    );
    for (const [id, score] of scores) {
      const current = best.get(id);
      if (!current || score.score > current.score) best.set(id, score);
    }
  }

  for (const [candidateId, score] of best) {
    if (score.strength !== "STRONG" || rejected.has(candidateId)) continue;
    const existing = await tx.matchReview.findFirst({
      where: {
        OR: [
          { patientAId: candidateId, patientBId: op.patientId },
          { patientAId: op.patientId, patientBId: candidateId },
        ],
      },
      select: { id: true },
    });
    if (existing) continue;
    const review = await tx.matchReview.create({
      data: {
        patientAId: candidateId,
        patientBId: op.patientId,
        score: score.score,
        reasons: JSON.stringify(score.reasons),
      },
    });
    // Opaque ids, score and reason codes only; never names, dates or phones.
    await writeAudit(
      {
        actorId: staff.id,
        action: "MATCH_REVIEW_OPENED",
        deviceId: op.deviceId,
        entity: "MatchReview",
        entityId: review.id,
        detail: `patients=${candidateId},${op.patientId} score=${score.score} reasons=${score.reasons.join(",")}`,
      },
      tx,
    );
  }
}

async function updatePatient(tx: Tx, op: OpOf<"UPDATE_PATIENT">, staff: StaffProfile): Promise<OpResult> {
  const patient = await tx.patient.findUnique({ where: { id: op.patientId } });
  if (!patient) {
    throw new OpRejected("No encontramos este expediente. Sincroniza primero su alta.");
  }

  const changes = definedFields(op.changes);
  if (changes.localityId !== undefined && changes.localityId !== patient.localityId) {
    await assertLocality(tx, changes.localityId);
  }

  const fieldVersions = parseFieldVersions(patient.fieldVersions);
  const toApply: Partial<PatientFields> = {};
  const conflicts: PatientField[] = [];

  for (const [key, deviceRaw] of Object.entries(changes)) {
    const field = key as PatientField;
    const serverValue = patient[field] ?? null;
    const deviceValue = deviceRaw ?? null;
    if (serverValue === deviceValue) continue; // already the same on both sides
    // Seeded/imported records have no entry: their fields last changed at version 1.
    const serverChangedAt = fieldVersions[field] ?? 1;
    if (serverChangedAt > op.baseVersion) {
      conflicts.push(field);
      await tx.syncConflict.create({
        data: {
          entity: "Patient",
          entityId: patient.id,
          field,
          serverValue,
          deviceValue,
          deviceId: op.deviceId,
          userId: staff.id,
          clinical: false,
        },
      });
    } else {
      Object.assign(toApply, { [field]: deviceValue });
    }
  }

  const appliedFields = Object.keys(toApply);
  if (appliedFields.length > 0) {
    const newVersion = patient.version + 1;
    for (const field of appliedFields) fieldVersions[field] = newVersion;
    await tx.patient.update({
      where: { id: patient.id },
      data: { ...toApply, version: newVersion, fieldVersions: JSON.stringify(fieldVersions) },
    });
    // Field names only, never their values.
    await writeAudit(
      {
        actorId: staff.id,
        action: "PATIENT_UPDATE",
        deviceId: op.deviceId,
        entity: "Patient",
        entityId: patient.id,
        detail: `fields=${appliedFields.join(",")}`,
      },
      tx,
    );
  }

  if (conflicts.length > 0) {
    await writeAudit(
      {
        actorId: staff.id,
        action: "SYNC_CONFLICT",
        deviceId: op.deviceId,
        entity: "Patient",
        entityId: patient.id,
        detail: `fields=${conflicts.join(",")}`,
      },
      tx,
    );
    const labels = conflicts.map((f) => FIELD_LABELS[f]).join(", ");
    return {
      opId: op.opId,
      status: "CONFLICT",
      message: `Alguien más cambió ${labels} antes que tú. Se conservó lo que ya estaba guardado y administración lo revisará.`,
    };
  }
  return { opId: op.opId, status: "APPLIED" };
}

async function createVisit(tx: Tx, op: OpOf<"CREATE_VISIT">, staff: StaffProfile): Promise<OpResult> {
  const [patient, campaign, existingVisit] = await Promise.all([
    tx.patient.findUnique({ where: { id: op.patientId }, select: { id: true } }),
    tx.campaign.findUnique({ where: { id: op.campaignId }, select: { id: true, date: true, endDate: true } }),
    tx.visit.findUnique({ where: { id: op.visitId }, select: { id: true } }),
  ]);
  if (!patient) throw new OpRejected("No encontramos el expediente de esta visita. Sincroniza primero su alta.");
  if (!campaign) throw new OpRejected("La jornada no existe. Actualiza el paquete de jornada.");
  if (existingVisit) throw new OpRejected("Esta visita ya estaba registrada con otro envío.");

  const serviceIds = op.services.map((s) => s.serviceId);
  if (new Set(serviceIds).size !== serviceIds.length) {
    throw new OpRejected("La visita trae servicios repetidos. Revísala y vuelve a enviarla.");
  }
  const existingServices = await tx.service.count({ where: { id: { in: serviceIds } } });
  if (existingServices > 0) throw new OpRejected("Uno de los servicios ya estaba registrado con otro envío.");

  // The short folio joins the stations offline (SPEC 6.3.1): required when the visit has steps.
  const plannedSteps = [...new Set(op.plannedSteps)];
  const typedFolio = op.folio?.trim() || null;
  if (plannedSteps.length > 0 && !isValidFolio(typedFolio)) {
    throw new OpRejected("El folio de la visita no es válido. Revisa las letras y los números del folio.");
  }
  const folio = typedFolio && isValidFolio(typedFolio) ? typedFolio.toUpperCase() : typedFolio;
  if (folio) {
    const sameFolio = await tx.visit.findUnique({
      where: { campaignId_folio: { campaignId: op.campaignId, folio } },
      select: { id: true },
    });
    if (sameFolio) {
      throw new OpRejected(`El folio ${folio} ya se usó en otra visita de esta jornada. Genera un folio nuevo.`);
    }
  }

  await tx.visit.create({
    data: {
      id: op.visitId,
      patientId: op.patientId,
      campaignId: op.campaignId,
      date: op.date,
      folio,
      createdBy: staff.id,
      deviceId: op.deviceId,
      steps: { create: plannedSteps.map((role) => ({ role, status: "PENDING" })) },
      services: {
        create: op.services.map((s) => ({
          id: s.serviceId,
          type: s.type,
          templateId: templateIdForService(s.type),
          status: "DRAFT",
        })),
      },
    },
  });

  await writeAudit(
    {
      actorId: staff.id,
      action: "VISIT_CREATE",
      deviceId: op.deviceId,
      entity: "Visit",
      entityId: op.visitId,
      detail: `patient=${op.patientId} services=${op.services.map((s) => s.type).join(",")} steps=${plannedSteps.join(",")}`,
    },
    tx,
  );
  // Offline reality: a visit dated outside the campaign range is still kept, but flagged for review.
  // YYYY-MM-DD strings compare correctly as text.
  if (op.date < campaign.date || op.date > campaign.endDate) {
    await writeAudit(
      {
        actorId: staff.id,
        action: "VISIT_OUTSIDE_CAMPAIGN_DATES",
        deviceId: op.deviceId,
        entity: "Visit",
        entityId: op.visitId,
        detail: `campaign=${op.campaignId}`,
      },
      tx,
    );
  }
  if (op.confirmedMatch) {
    await writeAudit(
      {
        actorId: staff.id,
        action: "MATCH_CONFIRMED",
        deviceId: op.deviceId,
        entity: "Patient",
        entityId: op.patientId,
        detail: `visit=${op.visitId}`,
      },
      tx,
    );
  }
  return { opId: op.opId, status: "APPLIED" };
}

/**
 * Station ops (SPEC 6.3.1): the specialist references the visit by campaign + folio. A confirmed
 * name that does not match the visit's patient is never merged in silence: it opens a conflict.
 */
async function applyStationOp(tx: Tx, op: StationOp, staff: StaffProfile): Promise<OpResult> {
  const visit = await findVisitByFolio(tx, op.campaignId, op.folio);
  if (!visit) throw new OpWaiting();

  if (nameSimilarity(op.confirmedName, visit.patient.fullName) < SIMILAR_NAME_THRESHOLD) {
    await tx.syncConflict.create({
      data: {
        entity: "Visit",
        entityId: visit.id,
        field: "confirmedName",
        serverValue: visit.patient.fullName,
        deviceValue: op.confirmedName,
        deviceId: op.deviceId,
        userId: staff.id,
        clinical: false,
      },
    });
    await writeAudit(
      {
        actorId: staff.id,
        action: "SYNC_CONFLICT",
        deviceId: op.deviceId,
        entity: "Visit",
        entityId: visit.id,
        detail: `fields=confirmedName op=${op.kind}`,
      },
      tx,
    );
    return {
      opId: op.opId,
      status: "CONFLICT",
      message: `El nombre que confirmó la paciente no coincide con el de la visita ${op.folio}. No se unió; administración lo revisará.`,
    };
  }

  const outcome =
    op.kind === "UPDATE_SERVICE_FIELDS"
      ? await updateServiceFields(tx, op, visit.id, staff)
      : await completeStep(tx, op, visit.id, staff);
  // Touch the visit so GET /api/sync/pull hands its new steps to the other tablets.
  await tx.visit.update({ where: { id: visit.id }, data: { version: { increment: 1 } } });
  return outcome;
}

interface ServiceFieldVersion {
  version: number;
  deviceId: string;
}

function parseServiceFieldVersions(raw: string): Record<string, ServiceFieldVersion> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, ServiceFieldVersion>) : {};
  } catch {
    return {};
  }
}

function parseServiceData(raw: string): Record<string, string> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Merges the specialist's fields into the visit's service of that type (created if missing).
 * Field-level versions: a field already holding a different value written from another device
 * is a clinical conflict (rule 8); the server value stays until a person decides.
 */
async function updateServiceFields(
  tx: Tx,
  op: OpOf<"UPDATE_SERVICE_FIELDS">,
  visitId: string,
  staff: StaffProfile,
): Promise<OpResult> {
  const templateId = templateIdForService(op.serviceType);
  const service =
    (await tx.service.findFirst({ where: { visitId, type: op.serviceType }, orderBy: { id: "asc" } })) ??
    (await tx.service.create({
      data: { id: randomUUID(), visitId, type: op.serviceType, templateId, status: "DRAFT" },
    }));

  const data = parseServiceData(service.data);
  const fieldVersions = parseServiceFieldVersions(service.fieldVersions);
  const newVersion = service.version + 1;
  const applied: string[] = [];
  const conflicts: string[] = [];

  for (const [field, deviceValue] of Object.entries(op.fields)) {
    const serverValue = data[field];
    if (serverValue === deviceValue) continue;
    const last = fieldVersions[field];
    if (serverValue !== undefined && serverValue !== "" && last && last.deviceId !== op.deviceId) {
      conflicts.push(field);
      await tx.syncConflict.create({
        data: {
          entity: "Service",
          entityId: service.id,
          field,
          serverValue,
          deviceValue,
          deviceId: op.deviceId,
          userId: staff.id,
          clinical: true,
        },
      });
      continue;
    }
    data[field] = deviceValue;
    fieldVersions[field] = { version: newVersion, deviceId: op.deviceId };
    applied.push(field);
  }

  if (applied.length > 0) {
    await tx.service.update({
      where: { id: service.id },
      data: { data: JSON.stringify(data), fieldVersions: JSON.stringify(fieldVersions), version: newVersion },
    });
    // Field names only, never their values.
    await writeAudit(
      {
        actorId: staff.id,
        action: "SERVICE_FIELDS_UPDATED",
        deviceId: op.deviceId,
        entity: "Service",
        entityId: service.id,
        detail: `visit=${visitId} type=${op.serviceType} fields=${applied.join(",")}`,
      },
      tx,
    );
  }
  if (conflicts.length > 0) {
    await writeAudit(
      {
        actorId: staff.id,
        action: "SYNC_CONFLICT",
        deviceId: op.deviceId,
        entity: "Service",
        entityId: service.id,
        detail: `fields=${conflicts.join(",")}`,
      },
      tx,
    );
    return {
      opId: op.opId,
      status: "CONFLICT",
      message: `Otro dispositivo ya había llenado ${conflicts.map((key) => templateFieldLabel(key, templateId)).join(", ")} con otro valor. Se conservó lo que ya estaba guardado y administración lo revisará.`,
    };
  }
  return { opId: op.opId, status: "APPLIED" };
}

/** Marks the specialist's step DONE or SKIPPED (created if intake did not plan it). */
async function completeStep(
  tx: Tx,
  op: OpOf<"COMPLETE_STEP">,
  visitId: string,
  staff: StaffProfile,
): Promise<OpResult> {
  const completedAt = new Date();
  const reason = op.status === "SKIPPED" ? (op.reason ?? null) : null;
  const step = await tx.visitStep.upsert({
    where: { visitId_role: { visitId, role: op.role } },
    create: { visitId, role: op.role, status: op.status, completedBy: staff.id, completedAt, reason },
    update: { status: op.status, completedBy: staff.id, completedAt, reason, version: { increment: 1 } },
  });
  // The skip reason is free text and may name the patient: it stays in the step, not in the log.
  await writeAudit(
    {
      actorId: staff.id,
      action: op.status === "DONE" ? "STEP_COMPLETED" : "STEP_SKIPPED",
      deviceId: op.deviceId,
      entity: "VisitStep",
      entityId: step.id,
      detail: `visit=${visitId} role=${op.role}`,
    },
    tx,
  );
  return { opId: op.opId, status: "APPLIED" };
}
