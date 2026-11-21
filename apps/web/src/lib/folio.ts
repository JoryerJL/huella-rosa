import {
  FOLIO_CHECK_ALPHABET,
  folioCheckLetter,
  formatFolio,
  isValidFolio as sharedIsValidFolio,
} from "@er/shared";

// Short visit folio "<prefix>-<seq>-<check>", e.g. "B3-017-K" (SPEC 6.3.1). Rules live in @er/shared.
export { FOLIO_CHECK_ALPHABET, folioCheckLetter, formatFolio };

/** Uppercase and trimmed, as stored and sent. */
export function normalizeFolio(folio: string): string {
  return folio.trim().toUpperCase();
}

/** Pattern and check letter. Accepts lowercase/whitespace typed on the tablet. */
export function isValidFolio(folio: string | null | undefined): boolean {
  if (!folio) return false;
  return sharedIsValidFolio(normalizeFolio(folio));
}
