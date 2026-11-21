import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { createPatient, opMeta, searchPatients } from "./patients";
import { hashPhone } from "../lib/phoneHash";
import { es } from "../i18n/es";

const DAY = 24 * 60 * 60 * 1000;

async function loadPackage(expiresInMs: number) {
  const campaign = { id: "c-1", name: "Jornada Valle Ficticio", date: "2026-11-21" };
  await db.meta.put({
    key: "package",
    value: {
      campaignId: campaign.id,
      campaign,
      campaigns: [campaign],
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    },
  });
  await db.patients.put({
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Lucía Ramírez Torres",
    birthDate: "1978-03-12",
    birthState: "Puebla",
    formId: "DEMO000123",
    localityId: null,
    localityName: "San Ejemplo",
    phoneHashes: [(await hashPhone("55-0000-0003"))!],
    phoneLast4: "0003",
    version: 2,
    linkedToId: null,
  });
  await db.visits.put({
    id: "v-1",
    patientId: "11111111-1111-4111-8111-111111111111",
    campaignId: campaign.id,
    campaignName: campaign.name,
    date: "2026-05-14",
    folio: null,
    serviceTypes: ["BREAST_REVIEW"],
  });
}

beforeEach(async () => {
  await Promise.all([db.patients.clear(), db.visits.clear(), db.meta.clear(), db.outbox.clear()]);
});

describe("searchPatients (local package)", () => {
  it("matches by phone hash + birth date and builds the summary from local data", async () => {
    await loadPackage(7 * DAY);
    const { candidates } = await searchPatients({ fullName: "Otra Persona", birthDate: "1978-03-12", phone: "5500000003" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.strength).toBe("STRONG");
    expect(candidates[0]!.reasons).toEqual(["SAME_BIRTH_DATE", "SAME_PHONE"]);
    expect(candidates[0]!.patient).toMatchObject({
      phoneLast4: "0003",
      visitCount: 1,
      lastVisitDate: "2026-05-14",
      lastCampaignName: "Jornada Valle Ficticio",
    });
  });

  it("refuses to search with an expired package", async () => {
    await loadPackage(-1000);
    await expect(searchPatients({ fullName: "Lucía Ramírez Torres", birthDate: "1978-03-12" })).rejects.toThrow(
      es.package.expiredSearch,
    );
  });
});

describe("createPatient", () => {
  it("writes the patient locally (phone only as hash) and queues one op", async () => {
    const op = {
      ...opMeta(),
      kind: "CREATE_PATIENT" as const,
      patientId: "22222222-2222-4222-8222-222222222222",
      fields: { fullName: "María Elena Cruz Sánchez", birthDate: "1990-07-01", mobile: "55-0000-0007" },
      decision: "NO_MATCH" as const,
      rejectedCandidateIds: [],
    };
    await createPatient(op);
    await createPatient(op); // double tap: stored once

    const patient = await db.patients.get(op.patientId);
    expect(patient?.phoneHashes).toEqual([await hashPhone("5500000007")]);
    expect(JSON.stringify(patient)).not.toContain("5500000007");
    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ opId: op.opId, status: "pending", kind: "CREATE_PATIENT" });
  });
});
