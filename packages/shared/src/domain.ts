// Domain catalogs shared by the field app and the server (see docs/SPEC.md and the glossary in CLAUDE.md).

export const ROLES = ["intake", "nutritionist", "doctor", "pathologist", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** "Consulta clínica" in the challenge = these three specialists (SPEC 4, 6.3.1). */
export const CLINICAL_ROLES = ["nutritionist", "doctor", "pathologist"] as const;
export type ClinicalRole = (typeof CLINICAL_ROLES)[number];

export function isClinicalRole(value: unknown): value is ClinicalRole {
  return typeof value === "string" && (CLINICAL_ROLES as readonly string[]).includes(value);
}

/** Landing route for each staff role. */
export const ROLE_HOME: Record<Role, string> = {
  intake: "/intake",
  nutritionist: "/queue",
  doctor: "/queue",
  pathologist: "/queue",
  admin: "/admin/audit",
};

export const STEP_STATUSES = ["PENDING", "DONE", "SKIPPED"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Default planned steps from the services of the day (SPEC 6.3.1 item 1); intake can adjust. */
export const DEFAULT_STEPS_BY_SERVICE: Record<ServiceType, ClinicalRole[]> = {
  BREAST_REVIEW: ["nutritionist", "doctor"],
  ULTRASOUND: ["nutritionist", "doctor"],
  MAMMOGRAPHY: ["nutritionist", "doctor"],
  PAP: ["pathologist"],
};

export const SERVICE_TYPES = ["BREAST_REVIEW", "ULTRASOUND", "PAP", "MAMMOGRAPHY"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_STATUSES = ["DRAFT", "CONFIRMED"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const MATCH_REVIEW_STATUSES = ["OPEN", "LINKED", "DISMISSED"] as const;
export type MatchReviewStatus = (typeof MATCH_REVIEW_STATUSES)[number];

export const CONFLICT_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export const FORM_SCAN_STATUSES = ["QUEUED", "READ", "CONFIRMED", "FAILED"] as const;
export type FormScanStatus = (typeof FORM_SCAN_STATUSES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Public profile of a signed-in staff member. */
export interface StaffProfile {
  id: string;
  name: string;
  role: Role;
}
