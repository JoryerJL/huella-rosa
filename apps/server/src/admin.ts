import type { Prisma } from "@prisma/client";
import {
  CLINICAL_ROLES,
  isClinicalRole,
  type AdminConflict,
  type AdminMatch,
  type AdminMatchPatient,
  type DashboardResponse,
  type MatchReason,
  type PatientAuditEntry,
  type StaffProfile,
} from "@er/shared";
import { db } from "./db";
import { writeAudit } from "./audit";
import { FIELD_LABELS } from "./sync";
import { fieldsFor, templateFieldLabel } from "./templates";

// Administration (SPEC 6.5, 6.6): "¿Es la misma persona?", "Dos personas cambiaron el mismo dato",
// per-patient log and the campaign dashboard. Nothing is merged or deleted without a person deciding.

type Tx = Prisma.TransactionClient;

/** Thrown to answer a plain Spanish 4xx without touching data. */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

const IDENTITY_FIELDS = [
  "fullName",
  "birthDate",
  "birthState",
  "formId",
  "phone",
  "mobile",
  "residence",
  "localityId",
  "affiliation",
] as const;

async function userNames(ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  const map = new Map(users.map((u) => [u.id, u.name]));
  map.set("system", "Sistema");
  return map;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------- ¿Es la misma persona? ----------

const matchPatientInclude = {
  locality: { select: { name: true } },
  _count: { select: { visits: true } },
} satisfies Prisma.PatientInclude;

type MatchPatientRow = Prisma.PatientGetPayload<{ include: typeof matchPatientInclude }>;

export async function listMatches(status = "OPEN"): Promise<AdminMatch[]> {
  const reviews = await db.matchReview.findMany({ where: { status }, orderBy: { createdAt: "asc" } });
  const ids = reviews.flatMap((r) => [r.patientAId, r.patientBId]);
  const patients = await db.patient.findMany({ where: { id: { in: ids } }, include: matchPatientInclude });
  const byId = new Map(patients.map((p) => [p.id, p]));
  const names = await userNames(patients.map((p) => p.createdBy));

  const view = (p: MatchPatientRow): AdminMatchPatient => ({
    id: p.id,
    fullName: p.fullName,
    birthDate: p.birthDate,
    birthState: p.birthState,
    formId: p.formId,
    phone: p.phone,
    mobile: p.mobile,
    residence: p.residence,
    localityName: p.locality?.name ?? null,
    affiliation: p.affiliation,
    visitCount: p._count.visits,
    registeredByName: names.get(p.createdBy) ?? null,
    registeredAt: p.createdAt.toISOString(),
    linkedToId: p.linkedToId,
  });

  return reviews.flatMap((r) => {
    const a = byId.get(r.patientAId);
    const b = byId.get(r.patientBId);
    if (!a || !b) return [];
    const differing = IDENTITY_FIELDS.filter((f) => (a[f] ?? null) !== (b[f] ?? null));
    return [
      {
        id: r.id,
        status: r.status as AdminMatch["status"],
        score: r.score,
        reasons: parseJson<MatchReason[]>(r.reasons, []),
        createdAt: r.createdAt.toISOString(),
        a: view(a),
        b: view(b),
        differing: [...differing],
      },
    ];
  });
}

/** "Es la misma": the other record points to the main one. Both records stay; nothing is deleted. */
export async function linkMatch(reviewId: string, mainId: string, staff: StaffProfile, deviceId: string | null) {
  return db.$transaction(async (tx) => {
    const review = await tx.matchReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new AdminError("No encontramos esta revisión.", 404);
    if (review.status !== "OPEN") throw new AdminError("Esta revisión ya se decidió.", 409);
    if (mainId !== review.patientAId && mainId !== review.patientBId) {
      throw new AdminError("Elige uno de los dos registros como principal.", 400);
    }
    const otherId = mainId === review.patientAId ? review.patientBId : review.patientAId;
    const main = await tx.patient.findUnique({ where: { id: mainId }, select: { linkedToId: true } });
    if (!main) throw new AdminError("No encontramos el registro principal.", 404);
    // Never chain links: if the chosen main is itself linked, point to its main.
    const targetId = main.linkedToId ?? mainId;
    if (targetId === otherId) throw new AdminError("Estos registros ya están unidos.", 409);

    await tx.patient.update({ where: { id: otherId }, data: { linkedToId: targetId, version: { increment: 1 } } });
    // Records already linked to the other one move to the same main record.
    await tx.patient.updateMany({ where: { linkedToId: otherId }, data: { linkedToId: targetId } });
    await tx.matchReview.update({
      where: { id: reviewId },
      data: { status: "LINKED", decidedBy: staff.id, decidedAt: new Date() },
    });
    await writeAudit(
      {
        actorId: staff.id,
        action: "MATCH_LINKED",
        deviceId,
        entity: "MatchReview",
        entityId: reviewId,
        detail: `main=${targetId} linked=${otherId}`,
      },
      tx,
    );
    return { mainId: targetId, linkedId: otherId };
  });
}

/** "Son personas distintas": both records stay as they are. */
export async function dismissMatch(reviewId: string, staff: StaffProfile, deviceId: string | null) {
  return db.$transaction(async (tx) => {
    const review = await tx.matchReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new AdminError("No encontramos esta revisión.", 404);
    if (review.status !== "OPEN") throw new AdminError("Esta revisión ya se decidió.", 409);
    await tx.matchReview.update({
      where: { id: reviewId },
      data: { status: "DISMISSED", decidedBy: staff.id, decidedAt: new Date() },
    });
    await writeAudit(
      {
        actorId: staff.id,
        action: "MATCH_DISMISSED",
        deviceId,
        entity: "MatchReview",
        entityId: reviewId,
        detail: `patients=${review.patientAId},${review.patientBId}`,
      },
      tx,
    );
  });
}

// ---------- Dos personas cambiaron el mismo dato ----------

type ConflictRow = Prisma.SyncConflictGetPayload<object>;

/** Who owns a clinical field: the template's `filledBy`. */
function clinicalOwner(field: string, templateId: string): string | null {
  for (const role of CLINICAL_ROLES) {
    if (fieldsFor(templateId, role).includes(field)) return role;
  }
  return null;
}

async function serviceTemplates(ids: string[]) {
  const services = await db.service.findMany({
    where: { id: { in: ids } },
    select: { id: true, templateId: true, visit: { select: { folio: true, patient: { select: { fullName: true } } } } },
  });
  return new Map(services.map((s) => [s.id, s]));
}

/** Admin sees identification conflicts; each specialist sees only clinical conflicts of their own fields. */
function canSee(conflict: ConflictRow, staff: StaffProfile, templateId: string | undefined): boolean {
  if (!conflict.clinical) return staff.role === "admin";
  if (!isClinicalRole(staff.role) || !templateId) return false;
  return clinicalOwner(conflict.field, templateId) === staff.role;
}

function conflictLabel(conflict: ConflictRow, templateId: string | undefined): string {
  if (conflict.entity === "Patient" && conflict.field in FIELD_LABELS) {
    const label = FIELD_LABELS[conflict.field as keyof typeof FIELD_LABELS];
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (conflict.field === "confirmedName") return "Nombre confirmado por la paciente";
  return templateFieldLabel(conflict.field, templateId);
}

export async function listConflicts(staff: StaffProfile, status = "OPEN"): Promise<AdminConflict[]> {
  const conflicts = await db.syncConflict.findMany({ where: { status }, orderBy: { createdAt: "asc" } });
  const services = await serviceTemplates(conflicts.filter((c) => c.entity === "Service").map((c) => c.entityId));
  const visible = conflicts.filter((c) => canSee(c, staff, services.get(c.entityId)?.templateId));

  const patientIds = visible.filter((c) => c.entity === "Patient").map((c) => c.entityId);
  const visitIds = visible.filter((c) => c.entity === "Visit").map((c) => c.entityId);
  const [patients, visits, audits] = await Promise.all([
    db.patient.findMany({
      where: { id: { in: patientIds } },
      select: { id: true, fullName: true, createdBy: true, createdAt: true },
    }),
    db.visit.findMany({
      where: { id: { in: visitIds } },
      select: { id: true, folio: true, createdBy: true, createdAt: true, patient: { select: { fullName: true } } },
    }),
    // Last write of each entity before the conflict tells who saved the kept value.
    db.auditLog.findMany({
      where: {
        entityId: { in: visible.map((c) => c.entityId) },
        action: { in: ["PATIENT_CREATE", "PATIENT_UPDATE", "SERVICE_FIELDS_UPDATED", "VISIT_CREATE", "CONFLICT_RESOLVED"] },
      },
      orderBy: { at: "desc" },
    }),
  ]);
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const visitById = new Map(visits.map((v) => [v.id, v]));
  const names = await userNames([
    ...visible.map((c) => c.userId),
    ...patients.map((p) => p.createdBy),
    ...visits.map((v) => v.createdBy),
    ...audits.map((a) => a.actorId),
  ]);

  return visible.map((c) => {
    const service = services.get(c.entityId);
    const lastWrite = audits.find(
      (a) =>
        a.entityId === c.entityId &&
        a.at <= c.createdAt &&
        (a.action.startsWith("PATIENT_CREATE") || a.action === "VISIT_CREATE" || (a.detail ?? "").includes(c.field)),
    );
    const patient = patientById.get(c.entityId);
    const visit = visitById.get(c.entityId);
    const fallbackBy = patient?.createdBy ?? visit?.createdBy ?? null;
    const fallbackAt = patient?.createdAt ?? visit?.createdAt ?? null;
    return {
      id: c.id,
      entity: c.entity,
      entityId: c.entityId,
      field: c.field,
      fieldLabel: conflictLabel(c, service?.templateId),
      clinical: c.clinical,
      patientName: patient?.fullName ?? visit?.patient.fullName ?? service?.visit.patient.fullName ?? null,
      folio: visit?.folio ?? service?.visit.folio ?? null,
      saved: {
        value: c.serverValue,
        byName: names.get(lastWrite?.actorId ?? fallbackBy ?? "") ?? null,
        at: (lastWrite?.at ?? fallbackAt)?.toISOString() ?? null,
      },
      incoming: {
        value: c.deviceValue,
        byName: names.get(c.userId) ?? null,
        at: c.createdAt.toISOString(),
      },
      status: c.status as AdminConflict["status"],
    };
  });
}

/**
 * Applies the chosen side through the field-version logic: the value is written (or kept), the
 * record version goes up and the field version points to it, so every device pulls the decision.
 */
export async function resolveConflict(
  conflictId: string,
  choice: "server" | "device",
  staff: StaffProfile,
  deviceId: string | null,
) {
  return db.$transaction(async (tx) => {
    const conflict = await tx.syncConflict.findUnique({ where: { id: conflictId } });
    if (!conflict) throw new AdminError("No encontramos este cambio.", 404);
    if (conflict.status !== "OPEN") throw new AdminError("Este cambio ya se revisó.", 409);
    const templateId =
      conflict.entity === "Service"
        ? (await tx.service.findUnique({ where: { id: conflict.entityId }, select: { templateId: true } }))?.templateId
        : undefined;
    if (!canSee(conflict, staff, templateId)) {
      throw new AdminError("Tu rol no tiene permiso para esta acción.", 403);
    }
    const value = choice === "device" ? conflict.deviceValue : conflict.serverValue;
    await applyChosenValue(tx, conflict, value, deviceId ?? "admin");
    await tx.syncConflict.update({
      where: { id: conflictId },
      data: { status: "RESOLVED", resolvedBy: staff.id, resolvedAt: new Date() },
    });
    // Field name and side only, never the values.
    await writeAudit(
      {
        actorId: staff.id,
        action: "CONFLICT_RESOLVED",
        deviceId,
        entity: conflict.entity,
        entityId: conflict.entityId,
        detail: `fields=${conflict.field} choice=${choice}`,
      },
      tx,
    );
  });
}

async function applyChosenValue(tx: Tx, conflict: ConflictRow, value: string | null, deviceId: string) {
  if (conflict.entity === "Patient") {
    if (!(conflict.field in FIELD_LABELS)) return;
    const patient = await tx.patient.findUnique({ where: { id: conflict.entityId } });
    if (!patient) throw new AdminError("No encontramos este expediente.", 404);
    const fieldVersions = parseJson<Record<string, number>>(patient.fieldVersions, {});
    const newVersion = patient.version + 1;
    fieldVersions[conflict.field] = newVersion;
    await tx.patient.update({
      where: { id: patient.id },
      data: { [conflict.field]: value, version: newVersion, fieldVersions: JSON.stringify(fieldVersions) },
    });
    return;
  }
  if (conflict.entity === "Service") {
    const service = await tx.service.findUnique({ where: { id: conflict.entityId } });
    if (!service) throw new AdminError("No encontramos este formato.", 404);
    const data = parseJson<Record<string, string>>(service.data, {});
    const fieldVersions = parseJson<Record<string, { version: number; deviceId: string }>>(service.fieldVersions, {});
    const newVersion = service.version + 1;
    if (value === null) delete data[conflict.field];
    else data[conflict.field] = value;
    fieldVersions[conflict.field] = { version: newVersion, deviceId };
    await tx.service.update({
      where: { id: service.id },
      data: { data: JSON.stringify(data), fieldVersions: JSON.stringify(fieldVersions), version: newVersion },
    });
    await tx.visit.update({ where: { id: service.visitId }, data: { version: { increment: 1 } } });
  }
  // Visit "confirmedName": nothing to write; the visit stays with its patient and the decision is logged.
}

// ---------- Bitácora por paciente ----------

export async function patientAudit(patientId: string): Promise<PatientAuditEntry[]> {
  const patient = await db.patient.findUnique({
    where: { id: patientId },
    select: { id: true, linkedToId: true, linkedFrom: { select: { id: true } } },
  });
  if (!patient) throw new AdminError("No encontramos este expediente.", 404);
  const patientIds = [patient.id, ...patient.linkedFrom.map((l) => l.id)];
  if (patient.linkedToId) patientIds.push(patient.linkedToId);

  const visits = await db.visit.findMany({
    where: { patientId: { in: patientIds } },
    select: { id: true, folio: true, steps: { select: { id: true, role: true } }, services: { select: { id: true, templateId: true } } },
  });
  const reviews = await db.matchReview.findMany({
    where: { OR: [{ patientAId: { in: patientIds } }, { patientBId: { in: patientIds } }] },
    select: { id: true },
  });
  const folioByVisit = new Map(visits.map((v) => [v.id, v.folio]));
  const stepInfo = new Map(visits.flatMap((v) => v.steps.map((s) => [s.id, { folio: v.folio, role: s.role }] as const)));
  const serviceInfo = new Map(visits.flatMap((v) => v.services.map((s) => [s.id, { folio: v.folio, templateId: s.templateId }] as const)));
  const entityIds = [
    ...patientIds,
    ...visits.map((v) => v.id),
    ...stepInfo.keys(),
    ...serviceInfo.keys(),
    ...reviews.map((r) => r.id),
  ];
  // Scans and imports reference the visit or patient in their detail text.
  const detailRefs = [...patientIds.map((id) => `patient=${id}`), ...visits.map((v) => `visit=${v.id}`)];

  const entries = await db.auditLog.findMany({
    where: {
      action: { notIn: ["PATIENT_VIEW", "PATIENT_SEARCH"] },
      OR: [{ entityId: { in: entityIds } }, ...detailRefs.map((ref) => ({ detail: { contains: ref } }))],
    },
    orderBy: { at: "asc" },
    take: 500,
  });
  const names = await userNames(entries.map((e) => e.actorId));
  const deviceIds = [...new Set(entries.map((e) => e.deviceId).filter((id): id is string => !!id))];
  const devices = new Map(
    (await db.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, folioPrefix: true } })).map((d) => [d.id, d]),
  );

  return entries.map((e) => {
    const detail = e.detail ?? "";
    const visitRef = /visit=([A-Za-z0-9-]+)/.exec(detail)?.[1];
    const step = e.entityId ? stepInfo.get(e.entityId) : undefined;
    const service = e.entityId ? serviceInfo.get(e.entityId) : undefined;
    const folio =
      (e.entityId ? folioByVisit.get(e.entityId) : undefined) ??
      (visitRef ? folioByVisit.get(visitRef) : undefined) ??
      step?.folio ??
      service?.folio ??
      null;
    const fieldKeys = /fields=([A-Za-z0-9_,]+)/.exec(detail)?.[1]?.split(",") ?? [];
    const fields = fieldKeys.map((key) =>
      key in FIELD_LABELS ? FIELD_LABELS[key as keyof typeof FIELD_LABELS] : templateFieldLabel(key, service?.templateId),
    );
    return {
      id: e.id,
      at: e.at.toISOString(),
      actorName: names.get(e.actorId) ?? null,
      action: e.action,
      entity: e.entity,
      folio,
      role: step?.role ?? (/role=([a-z]+)/.exec(detail)?.[1] ?? null),
      fields,
      choice: (/choice=(server|device)/.exec(detail)?.[1] as "server" | "device" | undefined) ?? null,
      // Never the raw device id: its friendly name, else its folio prefix.
      deviceName: (e.deviceId && devices.get(e.deviceId)?.name) || null,
      devicePrefix: (e.deviceId && devices.get(e.deviceId)?.folioPrefix) || null,
    };
  });
}

// ---------- Tablero de la jornada ----------

export async function campaignDashboard(campaignId: string): Promise<DashboardResponse> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true } });
  if (!campaign) throw new AdminError("No encontramos esta jornada.", 404);
  const visits = await db.visit.findMany({
    where: { campaignId },
    select: {
      id: true,
      createdAt: true,
      patientId: true,
      patient: { select: { linkedToId: true, locality: { select: { name: true } } } },
      steps: { select: { role: true, status: true, completedAt: true } },
    },
  });
  const visitIds = visits.map((v) => v.id);
  const [confirmed, openMatches, linkedMatches, openConflicts] = await Promise.all([
    visitIds.length
      ? db.auditLog.count({
          where: { action: "MATCH_CONFIRMED", OR: visitIds.map((id) => ({ detail: { contains: `visit=${id}` } })) },
        })
      : Promise.resolve(0),
    db.matchReview.count({ where: { status: "OPEN" } }),
    db.matchReview.count({ where: { status: "LINKED" } }),
    db.syncConflict.count({ where: { status: "OPEN" } }),
  ]);

  const steps: DashboardResponse["steps"] = [];
  for (const role of CLINICAL_ROLES) {
    const own = visits.flatMap((v) => v.steps.filter((s) => s.role === role).map((s) => ({ s, v })));
    const done = own.filter(({ s }) => s.status === "DONE" && s.completedAt);
    // Steps closed before the visit reached the server (offline or seeded) carry no usable duration.
    const minutes = done
      .map(({ s, v }) => (s.completedAt!.getTime() - v.createdAt.getTime()) / 60_000)
      .filter((m) => m >= 0);
    steps.push({
      role,
      pending: own.filter(({ s }) => s.status === "PENDING").length,
      done: done.length,
      skipped: own.filter(({ s }) => s.status === "SKIPPED").length,
      avgMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
    });
  }

  const pendingByLocality = new Map<string, number>();
  for (const v of visits) {
    if (!v.steps.some((s) => s.status === "PENDING")) continue;
    const name = v.patient.locality?.name ?? "Sin localidad";
    pendingByLocality.set(name, (pendingByLocality.get(name) ?? 0) + 1);
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    patients: new Set(visits.map((v) => v.patient.linkedToId ?? v.patientId)).size,
    visits: visits.length,
    recurringRecognized: confirmed,
    matchesOpen: openMatches,
    matchesLinked: linkedMatches,
    conflictsOpen: openConflicts,
    steps,
    pendingByLocality: [...pendingByLocality.entries()]
      .map(([locality, count]) => ({ locality, count }))
      .sort((a, b) => b.count - a.count),
  };
}
