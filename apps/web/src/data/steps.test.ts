import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOp, VisitStepView } from "@er/shared";
import { db, type LocalVisit } from "./db";
import { completedStepKeys, filterQueue, loadQueue, saveStep } from "./steps";
import { opMeta } from "./patients";
import { pushOutbox } from "./sync";
import { ensureFolioPrefix, reserveFolio } from "./folioPrefix";
import { folioCheckLetter, formatFolio, isValidFolio } from "../lib/folio";
import { stepFieldsFor } from "../lib/stepFields";
import { defaultSteps, isOutsideCampaign } from "../pages/NewVisitPage";
import { es } from "../i18n/es";

const pending = (role: VisitStepView["role"]): VisitStepView => ({ role, status: "PENDING", completedBy: null, completedAt: null });
const done = (role: VisitStepView["role"]): VisitStepView => ({ role, status: "DONE", completedBy: "Fic", completedAt: "2026-11-21T10:00:00.000Z" });

function visit(id: string, folio: string, registeredAt: string, steps: VisitStepView[]): LocalVisit {
  return {
    id,
    patientId: `p-${id}`,
    campaignId: "c-1",
    campaignName: "Jornada Valle Ficticio",
    date: "2026-11-21",
    folio,
    serviceTypes: ["BREAST_REVIEW"],
    steps,
    registeredAt,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("folio", () => {
  it("uses the mod-23 check letter and pads the sequence", () => {
    expect(folioCheckLetter(0)).toBe("A");
    expect(folioCheckLetter(17)).toBe("T");
    expect(folioCheckLetter(23)).toBe("A");
    expect(formatFolio("B3", 17)).toBe("B3-017-T");
    expect(formatFolio("B3", 1234)).toBe(`B3-1234-${folioCheckLetter(1234)}`);
  });

  it("validates format and check letter, accepting lowercase", () => {
    expect(isValidFolio("B3-017-T")).toBe(true);
    expect(isValidFolio(" b3-017-t ")).toBe(true);
    expect(isValidFolio("B3-017-K")).toBe(false);
    expect(isValidFolio("B3-17-T")).toBe(false);
    expect(isValidFolio("")).toBe(false);
  });

  it("reserves consecutive folios from the stored prefix and never repeats one", async () => {
    expect(await reserveFolio()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ deviceId: "d", folioPrefix: "B3" })));
    expect(await ensureFolioPrefix()).toEqual({ folioPrefix: "B3", nextSeq: 1 });
    expect(await reserveFolio()).toBe("B3-001-B");
    expect(await reserveFolio()).toBe("B3-002-C");
    // Registering again keeps the counter.
    expect(await ensureFolioPrefix()).toEqual({ folioPrefix: "B3", nextSeq: 3 });
  });

  it("returns null when the tablet cannot register (no signal)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await ensureFolioPrefix()).toBeNull();
    expect(await reserveFolio()).toBeNull();
  });
});

describe("planned steps", () => {
  it("proposes specialists from the services of the day", () => {
    expect(defaultSteps(["BREAST_REVIEW"])).toEqual(["nutritionist", "doctor"]);
    expect(defaultSteps(["PAP"])).toEqual(["pathologist"]);
    expect(defaultSteps(["PAP", "ULTRASOUND"])).toEqual(["nutritionist", "doctor", "pathologist"]);
    expect(defaultSteps([])).toEqual([]);
  });

  it("warns when today is outside the campaign dates", () => {
    const meta = {
      campaignId: "c-1",
      campaign: { id: "c-1", name: "J", date: "2026-11-20", endDate: "2026-11-22" },
      campaigns: [],
      generatedAt: "",
      expiresAt: "",
    };
    expect(isOutsideCampaign(meta, "2026-11-21")).toBe(false);
    expect(isOutsideCampaign(meta, "2026-11-23")).toBe(true);
    expect(isOutsideCampaign({ ...meta, campaign: { id: "c-1", name: "J", date: "2026-11-20", endDate: "2026-11-20" } }, "2026-11-21")).toBe(true);
  });
});

describe("step fields", () => {
  it("gives each specialist only their own template fields, never no_transcribir ones", () => {
    const nutri = stepFieldsFor("nutritionist").map((f) => f.key);
    expect(nutri).toEqual(["height", "weight", "bloodPressure", "capillaryGlucose", "bt", "at"]);
    const doctor = stepFieldsFor("doctor");
    expect(doctor.map((f) => f.key)).toContain("birads");
    expect(doctor.map((f) => f.key)).not.toContain("clinicalExamResults");
    expect(doctor.every((f) => f.serviceType === "BREAST_REVIEW")).toBe(true);
    const birads = doctor.find((f) => f.key === "birads")!;
    expect(birads.options[1]).toEqual({ value: "1", label: "Mama normal" });
    const patho = stepFieldsFor("pathologist");
    expect(patho.every((f) => f.serviceType === "PAP")).toBe(true);
    expect(patho.find((f) => f.key === "diagnosisCode")!.options).toHaveLength(11);
  });
});

describe("queue", () => {
  const visits = [
    visit("2", "B3-002-C", "2026-11-21T09:20:00.000Z", [pending("nutritionist"), pending("doctor")]),
    visit("1", "B3-001-B", "2026-11-21T09:12:00.000Z", [done("nutritionist"), pending("doctor")]),
    visit("3", "B3-003-D", "2026-11-21T09:31:00.000Z", [pending("pathologist")]),
  ];
  const names = new Map([
    ["p-1", "Lucía Ramírez Torres"],
    ["p-2", "Martha Sánchez Ortiz"],
  ]);

  it("lists visits with my step pending, oldest first", () => {
    const doctor = filterQueue(visits, names, "doctor", new Set());
    expect(doctor.map((e) => e.folio)).toEqual(["B3-001-B", "B3-002-C"]);
    expect(doctor[0]!.fullName).toBe("Lucía Ramírez Torres");
    expect(filterQueue(visits, names, "nutritionist", new Set()).map((e) => e.folio)).toEqual(["B3-002-C"]);
  });

  it("hides a step finished on this tablet that the server has not confirmed yet", () => {
    const op = { ...opMeta(), kind: "COMPLETE_STEP", campaignId: "c-1", folio: "b3-001-b", confirmedName: "Lucía", role: "doctor", status: "DONE" } as SyncOp;
    const keys = completedStepKeys([{ op }]);
    expect(filterQueue(visits, names, "doctor", keys).map((e) => e.folio)).toEqual(["B3-002-C"]);
  });

  it("marks the step locally and queues the ops when saving", async () => {
    await db.visits.bulkPut(visits);
    const base = { campaignId: "c-1", folio: "B3-001-B", confirmedName: "Lucía Ramírez Torres" };
    await saveStep(
      [
        { ...opMeta(), ...base, kind: "UPDATE_SERVICE_FIELDS", serviceType: "BREAST_REVIEW", fields: { birads: "1" } },
        { ...opMeta(), ...base, kind: "COMPLETE_STEP", role: "doctor", status: "DONE" },
      ],
      "Dra. Ficticia",
    );
    expect((await db.visits.get("1"))!.steps!.find((s) => s.role === "doctor")!.status).toBe("DONE");
    expect(await db.outbox.count()).toBe(2);
    expect((await loadQueue("doctor")).map((e) => e.folio)).toEqual(["B3-002-C"]);
  });
});

describe("sync WAITING", () => {
  it("keeps WAITING ops pending with a plain message and does not resend them in the same pass", async () => {
    const op = { ...opMeta(), kind: "COMPLETE_STEP", campaignId: "c-1", folio: "B3-001-B", confirmedName: "Lucía", role: "doctor", status: "DONE" } as SyncOp;
    const now = new Date().toISOString();
    await db.outbox.add({ opId: op.opId, kind: op.kind, op, status: "pending", createdAt: now, updatedAt: now });
    const fetchMock = vi.fn(async () => jsonResponse({ results: [{ opId: op.opId, status: "WAITING" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await pushOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const entry = (await db.outbox.toArray())[0]!;
    expect(entry.status).toBe("pending");
    expect(entry.resultStatus).toBe("WAITING");
    expect(entry.message).toBe(es.sync.waiting);

    // Next sync: the visit arrived and the op is applied.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ results: [{ opId: op.opId, status: "APPLIED" }] })));
    await pushOutbox();
    expect((await db.outbox.toArray())[0]!.status).toBe("sent");
  });

  it("keeps CONFLICT visible with the plain-language message", async () => {
    const op = { ...opMeta(), kind: "COMPLETE_STEP", campaignId: "c-1", folio: "B3-001-B", confirmedName: "Lucía", role: "doctor", status: "DONE" } as SyncOp;
    const now = new Date().toISOString();
    await db.outbox.add({ opId: op.opId, kind: op.kind, op, status: "pending", createdAt: now, updatedAt: now });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ results: [{ opId: op.opId, status: "CONFLICT" }] })));
    await pushOutbox();
    const entry = (await db.outbox.toArray())[0]!;
    expect(entry.status).toBe("failed");
    expect(entry.message).toBe(es.visit.status.CONFLICT);
  });
});
