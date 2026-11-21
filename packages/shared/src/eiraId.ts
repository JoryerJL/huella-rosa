// EIRA ID: the "4. ID" field of the paper form (docs/SPEC.md 6.1.1).
// It is NOT the internal key: two patients can share it and it changes when the name is corrected.
// The internal key stays the device UUID, which is never shown.

/** Words skipped when taking initials (SPEC 6.1.1). */
const PARTICLES = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y"]);

export interface EiraIdParts {
  givenNames?: string | null;
  paternalSurname?: string | null;
  maternalSurname?: string | null;
  /** "YYYY-MM-DD". */
  birthDate?: string | null;
}

/** Uppercase letters A-Z only, accents removed, Ñ -> X. */
function lettersOnly(value: string): string {
  return value
    .toUpperCase()
    .replace(/Ñ/g, "X")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z\s]/g, " ");
}

/** Name tokens without particles ("de", "del", "la", "las", "los", "y"). */
function meaningfulTokens(value: string | null | undefined): string[] {
  return lettersOnly(value ?? "")
    .split(/\s+/)
    .filter((token) => token !== "" && !PARTICLES.has(token));
}

/** "YYYY-MM-DD" -> "YYMMDD", or "" when the date is not complete. */
function dateDigits(birthDate: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((birthDate ?? "").trim());
  if (!match) return "";
  return `${match[1]!.slice(2)}${match[2]}${match[3]}`;
}

/**
 * Proposes the EIRA ID: 2 letters of the paternal surname, 1 of the maternal surname (X when
 * missing), 1 of the first given name, then YYMMDD. Example: Lucía Ramírez Torres, 1990-01-05
 * -> "RATL900105". Returns "" when the paternal surname, given name or date is missing.
 */
export function buildEiraId(parts: EiraIdParts): string {
  const paternal = meaningfulTokens(parts.paternalSurname).join("");
  const maternal = meaningfulTokens(parts.maternalSurname).join("");
  const given = meaningfulTokens(parts.givenNames)[0] ?? "";
  const date = dateDigits(parts.birthDate);
  if (paternal === "" || given === "" || date === "") return "";
  const paternalLetters = paternal.slice(0, 2).padEnd(2, "X");
  const maternalLetter = maternal.charAt(0) || "X";
  return `${paternalLetters}${maternalLetter}${given.charAt(0)}${date}`;
}

/** 4 letters + 6 digits, plus one optional character for the 11th box of the paper form. */
export function isEiraIdLike(value: string | null | undefined): boolean {
  return /^[A-Z]{4}\d{6}[A-Z0-9]?$/.test((value ?? "").trim().toUpperCase());
}

/** Joins the name parts into the single fullName the rest of the app keeps using. */
export function joinNameParts(parts: Pick<EiraIdParts, "givenNames" | "paternalSurname" | "maternalSurname">): string {
  return [parts.givenNames, parts.paternalSurname, parts.maternalSurname]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(" ");
}

export interface NameParts {
  givenNames: string;
  paternalSurname: string;
  maternalSurname: string;
}

/**
 * Best-effort split of a typed full name into parts, only to prefill the separate fields (the person
 * corrects them). Particles stay with the next word: "Ana de la Cruz" -> Ana / de la Cruz.
 * 1 unit -> given; 2 -> given + paternal; 3 or more -> the last two are the surnames.
 */
export function splitFullName(fullName: string): NameParts {
  const units: string[] = [];
  let pending: string[] = [];
  for (const word of fullName.trim().split(/\s+/).filter(Boolean)) {
    pending.push(word);
    if (!PARTICLES.has(lettersOnly(word).trim())) {
      units.push(pending.join(" "));
      pending = [];
    }
  }
  if (pending.length > 0) units.push(pending.join(" "));
  if (units.length <= 1) return { givenNames: units[0] ?? "", paternalSurname: "", maternalSurname: "" };
  if (units.length === 2) return { givenNames: units[0]!, paternalSurname: units[1]!, maternalSurname: "" };
  return {
    givenNames: units.slice(0, -2).join(" "),
    paternalSurname: units[units.length - 2]!,
    maternalSurname: units[units.length - 1]!,
  };
}

// ---------- Readable record URLs: /patients/<EIRA ID>-<4 chars of the UUID> ----------

const NO_ID = "SINID";
const SLUG_PATTERN = /^([A-Z0-9]+)-([0-9a-f]{4})$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function slugIdPart(formId: string | null | undefined): string {
  const cleaned = (formId ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned === "" ? NO_ID : cleaned;
}

/** Readable slug for a patient record, e.g. "RATL900105-3f2a" (or "SINID-3f2a" without an EIRA ID). */
export function patientSlug(patient: { id: string; formId?: string | null }): string {
  return `${slugIdPart(patient.formId)}-${patient.id.slice(0, 4).toLowerCase()}`;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export interface ParsedPatientSlug {
  /** Cleaned EIRA ID part, or "SINID". */
  idPart: string;
  /** First 4 characters of the internal UUID (lowercase). */
  uuidPrefix: string;
}

export function parsePatientSlug(slug: string): ParsedPatientSlug | null {
  const match = SLUG_PATTERN.exec(slug.trim());
  if (!match) return null;
  return { idPart: match[1]!.toUpperCase(), uuidPrefix: match[2]!.toLowerCase() };
}

/**
 * Picks the patient a slug points to among candidates whose id starts with the slug's UUID prefix.
 * Prefers the one whose current EIRA ID matches; falls back to a unique prefix match, so a link
 * keeps working after the EIRA ID is corrected.
 */
export function pickBySlug<T extends { id: string; formId?: string | null }>(
  slug: string,
  candidates: T[],
): T | null {
  const parsed = parsePatientSlug(slug);
  if (!parsed) return null;
  const byPrefix = candidates.filter((c) => c.id.toLowerCase().startsWith(parsed.uuidPrefix));
  const exact = byPrefix.find((c) => slugIdPart(c.formId) === parsed.idPart);
  if (exact) return exact;
  return byPrefix.length === 1 ? byPrefix[0]! : null;
}
