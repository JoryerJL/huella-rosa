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
  admin: "/admin",
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

// ---------- Staff and campaign administration (SPEC 6.0) ----------

/** Login name rule: lowercase letters, digits and dots, 3 to 40 characters. */
export const USERNAME_PATTERN = /^[a-z0-9.]{3,40}$/;
/** Initial PIN: 4 to 6 digits, told to the person face to face. */
export const PIN_PATTERN = /^\d{4,6}$/;

/** Computed from the campaign dates, never stored: UPCOMING (Próxima), ACTIVE (En curso), FINISHED (Terminada). */
export const CAMPAIGN_STATUSES = ["UPCOMING", "ACTIVE", "FINISHED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Dates are "YYYY-MM-DD" strings, so string comparison is date comparison. */
export function campaignStatus(date: string, endDate: string, today: string): CampaignStatus {
  if (today < date) return "UPCOMING";
  if (today > endDate) return "FINISHED";
  return "ACTIVE";
}

/** Today as "YYYY-MM-DD" in the local time zone of the machine running this code. */
export function localIsoDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Month names for the proposed campaign name. The name is stored data (shown as typed), so the
// same rule must run on the server (default) and in the form (proposal).
const CAMPAIGN_NAME_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "Jornada <municipality> · <month> <year>" from the first day, e.g. "Jornada Valle Ficticio · diciembre 2026". */
export function defaultCampaignName(municipality: string, date: string): string {
  const [year, month] = date.split("-");
  const monthName = CAMPAIGN_NAME_MONTHS[Number(month) - 1] ?? "";
  return `Jornada ${municipality.trim()} · ${monthName} ${year ?? ""}`.trim();
}
