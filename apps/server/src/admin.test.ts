import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { StaffProfile, SyncOp } from "@er/shared";
import { db } from "./db";
import { valkey } from "./valkey";
import { applySyncOp } from "./sync";
import { campaignDashboard, linkMatch, listConflicts, listMatches, resolveConflict } from "./admin";
import { app } from "./app";

const admin: StaffProfile = { id: "usr-admin", name: "Sofía Méndez Aguilar", role: "admin" };
const intake: StaffProfile = { id: "usr-intake", name: "Laura Pérez Ortiz", role: "intake" };
const doctor: StaffProfile = { id: "usr-doctor", name: "Dra. Carmen Ruiz Delgado", role: "doctor" };
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

afterAll(async () => {
  await db.$disconnect();
  valkey.disconnect();
});

describe("matches", () => {
  it("lists the seeded review with both records side by side", async () => {
    const matches = await listMatches();
    const review = matches.find((m) => m.a.id === pid(4) && m.b.id === pid(5));
    expect(review).toBeDefined();
    expect(review!.a.fullName).toBe("Ana Sánchez Cruz");
    expect(review!.b.fullName).toBe("Ana Cruz Sánchez");
    expect(review!.a.registeredByName).toBe("Laura Pérez Ortiz");
    expect(review!.differing).toEqual(expect.arrayContaining(["fullName", "mobile"]));
  });

  it("link keeps both records and the main record merges both histories", async () => {
    const [review] = (await listMatches()).filter((m) => m.a.id === pid(4));
    await db.visit.create({
      data: { id: `visit-${randomUUID()}`, patientId: pid(5), campaignId: "camp-2026-11", date: "2026-11-21", createdBy: "usr-intake", deviceId: "t" },
    });
    const result = await linkMatch(review!.id, pid(4), admin, "test-device");
    expect(result).toEqual({ mainId: pid(4), linkedId: pid(5) });

    const [main, other] = await Promise.all([db.patient.findUnique({ where: { id: pid(4) } }), db.patient.findUnique({ where: { id: pid(5) } })]);
    expect(main).not.toBeNull();
    expect(other?.linkedToId).toBe(pid(4));
    expect((await db.matchReview.findUnique({ where: { id: review!.id } }))?.status).toBe("LINKED");
    expect(await db.auditLog.count({ where: { action: "MATCH_LINKED", entityId: review!.id } })).toBe(1);

    const intakeCookie = await login("lperez");
    const res = await app.request(`/api/patients/${pid(5)}`, { headers: { cookie: intakeCookie } });
    const record = (await res.json()) as { id: string; linkedIds: string[]; visits: { id: string }[] };
    expect(record.id).toBe(pid(4));
    expect(record.linkedIds).toContain(pid(5));
    const ownVisits = await db.visit.count({ where: { patientId: { in: [pid(4), pid(5)] } } });
    expect(record.visits).toHaveLength(ownVisits);
  });
});

describe("conflicts", () => {
  it("resolve applies the chosen value and bumps versions", async () => {
    const patientId = pid(1);
    const before = await db.patient.findUniqueOrThrow({ where: { id: patientId } });
    const op = (residence: string): SyncOp => ({
      kind: "UPDATE_PATIENT",
      opId: randomUUID(),
      deviceId: "tablet-a",
      at: new Date().toISOString(),
      patientId,
      baseVersion: before.version,
      changes: { residence },
    });
    expect((await applySyncOp(op("Calle Ficticia 1"), intake)).status).toBe("APPLIED");
    expect((await applySyncOp(op("Calle Ficticia 2"), intake)).status).toBe("CONFLICT");

    const conflicts = await listConflicts(admin);
    const conflict = conflicts.find((c) => c.entityId === patientId && c.field === "residence");
    expect(conflict?.fieldLabel).toBe("Residencia");
    expect(conflict?.incoming.byName).toBe("Laura Pérez Ortiz");
    // Clinical roles never see identification conflicts.
    expect((await listConflicts(doctor)).some((c) => c.id === conflict!.id)).toBe(false);

    const mid = await db.patient.findUniqueOrThrow({ where: { id: patientId } });
    await resolveConflict(conflict!.id, "device", admin, "admin-tablet");
    const after = await db.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect(after.residence).toBe("Calle Ficticia 2");
    expect(after.version).toBe(mid.version + 1);
    expect(JSON.parse(after.fieldVersions).residence).toBe(after.version);
    expect((await db.syncConflict.findUnique({ where: { id: conflict!.id } }))?.status).toBe("RESOLVED");
    const audit = await db.auditLog.findFirst({ where: { action: "CONFLICT_RESOLVED", entityId: patientId } });
    expect(audit?.detail).toBe("fields=residence choice=device");
  });
});

describe("dashboard", () => {
  it("counts the seeded May campaign", async () => {
    const d = await campaignDashboard("camp-2026-05");
    expect(d.visits).toBe(4);
    expect(d.patients).toBe(4);
    const doctorSteps = d.steps.find((s) => s.role === "doctor")!;
    expect(doctorSteps.pending).toBe(0);
    expect(doctorSteps.done).toBeGreaterThan(0);
    // Seeded steps closed before the visit row existed: no negative averages.
    expect(doctorSteps.avgMinutes === null || doctorSteps.avgMinutes >= 0).toBe(true);
  });
});

describe("role checks", () => {
  it("intake gets 403 on admin routes", async () => {
    const cookie = await login("lperez");
    for (const path of ["/api/matches", "/api/conflicts", "/api/audit?patientId=x"]) {
      const res = await app.request(path, { headers: { cookie } });
      expect(res.status).toBe(403);
    }
  });

  it("a doctor sending a nutritionist field gets the Spanish label", async () => {
    const result = await applySyncOp(
      {
        kind: "UPDATE_SERVICE_FIELDS",
        opId: randomUUID(),
        deviceId: "tablet-d",
        at: new Date().toISOString(),
        campaignId: "camp-2026-05",
        folio: "S1-001-X",
        serviceType: "BREAST_REVIEW",
        confirmedName: "x",
        fields: { weight: "60" },
      } as SyncOp,
      doctor,
    );
    expect(result.status).toBe("REJECTED");
    expect(result.message).toContain("Peso");
    expect(result.message).not.toContain("weight");
  });
});

describe("nutritionist step", () => {
  it("stores Talla, Peso, PA and GLC in the BREAST_REVIEW service data", async () => {
    const nutritionist: StaffProfile = { id: "usr-nutritionist", name: "Jorge Torres Navarro", role: "nutritionist" };
    const visit = await db.visit.findUniqueOrThrow({ where: { id: "visit-prior-1" }, include: { patient: true } });
    const base = {
      deviceId: "tablet-n",
      at: new Date().toISOString(),
      campaignId: visit.campaignId,
      folio: visit.folio!,
      confirmedName: visit.patient.fullName,
    };
    const fields = { height: "157", weight: "61.5", bloodPressure: "118/76", capillaryGlucose: "93" };
    const update = await applySyncOp(
      { ...base, opId: randomUUID(), kind: "UPDATE_SERVICE_FIELDS", serviceType: "BREAST_REVIEW", fields } as SyncOp,
      nutritionist,
    );
    expect(update.status).toBe("APPLIED");
    const complete = await applySyncOp(
      { ...base, opId: randomUUID(), kind: "COMPLETE_STEP", role: "nutritionist", status: "DONE" } as SyncOp,
      nutritionist,
    );
    expect(complete.status).toBe("APPLIED");
    const service = await db.service.findFirstOrThrow({ where: { visitId: visit.id, type: "BREAST_REVIEW" }, orderBy: { id: "asc" } });
    expect(JSON.parse(service.data)).toMatchObject(fields);
    const audit = await db.auditLog.findFirst({ where: { action: "SERVICE_FIELDS_UPDATED", entityId: service.id, actorId: nutritionist.id } });
    expect(audit?.detail).toContain("height");
  });
});

async function login(username: string): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": "test-device" },
    body: JSON.stringify({ username, pin: "1234" }),
  });
  if (res.status !== 200) throw new Error(`login ${username}: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}
