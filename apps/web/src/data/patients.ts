import {
  scoreCandidate,
  type CampaignView,
  type MatchCandidate,
  type PackageVisit,
  type PatientRecord,
  type PatientSummary,
  type SearchQuery,
  type SearchResponse,
  type SyncOp,
  type VisitStepView,
  type VisitView,
} from "@er/shared";
import { db, getPackageMeta, isPackageExpired, type LocalPatient, type LocalVisit } from "./db";
import { requestSync } from "./sync";
import { getDeviceId } from "../lib/device";
import { ApiError, isNetworkError, request } from "../lib/http";
import { hashPhone, phoneLast4 } from "../lib/phoneHash";
import { es } from "../i18n/es";

// The only module pages use for patients, visits and campaigns. Local-first (CLAUDE.md, SPEC 6.8):
// reads come from IndexedDB, writes go to IndexedDB plus the outbox, and the sync engine talks to
// /api/sync. The server is used directly only for the clinical roles' full record when there is signal.

export { ApiError } from "../lib/http";

const MAX_CANDIDATES = 10;

type CreatePatientOp = Extract<SyncOp, { kind: "CREATE_PATIENT" }>;
type UpdatePatientOp = Extract<SyncOp, { kind: "UPDATE_PATIENT" }>;
type CreateVisitOp = Extract<SyncOp, { kind: "CREATE_VISIT" }>;

// ---------- Search ----------

function summarize(patient: LocalPatient, visits: PackageVisit[]): PatientSummary {
  const sorted = [...visits].sort((a, b) => b.date.localeCompare(a.date));
  return {
    id: patient.id,
    fullName: patient.fullName,
    birthDate: patient.birthDate,
    birthState: patient.birthState,
    localityName: patient.localityName,
    formId: patient.formId,
    phoneLast4: patient.phoneLast4,
    lastVisitDate: sorted[0]?.date ?? null,
    lastCampaignName: sorted[0]?.campaignName ?? null,
    visitCount: visits.length,
  };
}

/** Deterministic matching over the campaign package (SPEC 6.2), same rules as the server. */
async function searchLocal(query: SearchQuery): Promise<SearchResponse> {
  const queryPhoneHash = await hashPhone(query.phone);
  const patients = await db.patients.toArray();
  const scored: { patient: LocalPatient; score: ReturnType<typeof scoreCandidate> }[] = [];
  for (const patient of patients) {
    // The device only holds phone hashes: when the hash matches, compare the typed number with itself
    // so scoreCandidate applies its usual SAME_PHONE rule (including the 7-digit minimum).
    // TODO(block 2 integration): switch to the shared phone-hash matcher once it lands in @er/shared.
    const samePhone = queryPhoneHash !== null && patient.phoneHashes.includes(queryPhoneHash);
    const score = scoreCandidate(query, {
      fullName: patient.fullName,
      birthDate: patient.birthDate,
      formId: patient.formId,
      birthState: patient.birthState,
      phone: samePhone ? query.phone : null,
    });
    if (score.score > 0) scored.push({ patient, score });
  }
  scored.sort((a, b) => b.score.score - a.score.score);
  const top = scored.slice(0, MAX_CANDIDATES);

  const candidates: MatchCandidate[] = [];
  for (const { patient, score } of top) {
    const visits = await db.visits.where("patientId").equals(patient.id).toArray();
    candidates.push({ patient: summarize(patient, visits), ...score });
  }
  return { candidates };
}

async function searchServer(query: SearchQuery): Promise<SearchResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  }
  return request<SearchResponse>(`/api/patients/search?${params.toString()}`);
}

/**
 * With a campaign package on this device, search runs locally (with or without signal) and an expired
 * package is refused. Without a package the server is used when there is signal.
 */
export async function searchPatients(query: SearchQuery): Promise<SearchResponse> {
  const meta = await getPackageMeta();
  if (meta) {
    if (isPackageExpired(meta)) throw new ApiError(es.package.expiredSearch, 0);
    return searchLocal(query);
  }
  if (!navigator.onLine) throw new ApiError(es.package.missingSearch, 0);
  return searchServer(query);
}

// ---------- Record ----------

/** Visit plus its specialist steps; the server may add `steps` to VisitView, local visits carry them. */
export type VisitWithSteps = VisitView & { steps?: VisitStepView[] };

function localVisitView(visit: LocalVisit): VisitWithSteps {
  return {
    steps: visit.steps,
    id: visit.id,
    date: visit.date,
    campaignId: visit.campaignId,
    campaignName: visit.campaignName,
    folio: visit.folio,
    // No clinical data on the device: the record shows the "solo consulta clínica" state.
    services: visit.serviceTypes.map((type) => ({ id: `${visit.id}:${type}`, type, status: "CONFIRMED", data: null })),
  };
}

async function localRecord(id: string): Promise<PatientRecord | null> {
  const patient = await db.patients.get(id);
  if (!patient) return null;
  const visits = await db.visits.where("patientId").equals(id).toArray();
  return {
    id: patient.id,
    formId: patient.formId,
    fullName: patient.fullName,
    birthDate: patient.birthDate,
    birthState: patient.birthState,
    // Phone numbers never live on the device, only their hashes.
    phone: null,
    mobile: null,
    residence: patient.residence ?? null,
    localityId: patient.localityId,
    localityName: patient.localityName,
    affiliation: patient.affiliation ?? null,
    version: patient.version,
    linkedIds: [],
    visits: visits.map(localVisitView),
  };
}

/** With signal: the server record (clinical data only for clinical roles), plus visits still in the outbox. */
export async function getPatientRecord(id: string): Promise<PatientRecord> {
  if (navigator.onLine) {
    try {
      const record = await request<PatientRecord>(`/api/patients/${encodeURIComponent(id)}`);
      const local = await db.visits.where("patientId").equals(id).toArray();
      const localById = new Map(local.map((v) => [v.id, v]));
      const known = new Set(record.visits.map((v) => v.id));
      const pending = local.filter((v) => !known.has(v.id));
      // Server visits without steps get the step state this tablet knows.
      const visits: VisitWithSteps[] = record.visits.map((v: VisitWithSteps) =>
        v.steps ? v : { ...v, steps: localById.get(v.id)?.steps },
      );
      return { ...record, visits: [...visits, ...pending.map(localVisitView)] };
    } catch (err) {
      // No connection, or a patient registered here that the server has not received yet.
      const fallback = isNetworkError(err) || (err instanceof ApiError && err.status === 404);
      if (!fallback) throw err;
    }
  }
  const local = await localRecord(id);
  if (!local) throw new ApiError(es.record.notOnDevice, 404);
  return local;
}

// ---------- Campaigns ----------

/** Campaigns for the visit form: from the package when present, else from the server. */
export async function listCampaigns(): Promise<CampaignView[]> {
  const meta = await getPackageMeta();
  if (meta) return meta.campaigns.length ? meta.campaigns : [meta.campaign];
  const data = await request<CampaignView[] | { campaigns: CampaignView[] }>("/api/campaigns");
  return Array.isArray(data) ? data : data.campaigns;
}

// ---------- Writes: local tables + outbox (SPEC 8, single write path) ----------

/** Common fields every op needs (CLAUDE.md: ids from the device, informative timestamp). */
export function opMeta() {
  return { opId: crypto.randomUUID(), deviceId: getDeviceId(), at: new Date().toISOString() };
}

export async function enqueue(op: SyncOp): Promise<void> {
  // Same opId twice (double tap, retry) is stored once: the server is idempotent on it too.
  if (await db.outbox.where("opId").equals(op.opId).count()) return;
  const now = new Date().toISOString();
  await db.outbox.add({ opId: op.opId, kind: op.kind, op, status: "pending", createdAt: now, updatedAt: now });
}

async function phoneHashesOf(...phones: (string | null | undefined)[]): Promise<string[]> {
  const hashes = await Promise.all(phones.map((p) => hashPhone(p)));
  return [...new Set(hashes.filter((h): h is string => h !== null))];
}

export async function createPatient(op: CreatePatientOp): Promise<void> {
  const f = op.fields;
  const phoneHashes = await phoneHashesOf(f.phone, f.mobile);
  await db.transaction("rw", db.patients, db.outbox, async () => {
    if (!(await db.patients.get(op.patientId))) {
      await db.patients.put({
        id: op.patientId,
        fullName: f.fullName,
        birthDate: f.birthDate,
        birthState: f.birthState ?? null,
        formId: f.formId ?? null,
        localityId: f.localityId ?? null,
        localityName: null,
        phoneHashes,
        phoneLast4: phoneLast4(f.mobile) ?? phoneLast4(f.phone),
        version: 1,
        linkedToId: null,
        residence: f.residence ?? null,
        affiliation: f.affiliation ?? null,
      });
    }
    await enqueue(op);
  });
  requestSync();
}

/** Saves a visit (and the identification corrections made on it) on the device. */
export async function saveVisit(ops: (UpdatePatientOp | CreateVisitOp)[], campaignName: string): Promise<void> {
  const update = ops.find((o): o is UpdatePatientOp => o.kind === "UPDATE_PATIENT");
  const extraHashes = update ? await phoneHashesOf(update.changes.phone, update.changes.mobile) : [];

  await db.transaction("rw", db.patients, db.visits, db.outbox, async () => {
    for (const op of ops) {
      if (op.kind === "UPDATE_PATIENT") {
        const current = await db.patients.get(op.patientId);
        if (current) {
          const c = op.changes;
          const newLast4 = phoneLast4(c.mobile) ?? phoneLast4(c.phone);
          await db.patients.update(op.patientId, {
            ...(c.fullName !== undefined && { fullName: c.fullName }),
            ...(c.birthDate !== undefined && { birthDate: c.birthDate }),
            ...(c.birthState !== undefined && { birthState: c.birthState }),
            ...(c.formId !== undefined && { formId: c.formId }),
            ...(c.residence !== undefined && { residence: c.residence }),
            ...(c.affiliation !== undefined && { affiliation: c.affiliation }),
            phoneHashes: [...new Set([...current.phoneHashes, ...extraHashes])],
            ...(newLast4 && { phoneLast4: newLast4 }),
          });
        }
      } else {
        await db.visits.put({
          id: op.visitId,
          patientId: op.patientId,
          campaignId: op.campaignId,
          campaignName,
          date: op.date,
          folio: op.folio ?? null,
          serviceTypes: op.services.map((s) => s.type),
          // Each planned specialist starts PENDING (SPEC 6.3.1 item 1).
          steps: op.plannedSteps.map((role) => ({ role, status: "PENDING", completedBy: null, completedAt: null })),
          registeredAt: op.at,
        });
      }
      await enqueue(op);
    }
  });
  requestSync();
}
