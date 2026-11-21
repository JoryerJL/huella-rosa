import type { Prisma } from "@prisma/client";
import {
  hashPhone,
  normalizePhone,
  type CampaignView,
  type PackagePatient,
  type PackageVisit,
  type ServiceType,
} from "@er/shared";
import { db } from "./db";

// Offline campaign package and incremental pull (SPEC 6.1, 6.8). Minimal, non-clinical data only:
// phones travel as hashes (plus the last 4 digits for the visual check), never as numbers.

export const PACKAGE_VALID_DAYS = 7;

/**
 * Cursor = ISO timestamp of the latest change seen (opaque to the client).
 * updatedAt is set by the server when the write starts, so a transaction that commits slightly
 * later can carry an older timestamp. Pull re-reads this window; the device upserts by id.
 */
const CURSOR_OVERLAP_MS = 10_000;

export function parseCursor(raw: string | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Latest updatedAt across patients and visits (epoch when the database is empty). */
export async function currentCursor(): Promise<string> {
  const [patients, visits] = await Promise.all([
    db.patient.aggregate({ _max: { updatedAt: true } }),
    db.visit.aggregate({ _max: { updatedAt: true } }),
  ]);
  const times = [patients._max.updatedAt, visits._max.updatedAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  return new Date(times.length > 0 ? Math.max(...times) : 0).toISOString();
}

export interface CampaignScope {
  campaign: CampaignView & { localityIds: string[] };
  /** Patients the campaign's devices need offline. */
  where: Prisma.PatientWhereInput;
}

function parseIds(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Patients in the campaign's localities (main and linked records), patients with a visit in
 * the campaign, and the main records those link to (the device resolves linked -> main).
 */
export async function loadCampaignScope(campaignId: string): Promise<CampaignScope | null> {
  const row = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!row) return null;
  const localityIds = parseIds(row.localityIds);
  const inScope: Prisma.PatientWhereInput = {
    OR: [{ localityId: { in: localityIds } }, { visits: { some: { campaignId } } }],
  };
  return {
    campaign: { id: row.id, name: row.name, date: row.date, localityIds },
    where: { OR: [inScope, { linkedFrom: { some: inScope } }] },
  };
}

const patientSelect = {
  id: true,
  fullName: true,
  birthDate: true,
  birthState: true,
  formId: true,
  localityId: true,
  locality: { select: { name: true } },
  phone: true,
  mobile: true,
  version: true,
  linkedToId: true,
} satisfies Prisma.PatientSelect;

const visitSelect = {
  id: true,
  patientId: true,
  campaignId: true,
  campaign: { select: { name: true } },
  date: true,
  folio: true,
  // Service types only: template data is clinical and never leaves the server here.
  services: { select: { type: true }, orderBy: { type: "asc" } },
} satisfies Prisma.VisitSelect;

type PatientRow = Prisma.PatientGetPayload<{ select: typeof patientSelect }>;
type VisitRow = Prisma.VisitGetPayload<{ select: typeof visitSelect }>;

async function toPackagePatient(row: PatientRow): Promise<PackagePatient> {
  const hashes = await Promise.all([row.phone, row.mobile].map((p) => hashPhone(p)));
  const last = normalizePhone(row.mobile) || normalizePhone(row.phone);
  return {
    id: row.id,
    fullName: row.fullName,
    birthDate: row.birthDate,
    birthState: row.birthState,
    formId: row.formId,
    localityId: row.localityId,
    localityName: row.locality?.name ?? null,
    phoneHashes: [...new Set(hashes.filter((h) => h !== ""))],
    phoneLast4: last ? last.slice(-4) : null,
    version: row.version,
    linkedToId: row.linkedToId,
  };
}

function toPackageVisit(row: VisitRow): PackageVisit {
  return {
    id: row.id,
    patientId: row.patientId,
    campaignId: row.campaignId,
    campaignName: row.campaign.name,
    date: row.date,
    folio: row.folio,
    serviceTypes: row.services.map((s) => s.type as ServiceType),
  };
}

/** Every patient in scope with their whole visit history (no clinical data). */
export async function buildPackageData(scope: CampaignScope) {
  const patients = await db.patient.findMany({
    where: scope.where,
    select: patientSelect,
    orderBy: { id: "asc" },
  });
  const visits = await db.visit.findMany({
    where: { patientId: { in: patients.map((p) => p.id) } },
    select: visitSelect,
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  return {
    patients: await Promise.all(patients.map(toPackagePatient)),
    visits: visits.map(toPackageVisit),
  };
}

/**
 * Patients and visits in scope changed after `since` (minus the overlap window). A patient whose
 * visit changed is included too, so a newly visited patient reaches devices with their visit.
 */
export async function buildChangesSince(scope: CampaignScope, since: Date) {
  const after = new Date(since.getTime() - CURSOR_OVERLAP_MS);
  const visits = await db.visit.findMany({
    where: { updatedAt: { gt: after }, patient: scope.where },
    select: visitSelect,
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const patients = await db.patient.findMany({
    where: {
      OR: [
        { AND: [{ updatedAt: { gt: after } }, scope.where] },
        { id: { in: [...new Set(visits.map((v) => v.patientId))] } },
      ],
    },
    select: patientSelect,
    orderBy: { id: "asc" },
  });
  return {
    patients: await Promise.all(patients.map(toPackagePatient)),
    visits: visits.map(toPackageVisit),
  };
}

export async function listCampaigns(): Promise<CampaignView[]> {
  return db.campaign.findMany({
    select: { id: true, name: true, date: true },
    orderBy: [{ date: "desc" }, { name: "asc" }],
  });
}
