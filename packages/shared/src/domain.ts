// Domain catalogs shared by the field app and the server (see docs/SPEC.md and the glossary in CLAUDE.md).

export const ROLES = ["intake", "clinician", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Landing route for each staff role. */
export const ROLE_HOME: Record<Role, string> = {
  intake: "/intake",
  clinician: "/patients",
  admin: "/admin/audit",
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
