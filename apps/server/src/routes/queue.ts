import { Hono } from "hono";
import { CLINICAL_ROLES, type QueueItem } from "@er/shared";
import { db } from "../db";
import { requireRole, type SessionEnv } from "../session";
import { stepSelect, toStepView } from "../campaignPackage";

// "Pacientes esperándome" (SPEC 6.3.1, item 2): visits of the campaign with the caller's step
// still PENDING, oldest first. Identification data and step status only, never clinical values.

export const queueRoutes = new Hono<SessionEnv>().get("/", requireRole(...CLINICAL_ROLES), async (c) => {
  const staff = c.get("staff");
  const campaignId = c.req.query("campaignId");
  if (!campaignId) return c.json({ error: "Falta la jornada." }, 400);

  const visits = await db.visit.findMany({
    where: { campaignId, folio: { not: null }, steps: { some: { role: staff.role, status: "PENDING" } } },
    select: {
      id: true,
      folio: true,
      createdAt: true,
      patient: { select: { id: true, fullName: true, birthDate: true } },
      steps: { select: stepSelect, orderBy: { role: "asc" } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const items: QueueItem[] = visits.map((v) => ({
    visitId: v.id,
    folio: v.folio!,
    patientId: v.patient.id,
    fullName: v.patient.fullName,
    birthDate: v.patient.birthDate,
    registeredAt: v.createdAt.toISOString(),
    steps: v.steps.map(toStepView),
  }));
  return c.json(items);
});
