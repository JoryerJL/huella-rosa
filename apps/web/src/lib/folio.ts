import { FOLIO_PATTERN } from "@er/shared";

// TODO(block 2b integration): replace with the shared helpers from packages/shared/src/folio.ts
// (folioCheckLetter, formatFolio, isValidFolio) once that commit is merged. Same rule, same output.
// Short visit folio "<prefix>-<seq>-<check>", e.g. "B3-017-K" (SPEC 6.3.1).

/** 23 letters: no I, O or Y, to avoid confusion with 1, 0 and handwriting. */
export const FOLIO_CHECK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXZ";

export function folioCheckLetter(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) throw new Error("Folio sequence must be a non-negative integer");
  return FOLIO_CHECK_ALPHABET[seq % FOLIO_CHECK_ALPHABET.length]!;
}

export function formatFolio(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}-${folioCheckLetter(seq)}`;
}

/** Uppercase and trimmed, as stored and sent. */
export function normalizeFolio(folio: string): string {
  return folio.trim().toUpperCase();
}

/** Pattern and check letter. Accepts lowercase/whitespace typed on the tablet. */
export function isValidFolio(folio: string | null | undefined): boolean {
  if (!folio) return false;
  const value = normalizeFolio(folio);
  if (!FOLIO_PATTERN.test(value)) return false;
  const [, seqText, check] = value.split("-");
  return folioCheckLetter(Number(seqText)) === check;
}
