import { z } from "zod";
import {
  CLINICAL_ROLES,
  SERVICE_TYPES,
  type ClinicalRole,
  type ServiceStatus,
  type ServiceType,
  type StepStatus,
} from "./domain";

/** Short visit folio written on the paper form: "<prefix>-<seq>-<check>", e.g. "B3-017-K" (SPEC 6.3.1). */
export const FOLIO_PATTERN = /^[A-Z][0-9]-\d{3,4}-[A-Z]$/;

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
  /** Template fields. Present for CLINICAL_ROLES; null for intake (SPEC 4). */
  data: Record<string, string> | null;
}

export interface VisitView {
  id: string;
  date: string;
  campaignId: string;
  campaignName: string;
  folio: string | null;
  services: ServiceView[];
  /** Block 2b (additive): stations of this visit (SPEC 6.3.1). */
  steps?: VisitStepView[];
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
    /** Specialists the patient will see today (SPEC 6.3.1). Each creates a PENDING VisitStep. */
    plannedSteps: z.array(z.enum(CLINICAL_ROLES)).default([]),
  }),
  // Specialist ops reference the visit by campaign + short folio, because the visit may not
  // have reached this tablet yet (SPEC 6.3.1, "El folio une a las estaciones").
  z.object({
    ...opBase,
    kind: z.literal("UPDATE_SERVICE_FIELDS"),
    campaignId: z.string().min(1),
    folio: z.string().regex(FOLIO_PATTERN),
    /** Name the patient confirmed at this station; a mismatch opens a review instead of merging. */
    confirmedName: z.string().trim().min(2),
    serviceType: z.enum(SERVICE_TYPES),
    /** Template field keys -> values. Only fields whose `filledBy` is the sender's role. */
    fields: z.record(z.string(), z.string()),
  }),
  z.object({
    ...opBase,
    kind: z.literal("COMPLETE_STEP"),
    campaignId: z.string().min(1),
    folio: z.string().regex(FOLIO_PATTERN),
    confirmedName: z.string().trim().min(2),
    role: z.enum(CLINICAL_ROLES),
    status: z.enum(["DONE", "SKIPPED"]),
    /** Required when SKIPPED (e.g. "La paciente se retiró"). */
    reason: z.string().trim().optional(),
  }),
]);
export type SyncOp = z.infer<typeof syncOpSchema>;

// ---------- Block 2b: specialists, steps, folio ----------

/** POST /api/devices/register (any staff, online): assigns this tablet a unique folio prefix once. */
export interface DeviceRegistration {
  deviceId: string;
  /** Letter + digit, e.g. "B3". Stable for this deviceId. */
  folioPrefix: string;
}

export interface VisitStepView {
  role: ClinicalRole;
  status: StepStatus;
  completedBy: string | null;
  completedAt: string | null;
}

/** GET /api/queue (specialists): today's visits in the campaign with this role's step PENDING. */
export interface QueueItem {
  visitId: string;
  folio: string;
  patientId: string;
  fullName: string;
  birthDate: string;
  registeredAt: string;
  steps: VisitStepView[];
}

/** POST /api/sync/push body. */
export const syncPushSchema = z.object({ ops: z.array(syncOpSchema).min(1).max(200) });
export type SyncPushInput = z.infer<typeof syncPushSchema>;

/** WAITING: the referenced visit (folio) has not reached the server yet; the device keeps and retries the op. */
export type OpResultStatus = "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED" | "WAITING";

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

// ---------- Block 2: offline package, pull and live events (SPEC 6.1, 6.5, 6.8) ----------

/** One patient in the campaign package: minimal index for offline matching. Never clinical. */
export interface PackagePatient {
  id: string;
  fullName: string;
  birthDate: string;
  birthState: string | null;
  formId: string | null;
  localityId: string | null;
  localityName: string | null;
  /** SHA-256 hex of each normalized phone (normalizePhone), never the number itself. */
  phoneHashes: string[];
  /** Last 4 digits only, for visual check on the match card. */
  phoneLast4: string | null;
  version: number;
  /** Set when this record is linked to a main record. */
  linkedToId: string | null;
}

/** Visit history without clinical data. */
export interface PackageVisit {
  id: string;
  patientId: string;
  campaignId: string;
  campaignName: string;
  date: string;
  folio: string | null;
  serviceTypes: ServiceType[];
  /** Block 2b (additive): stations of this visit, so specialists build their queue offline. */
  steps?: VisitStepView[];
  /** Block 2b (additive): ISO time the visit reached the server ("hora de registro"). */
  registeredAt?: string;
}

/** GET /api/campaigns/:id/package (intake and CLINICAL_ROLES). */
export interface CampaignPackage {
  campaign: CampaignView & { localityIds: string[] };
  campaigns: CampaignView[];
  patients: PackagePatient[];
  visits: PackageVisit[];
  generatedAt: string;
  /** generatedAt + 7 days. The device refuses to use an expired package. */
  expiresAt: string;
  /** Opaque cursor to pass to GET /api/sync/pull. */
  cursor: string;
}

/** GET /api/sync/pull?campaignId=&cursor= (intake and CLINICAL_ROLES): changes made by anyone since the cursor. */
export interface PullResponse {
  patients: PackagePatient[];
  visits: PackageVisit[];
  cursor: string;
}

/** GET /api/sync/events: Server-Sent Events, event name "changed", data = { cursor }. */
export interface SyncChangedEvent {
  cursor: string;
}

/** GET /api/campaigns — campaigns for the visit form (current one first). */
export interface CampaignView {
  id: string;
  name: string;
  /** First day, YYYY-MM-DD. */
  date: string;
  /** Last day, YYYY-MM-DD (same as date for a one-day campaign). Additive: multi-day campaigns. */
  endDate: string;
}

// ---------- Block 3b: Excel/CSV import (SPEC 6.7) ----------

/** Identification fields an import row can carry, in template column order. Never clinical. */
export const IMPORT_FIELDS = [
  "fullName",
  "birthDate",
  "birthState",
  "formId",
  "phone",
  "mobile",
  "residence",
  "affiliation",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ImportSource = "TEMPLATE" | "EXCEL" | "MCP";
export type ImportBatchStatus = "OPEN" | "DONE";
export type ImportRowStatus = "NEW" | "POSSIBLE_MATCH" | "INVALID" | "CONFIRMED" | "DISCARDED";
export type ImportRowDecision = "REGISTERED" | "IS_HER" | "DISCARDED";

/** One row's identification values. birthDate is YYYY-MM-DD when valid, else the text as typed. */
export type ImportRowData = Partial<Record<ImportField, string>>;

/** One column of the uploaded file and the field it feeds (null = not imported). */
export interface ImportColumn {
  index: number;
  header: string;
  field: ImportField | null;
  /** Field proposed automatically from the header text; the person confirms or changes it. */
  suggested: ImportField | null;
  /** First non-empty value of the column, shown only while the mapping is pending. */
  example?: string;
}

export interface ImportColumnMapping {
  confirmed: boolean;
  columns: ImportColumn[];
}

/** An earlier row of the same file that looks like the same person. */
export interface ImportSameAsRow {
  rowNumber: number;
  reasons: MatchReason[];
}

export interface ImportRowView {
  id: string;
  rowNumber: number;
  status: ImportRowStatus;
  data: ImportRowData;
  /** Plain Spanish reason when INVALID. */
  reason: string | null;
  /** Existing patients that may be her (same rules as search, SPEC 6.2). */
  candidates: MatchCandidate[];
  sameAsRows: ImportSameAsRow[];
  decision: ImportRowDecision | null;
  patientId: string | null;
  decidedAt: string | null;
}

export interface ImportBatchCounts {
  total: number;
  new: number;
  possibleMatch: number;
  invalid: number;
  confirmed: number;
  discarded: number;
}

export interface ImportBatchSummary {
  id: string;
  source: ImportSource;
  fileName: string | null;
  status: ImportBatchStatus;
  createdAt: string;
  /** True while the column mapping waits for a person (rows are not evaluated yet). */
  needsMapping: boolean;
  counts: ImportBatchCounts;
}

/** GET /api/imports/:id */
export interface ImportBatchView extends ImportBatchSummary {
  mapping: ImportColumnMapping;
  rows: ImportRowView[];
}

/** GET /api/imports */
export interface ImportBatchList {
  batches: ImportBatchSummary[];
}

/** POST /api/imports/:id/mapping body: field per column index (null = do not import). */
export const importMappingSchema = z.object({
  columns: z
    .array(z.object({ index: z.number().int().min(0), field: z.enum(IMPORT_FIELDS).nullable() }))
    .min(1)
    .max(100),
});
export type ImportMappingInput = z.infer<typeof importMappingSchema>;

/** POST /api/imports/:id/rows/:rowId body. */
export const importRowDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register") }),
  z.object({ action: z.literal("isHer"), patientId: z.string().min(1) }),
  z.object({ action: z.literal("discard") }),
]);
export type ImportRowDecisionInput = z.infer<typeof importRowDecisionSchema>;

/** POST /api/imports/:id/register-new response. */
export interface ImportRegisterNewResponse {
  registered: number;
  failed: number;
  batch: ImportBatchView;
}
