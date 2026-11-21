import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import {
  nameTokens,
  normalizePhone,
  scoreCandidate,
  searchQuerySchema,
  type MatchCandidate,
  type MatchScore,
  type PatientRecord,
  type PatientSummary,
  type SearchResponse,
  type ServiceStatus,
  type ServiceType,
  type VisitView,
} from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { valkey } from "../valkey";
import { requireRole, type SessionEnv } from "../session";

const SEARCH_LIMIT_PER_MINUTE = 60;
const MAX_CANDIDATES = 10;
const PREFILTER_LIMIT = 500;

const visitInclude = {
  campaign: { select: { name: true } },
  services: { orderBy: { type: "asc" } },
} satisfies Prisma.VisitInclude;

const summaryInclude = {
  locality: { select: { name: true } },
  visits: { select: { date: true, campaign: { select: { name: true } } } },
  linkedFrom: {
    select: { visits: { select: { date: true, campaign: { select: { name: true } } } } },
  },
} satisfies Prisma.PatientInclude;

type SummaryRow = Prisma.PatientGetPayload<{ include: typeof summaryInclude }>;

function phoneLast4(row: { phone: string | null; mobile: string | null }): string | null {
  const digits = normalizePhone(row.mobile) || normalizePhone(row.phone);
  return digits ? digits.slice(-4) : null;
}

function toSummary(row: SummaryRow): PatientSummary {
  // A main record's history includes the visits of the records linked to it.
  const visits = [...row.visits, ...row.linkedFrom.flatMap((l) => l.visits)].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  return {
    id: row.id,
    fullName: row.fullName,
    birthDate: row.birthDate,
    birthState: row.birthState,
    localityName: row.locality?.name ?? null,
    formId: row.formId,
    phoneLast4: phoneLast4(row),
    lastVisitDate: visits[0]?.date ?? null,
    lastCampaignName: visits[0]?.campaign.name ?? null,
    visitCount: visits.length,
  };
}

/** Fixed window per user and minute in Valkey. Returns false when over the limit. */
async function withinSearchLimit(userId: string): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `ratelimit:search:${userId}:${minute}`;
  const count = await valkey.incr(key);
  if (count === 1) await valkey.expire(key, 60);
  return count <= SEARCH_LIMIT_PER_MINUTE;
}

export const patientRoutes = new Hono<SessionEnv>()
  .get("/search", requireRole("intake", "clinician"), async (c) => {
    const staff = c.get("staff");
    const parsed = searchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Escribe el nombre y la fecha de nacimiento (AAAA-MM-DD) para buscar." },
        400,
      );
    }
    if (!(await withinSearchLimit(staff.id))) {
      return c.json({ error: "Demasiadas búsquedas en poco tiempo. Espera un minuto e intenta de nuevo." }, 429);
    }
    const query = parsed.data;

    // Cheap DB prefilter; the real decision is scoreCandidate (same rules as offline search).
    const or: Prisma.PatientWhereInput[] = [{ birthDate: query.birthDate }];
    const formId = query.formId?.trim();
    if (formId) or.push({ formId }, { formId: formId.toUpperCase() });
    const phone = normalizePhone(query.phone);
    if (phone.length >= 7) {
      const last4 = phone.slice(-4);
      or.push({ phone: { contains: last4 } }, { mobile: { contains: last4 } });
    }
    for (const token of nameTokens(query.fullName).filter((t) => t.length >= 3)) {
      or.push({ fullName: { contains: token } });
    }

    const rows = await db.patient.findMany({
      where: { OR: or },
      select: {
        id: true,
        fullName: true,
        birthDate: true,
        formId: true,
        phone: true,
        mobile: true,
        birthState: true,
        linkedToId: true,
      },
      take: PREFILTER_LIMIT,
    });

    // Linked records resolve to their main record; keep the best score per main record.
    const best = new Map<string, MatchScore>();
    for (const row of rows) {
      const result = scoreCandidate(query, row);
      if (result.score <= 0) continue;
      const mainId = row.linkedToId ?? row.id;
      const current = best.get(mainId);
      if (!current || result.score > current.score) best.set(mainId, result);
    }

    const ranked = [...best.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, MAX_CANDIDATES);
    const mains = await db.patient.findMany({
      where: { id: { in: ranked.map(([id]) => id) } },
      include: summaryInclude,
    });
    const byId = new Map(mains.map((m) => [m.id, m]));
    const candidates: MatchCandidate[] = ranked.flatMap(([id, result]) => {
      const main = byId.get(id);
      return main ? [{ patient: toSummary(main), ...result }] : [];
    });

    // Never log what was typed (name, date, phone): only how many candidates came back.
    await writeAudit({
      actorId: staff.id,
      action: "PATIENT_SEARCH",
      deviceId: c.req.header("x-device-id") ?? null,
      detail: `results=${candidates.length}`,
    });
    const response: SearchResponse = { candidates };
    return c.json(response);
  })
  .get("/:id", requireRole("intake", "clinician"), async (c) => {
    const staff = c.get("staff");
    const id = c.req.param("id");
    const patient = await db.patient.findUnique({
      where: { id },
      include: {
        locality: { select: { name: true } },
        visits: { include: visitInclude },
        linkedFrom: { select: { id: true, visits: { include: visitInclude } } },
      },
    });
    if (!patient) return c.json({ error: "No encontramos este expediente." }, 404);

    // Clinical template data only for clinician (SPEC 4, rule 7): enforced here, not in the UI.
    const canSeeClinical = staff.role === "clinician";
    const visits: VisitView[] = [...patient.visits, ...patient.linkedFrom.flatMap((l) => l.visits)]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((v) => ({
        id: v.id,
        date: v.date,
        campaignId: v.campaignId,
        campaignName: v.campaign.name,
        folio: v.folio,
        services: v.services.map((s) => ({
          id: s.id,
          type: s.type as ServiceType,
          status: s.status as ServiceStatus,
          data: canSeeClinical ? parseData(s.data) : null,
        })),
      }));

    const record: PatientRecord = {
      id: patient.id,
      formId: patient.formId,
      fullName: patient.fullName,
      birthDate: patient.birthDate,
      birthState: patient.birthState,
      phone: patient.phone,
      mobile: patient.mobile,
      residence: patient.residence,
      localityId: patient.localityId,
      localityName: patient.locality?.name ?? null,
      affiliation: patient.affiliation,
      version: patient.version,
      linkedIds: patient.linkedFrom.map((l) => l.id),
      visits,
    };

    await writeAudit({
      actorId: staff.id,
      action: "PATIENT_VIEW",
      deviceId: c.req.header("x-device-id") ?? null,
      entity: "Patient",
      entityId: patient.id,
    });
    return c.json(record);
  });

function parseData(raw: string): Record<string, string> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}
