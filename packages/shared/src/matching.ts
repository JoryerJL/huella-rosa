import type { MatchReason, MatchStrength, SearchQuery } from "./api";

// Deterministic patient matching (docs/SPEC.md 6.2). No AI, no external dependencies.
// Runs on the device (offline search over the campaign package) and on the server.

/** Patient data the matcher can compare against. Never clinical. */
export interface MatchSubject {
  fullName: string;
  birthDate: string;
  formId?: string | null;
  phone?: string | null;
  mobile?: string | null;
  birthState?: string | null;
}

export interface MatchScore {
  /** 0-100. 0 means "not a candidate". */
  score: number;
  strength: MatchStrength;
  reasons: MatchReason[];
}

/** Minimum token-set similarity (0-1) for two names to count as "similar". */
export const SIMILAR_NAME_THRESHOLD = 0.6;

const NAME_STOPWORDS = new Set(["de", "del", "la", "las", "los", "y"]);

/** Lowercase, strip accents/diacritics, keep letters and digits, collapse spaces. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalized name tokens without connectors ("de", "la", ...). */
export function nameTokens(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .filter((t) => t.length > 0 && !NAME_STOPWORDS.has(t));
}

/** Digits only, last 10 (drops country code and separators). */
export function normalizePhone(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D+/g, "").slice(-10);
}

function normalizeFormId(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}

function normalizeState(value: string | null | undefined): string {
  return normalizeName(value ?? "");
}

/** Levenshtein distance, early exit when it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/** Two tokens match when equal, or when both are 5+ letters long and differ by one typo. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && editDistance(a, b, 1) <= 1;
}

/**
 * Order-insensitive name similarity (0-1): Dice coefficient over token sets,
 * so "Ana Prueba Demo" and "Ana Demo Prueba" score 1.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = [...new Set(nameTokens(a))];
  const tb = [...new Set(nameTokens(b))];
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Set<number>();
  let matched = 0;
  for (const token of ta) {
    const idx = tb.findIndex((other, i) => !used.has(i) && tokensMatch(token, other));
    if (idx >= 0) {
      used.add(idx);
      matched++;
    }
  }
  return (2 * matched) / (ta.length + tb.length);
}

const WEIGHTS = {
  formId: 60,
  birthDate: 25,
  name: 30, // scaled by similarity
  phone: 20,
  birthState: 5,
} as const;

/** STRONG scores never fall below this; WEAK scores never reach it. */
const STRONG_FLOOR = 70;
const WEAK_CEILING = 60;

/**
 * Scores a candidate against what intake typed (SPEC 6.2):
 * - same formId -> STRONG
 * - same birthDate + similar name -> STRONG
 * - same phone + same birthDate -> STRONG
 * - similar name alone -> WEAK, never STRONG
 * - no signal (name, date, phone or formId) -> score 0, not a candidate.
 * Birth state only supports another signal; it never makes a candidate by itself.
 */
export function scoreCandidate(query: SearchQuery, candidate: MatchSubject): MatchScore {
  const reasons: MatchReason[] = [];
  let raw = 0;

  const qFormId = normalizeFormId(query.formId);
  const sameFormId = qFormId !== "" && qFormId === normalizeFormId(candidate.formId);
  if (sameFormId) {
    reasons.push("SAME_FORM_ID");
    raw += WEIGHTS.formId;
  }

  const sameBirthDate = query.birthDate === candidate.birthDate;
  if (sameBirthDate) {
    reasons.push("SAME_BIRTH_DATE");
    raw += WEIGHTS.birthDate;
  }

  const similarity = nameSimilarity(query.fullName, candidate.fullName);
  const similarName = similarity >= SIMILAR_NAME_THRESHOLD;
  if (similarName) {
    reasons.push("SIMILAR_NAME");
    raw += Math.round(WEIGHTS.name * similarity);
  }

  const qPhone = normalizePhone(query.phone);
  const samePhone =
    qPhone.length >= 7 &&
    (qPhone === normalizePhone(candidate.phone) || qPhone === normalizePhone(candidate.mobile));
  if (samePhone) {
    reasons.push("SAME_PHONE");
    raw += WEIGHTS.phone;
  }

  if (!sameFormId && !sameBirthDate && !similarName && !samePhone) {
    return { score: 0, strength: "WEAK", reasons: [] };
  }

  const qState = normalizeState(query.birthState);
  if (qState !== "" && qState === normalizeState(candidate.birthState)) {
    reasons.push("SAME_BIRTH_STATE");
    raw += WEIGHTS.birthState;
  }

  const strong =
    sameFormId || (sameBirthDate && similarName) || (samePhone && sameBirthDate);
  const score = strong
    ? Math.min(100, Math.max(STRONG_FLOOR, raw))
    : Math.max(1, Math.min(WEAK_CEILING, raw));
  return { score, strength: strong ? "STRONG" : "WEAK", reasons };
}
