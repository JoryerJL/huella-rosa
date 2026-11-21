import { Prisma } from "@prisma/client";
import type { MatchScore, OpResult, PatientFields, StaffProfile, SyncOp } from "@er/shared";
import { db } from "./db";
import { writeAudit } from "./audit";
import { valkey } from "./valkey";
import { scoreMainCandidates } from "./matchCandidates";

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

/** Spanish labels for conflict messages (shown to the person syncing). */
const FIELD_LABELS: Record<PatientField, string> = {
  formId: "ID del formato",
  fullName: "nombre",
  birthDate: "fecha de nacimiento",
  birthState: "entidad de nacimiento",
  phone: "teléfono",
  mobile: "celular",
  residence: "residencia",
  localityId: "localidad",
  affiliation: "afiliación",
};

const TEMPLATE_BY_SERVICE: Record<string, string> = {
  PAP: "citologia-cervical-eira",
};
const DEFAULT_TEMPLATE = "revision-mamaria-eira";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RELEASE_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/**
 * Per-patient lock in Valkey. If Valkey is unreachable we continue without it:
 * the transaction and the unique AppliedOp row still keep the write safe.
 */
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

/** Applies one op. Never throws for business errors; unexpected errors bubble up (500, device retries). */
export async function applySyncOp(op: SyncOp, staff: StaffProfile): Promise<OpResult> {
  if (!(await reserveOpId(op.opId))) return { opId: op.opId, status: "DUPLICATE" };

  let keepOpId = false;
  const lock = await acquirePatientLock(op.patientId, op.opId);
  try {
    if (!lock.acquired) {
      return {
        opId: op.opId,
        status: "REJECTED",
        message: "El expediente está ocupado en este momento. Vuelve a sincronizar en unos segundos.",
      };
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
      }
      // Same transaction as the change: an op is either fully applied and recorded, or neither.
      await tx.appliedOp.create({ data: { opId: op.opId, deviceId: op.deviceId, userId: staff.id } });
      return outcome;
    });
    keepOpId = true;
    return result;
  } catch (error) {
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
      message: `Alguien más cambió ${labels} antes que tú. Se conservó el valor del servidor y quedó un conflicto para revisión.`,
    };
  }
  return { opId: op.opId, status: "APPLIED" };
}

async function createVisit(tx: Tx, op: OpOf<"CREATE_VISIT">, staff: StaffProfile): Promise<OpResult> {
  const [patient, campaign, existingVisit] = await Promise.all([
    tx.patient.findUnique({ where: { id: op.patientId }, select: { id: true } }),
    tx.campaign.findUnique({ where: { id: op.campaignId }, select: { id: true } }),
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

  await tx.visit.create({
    data: {
      id: op.visitId,
      patientId: op.patientId,
      campaignId: op.campaignId,
      date: op.date,
      folio: op.folio ?? null,
      createdBy: staff.id,
      deviceId: op.deviceId,
      services: {
        create: op.services.map((s) => ({
          id: s.serviceId,
          type: s.type,
          templateId: TEMPLATE_BY_SERVICE[s.type] ?? DEFAULT_TEMPLATE,
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
      detail: `patient=${op.patientId} services=${op.services.map((s) => s.type).join(",")}`,
    },
    tx,
  );
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
