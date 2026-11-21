// Fictitious demo data only (see datos-ficticios/README.md). Resets the development database.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_STEPS_BY_SERVICE, buildEiraId, formatFolio, joinNameParts, type ClinicalRole, type ServiceType } from "@er/shared";
import { hashPin } from "../src/pin";

const db = new PrismaClient(process.env.DATABASE_URL ? { datasourceUrl: process.env.DATABASE_URL } : undefined);

const DEMO_PIN = "1234";
const DEVICE = "seed";
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const localities = [
  { id: "loc-san-ejemplo", name: "San Ejemplo de la Sierra", municipality: "Municipio Ficticio", hasSignal: false },
  { id: "loc-rancho-prueba", name: "Rancho Prueba del Monte", municipality: "Municipio Ficticio", hasSignal: false },
  { id: "loc-villa-demo", name: "Villa Demo", municipality: "Municipio Ficticio", hasSignal: true },
];

const campaigns = [
  { id: "camp-2026-05", name: "Jornada mayo 2026", date: "2026-05-16", endDate: "2026-05-16" },
  // Multi-day campaign: the downloaded package covers all three days offline.
  { id: "camp-2026-11", name: "Jornada noviembre 2026", date: "2026-11-21", endDate: "2026-11-23" },
].map((c) => ({
  ...c,
  municipality: "Municipio Ficticio",
  state: "Jalisco",
  localityIds: JSON.stringify(localities.map((l) => l.id)),
}));

const users = [
  { id: "usr-intake", username: "lperez", name: "Laura Pérez Ortiz", role: "intake" },
  { id: "usr-nutritionist", username: "jtorres", name: "Jorge Torres Navarro", role: "nutritionist" },
  { id: "usr-doctor", username: "cruiz", name: "Dra. Carmen Ruiz Delgado", role: "doctor" },
  { id: "usr-pathologist", username: "mvega", name: "Dra. Mariana Vega Salinas", role: "pathologist" },
  { id: "usr-admin", username: "smendez", name: "Sofía Méndez Aguilar", role: "admin" },
];

// Name parts are typed; fullName and the EIRA ID ("4. ID") are derived with the real rule (SPEC 6.1.1).
const patientParts = [
  { n: 1, givenNames: "María Guadalupe", paternalSurname: "Hernández", maternalSurname: "López", birthDate: "1985-03-12", birthState: "Jalisco", mobile: "55-0000-0001", localityId: "loc-san-ejemplo", affiliation: "6" },
  { n: 2, givenNames: "Juana", paternalSurname: "Martínez", maternalSurname: "García", birthDate: "1972-07-30", birthState: "Michoacán", mobile: "55-0000-0002", localityId: "loc-san-ejemplo", affiliation: "2" },
  // Near-duplicate target: staff will search "Lucia Ramirez Torres" (no accent).
  { n: 3, givenNames: "Lucía", paternalSurname: "Ramírez", maternalSurname: "Torres", birthDate: "1990-01-05", birthState: "Jalisco", mobile: "55-0000-0003", localityId: "loc-rancho-prueba", affiliation: "6" },
  // Pair registered twice with swapped surnames: opens a MatchReview for admin.
  { n: 4, givenNames: "Ana", paternalSurname: "Sánchez", maternalSurname: "Cruz", birthDate: "1968-11-22", birthState: "Colima", mobile: "55-0000-0004", localityId: "loc-san-ejemplo", affiliation: "1" },
  { n: 5, givenNames: "Ana", paternalSurname: "Cruz", maternalSurname: "Sánchez", birthDate: "1968-11-22", birthState: "Colima", mobile: null, localityId: "loc-villa-demo", affiliation: "1" },
  { n: 6, givenNames: "Rosa", paternalSurname: "Flores", maternalSurname: "Morales", birthDate: "1979-04-18", birthState: "Jalisco", mobile: "55-0000-0006", localityId: "loc-villa-demo", affiliation: "3" },
  // Similar name to Rosa Flores Morales but a different birth date: name alone is never enough.
  { n: 7, givenNames: "Rosa", paternalSurname: "Flores", maternalSurname: "Mendoza", birthDate: "1995-09-02", birthState: "Jalisco", mobile: "55-0000-0007", localityId: "loc-villa-demo", affiliation: "6" },
  { n: 8, givenNames: "Elena", paternalSurname: "Gómez", maternalSurname: "Vázquez", birthDate: "1983-12-01", birthState: "Nayarit", mobile: "55-0000-0008", localityId: "loc-rancho-prueba", affiliation: "7" },
];

const patients = patientParts.map((p) => ({
  ...p,
  fullName: joinNameParts(p),
  formId: buildEiraId(p),
}));

// Previous-campaign visits to demonstrate "second visit with history".
const priorVisits: { n: number; services: { type: ServiceType; data: Record<string, string> }[] }[] = [
  { n: 1, services: [{ type: "BREAST_REVIEW", data: { birads: "1", nextStep: "1" } }] },
  { n: 2, services: [{ type: "BREAST_REVIEW", data: { birads: "2", nextStep: "1" } }, { type: "ULTRASOUND", data: {} }] },
  { n: 3, services: [{ type: "PAP", data: {} }] },
  { n: 6, services: [{ type: "BREAST_REVIEW", data: { birads: "0", nextStep: "4" } }] },
];

async function main() {
  // Children first.
  await db.importRow.deleteMany();
  await db.importBatch.deleteMany();
  await db.service.deleteMany();
  await db.visitStep.deleteMany();
  await db.visit.deleteMany();
  await db.device.deleteMany();
  await db.matchReview.deleteMany();
  await db.syncConflict.deleteMany();
  await db.formScan.deleteMany();
  await db.appliedOp.deleteMany();
  await db.auditLog.deleteMany();
  await db.patient.deleteMany();
  await db.campaign.deleteMany();
  await db.locality.deleteMany();
  await db.user.deleteMany();

  await db.locality.createMany({ data: localities });
  await db.campaign.createMany({ data: campaigns });
  await db.user.createMany({ data: users.map((u) => ({ ...u, pinHash: hashPin(DEMO_PIN) })) });

  for (const p of patients) {
    const { n, ...fields } = p;
    await db.patient.create({
      data: { id: pid(n), ...fields, createdBy: "usr-intake", deviceId: DEVICE },
    });
  }

  // Prior folios come from a seed tablet with prefix "S1" (folios are unique per campaign).
  const completedAt = new Date("2026-05-16T18:00:00Z");
  for (const v of priorVisits) {
    const roles = [...new Set(v.services.flatMap((s) => DEFAULT_STEPS_BY_SERVICE[s.type]))] as ClinicalRole[];
    await db.visit.create({
      data: {
        id: `visit-prior-${v.n}`,
        patientId: pid(v.n),
        campaignId: "camp-2026-05",
        date: "2026-05-16",
        folio: formatFolio("S1", v.n),
        createdBy: "usr-intake",
        deviceId: DEVICE,
        services: {
          create: v.services.map((s, i) => ({
            id: `svc-prior-${v.n}-${i}`,
            type: s.type,
            templateId: s.type === "PAP" ? "citologia-cervical-eira" : "revision-mamaria-eira",
            data: JSON.stringify(s.data),
            status: "CONFIRMED",
            confirmedBy: s.type === "PAP" ? "usr-pathologist" : "usr-doctor",
            confirmedAt: completedAt,
          })),
        },
        steps: {
          create: roles.map((role) => ({ role, status: "DONE", completedBy: `usr-${role}`, completedAt })),
        },
      },
    });
  }

  await db.matchReview.create({
    data: {
      patientAId: pid(4),
      patientBId: pid(5),
      score: 80,
      reasons: JSON.stringify(["SAME_BIRTH_DATE", "SIMILAR_NAME", "SAME_BIRTH_STATE"]),
    },
  });

  await db.auditLog.create({ data: { actorId: "system", action: "SEED", detail: "Demo data loaded" } });

  // Human-readable summary of the fictitious patients (no clinical data).
  const summary = patients.map((p) => ({
    id: pid(p.n),
    fullName: p.fullName,
    givenNames: p.givenNames,
    paternalSurname: p.paternalSurname,
    maternalSurname: p.maternalSurname,
    birthDate: p.birthDate,
    birthState: p.birthState,
    localityId: p.localityId,
    formId: p.formId,
    priorVisits: priorVisits.some((v) => v.n === p.n) ? 1 : 0,
  }));
  const out = fileURLToPath(new URL("../../../datos-ficticios/pacientes.json", import.meta.url));
  writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");

  console.log(
    `Seed OK: ${users.length} users (${users.map((u) => u.username).join(", ")}; PIN ${DEMO_PIN}), ${localities.length} localities, ` +
      `${campaigns.length} campaigns, ${patients.length} patients, ${priorVisits.length} prior visits, 1 match review.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
