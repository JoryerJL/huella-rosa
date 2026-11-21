import { z } from "zod";
import { SERVICE_TYPES, type ServiceStatus, type ServiceType } from "./domain";

// API contract for block 1 (docs/SPEC.md 6.2, 6.3, 8). Server and web app both build against it.

// ---------- Matching ----------

export const MATCH_REASONS = [
  "SAME_FORM_ID",
  "SAME_BIRTH_DATE",
  "SIMILAR_NAME",
  "SAME_PHONE",
  "SAME_BIRTH_STATE",
  "SAME_LOCALITY",
] as const;
export type MatchReason = (typeof MATCH_REASONS)[number];

export type MatchStrength = "STRONG" | "WEAK";

/** What intake types to identify a patient. fullName + birthDate are required, plus at least one more on the UI. */
export const searchQuerySchema = z.object({
  fullName: z.string().trim().min(2),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().trim().optional(),
  formId: z.string().trim().optional(),
  birthState: z.string().trim().optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Minimal patient data needed to recognise someone. Never clinical. */
export interface PatientSummary {
  id: string;
  fullName: string;
  birthDate: string;
  birthState: string | null;
  localityName: string | null;
  formId: string | null;
  /** Last 4 digits only, for visual check. */
  phoneLast4: string | null;
  lastVisitDate: string | null;
  lastCampaignName: string | null;
  visitCount: number;
}

export interface MatchCandidate {
  patient: PatientSummary;
  /** 0-100. */
  score: number;
  strength: MatchStrength;
  reasons: MatchReason[];
}

/** GET /api/patients/search?fullName=&birthDate=&phone=&formId=&birthState= */
export interface SearchResponse {
  candidates: MatchCandidate[];
}

// ---------- Patient record ----------

export interface ServiceView {
  id: string;
  type: ServiceType;
  status: ServiceStatus;
  /** Template fields. Only present for role clinician; null for intake (SPEC 4). */
  data: Record<string, string> | null;
}

export interface VisitView {
  id: string;
  date: string;
  campaignId: string;
  campaignName: string;
  folio: string | null;
  services: ServiceView[];
}

/** GET /api/patients/:id */
export interface PatientRecord {
  id: string;
  formId: string | null;
  fullName: string;
  birthDate: string;
  birthState: string | null;
  phone: string | null;
  mobile: string | null;
  residence: string | null;
  localityId: string | null;
  localityName: string | null;
  affiliation: string | null;
  version: number;
  /** Ids of records linked to this one (SPEC 5, linkedToId). */
  linkedIds: string[];
  visits: VisitView[];
}

// ---------- Writes: single write path (SPEC 8) ----------

export const patientFieldsSchema = z.object({
  formId: z.string().trim().nullable().optional(),
  fullName: z.string().trim().min(2),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  birthState: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  mobile: z.string().trim().nullable().optional(),
  residence: z.string().trim().nullable().optional(),
  localityId: z.string().nullable().optional(),
  affiliation: z.string().nullable().optional(),
});
export type PatientFields = z.infer<typeof patientFieldsSchema>;

const opBase = {
  opId: z.string().uuid(),
  deviceId: z.string().min(1),
  /** ISO timestamp from the device; informative only, never used to resolve conflicts. */
  at: z.string(),
};

export const syncOpSchema = z.discriminatedUnion("kind", [
  z.object({
    ...opBase,
    kind: z.literal("CREATE_PATIENT"),
    patientId: z.string().uuid(),
    fields: patientFieldsSchema,
    /** How intake reached this decision: "NO_MATCH" or "REJECTED_MATCH" (pressed "Es otra persona"). */
    decision: z.enum(["NO_MATCH", "REJECTED_MATCH"]),
    rejectedCandidateIds: z.array(z.string()).default([]),
  }),
  z.object({
    ...opBase,
    kind: z.literal("UPDATE_PATIENT"),
    patientId: z.string().uuid(),
    baseVersion: z.number().int().min(1),
    /** Only the fields that changed. */
    changes: patientFieldsSchema.partial(),
  }),
  z.object({
    ...opBase,
    kind: z.literal("CREATE_VISIT"),
    visitId: z.string().uuid(),
    patientId: z.string().uuid(),
    campaignId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    folio: z.string().trim().nullable().optional(),
    /** "Es ella": intake confirmed this patient from a match. */
    confirmedMatch: z.boolean().default(false),
    services: z
      .array(z.object({ serviceId: z.string().uuid(), type: z.enum(SERVICE_TYPES) }))
      .min(1),
  }),
]);
export type SyncOp = z.infer<typeof syncOpSchema>;

/** POST /api/sync/push body. */
export const syncPushSchema = z.object({ ops: z.array(syncOpSchema).min(1).max(200) });
export type SyncPushInput = z.infer<typeof syncPushSchema>;

export type OpResultStatus = "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED";

export interface OpResult {
  opId: string;
  status: OpResultStatus;
  /** Plain Spanish reason when REJECTED or CONFLICT. */
  message?: string;
}

/** POST /api/sync/push response. */
export interface SyncPushResponse {
  results: OpResult[];
}

/** GET /api/campaigns — campaigns for the visit form (current one first). */
export interface CampaignView {
  id: string;
  name: string;
  date: string;
}
