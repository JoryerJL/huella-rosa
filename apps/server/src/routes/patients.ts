import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import {
  CLINICAL_ROLES,
  isClinicalRole,
  isUuid,
  normalizePhone,
  parsePatientSlug,
  pickBySlug,
  searchQuerySchema,
  type MatchCandidate,
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
import { scoreMainCandidates } from "../matchCandidates";
import { requireRole, type SessionEnv } from "../session";
import { stepSelect, toStepView } from "../campaignPackage";

const SEARCH_LIMIT_PER_MINUTE = 60;
const MAX_CANDIDATES = 10;

const visitInclude = {
  campaign: { select: { name: true } },
  services: { orderBy: { type: "asc" } },
  steps: { select: stepSelect, orderBy: { role: "asc" } },
} satisfies Prisma.VisitInclude;

export const summaryInclude = {
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

export function toSummary(row: SummaryRow): PatientSummary {
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
  .get("/search", requireRole("intake", ...CLINICAL_ROLES, "admin"), async (c) => {
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

    // Cheap DB prefilter + scoreCandidate (same rules as offline search).
    const best = await scoreMainCandidates(query);

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
  .get("/:id", requireRole("intake", ...CLINICAL_ROLES), async (c) => {
    const staff = c.get("staff");
    // Accepts the internal uuid (old links) or the readable slug "<EIRA ID>-<4 chars>" (SPEC 6.1.1).
    const requested = await resolvePatientParam(c.req.param("id"));
    if (!requested) return c.json({ error: "No encontramos este expediente." }, 404);
    // A linked record opens its main record, which shows the merged history.
    const link = await db.patient.findUnique({ where: { id: requested }, select: { linkedToId: true } });
    const id = link?.linkedToId ?? requested;
    const patient = await db.patient.findUnique({
      where: { id },
      include: {
        locality: { select: { name: true } },
        visits: { include: visitInclude },
        linkedFrom: { select: { id: true, visits: { include: visitInclude } } },
      },
    });
    if (!patient) return c.json({ error: "No encontramos este expediente." }, 404);

    // Clinical template data only for CLINICAL_ROLES (SPEC 4, rule 7): enforced here, not in the UI.
    const canSeeClinical = isClinicalRole(staff.role);
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
        steps: v.steps.map(toStepView),
      }));

    const record: PatientRecord = {
      id: patient.id,
      formId: patient.formId,
      fullName: patient.fullName,
      givenNames: patient.givenNames,
      paternalSurname: patient.paternalSurname,
      maternalSurname: patient.maternalSurname,
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

/** Internal id for a route param that is either a uuid or a readable slug; null when no patient matches. */
export async function resolvePatientParam(param: string): Promise<string | null> {
  if (isUuid(param)) return param;
  const parsed = parsePatientSlug(param);
  if (!parsed) return null;
  const candidates = await db.patient.findMany({
    where: { id: { startsWith: parsed.uuidPrefix } },
    select: { id: true, formId: true },
  });
  return pickBySlug(param, candidates)?.id ?? null;
}

function parseData(raw: string): Record<string, string> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}
