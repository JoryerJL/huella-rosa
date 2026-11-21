import { FOLIO_PATTERN } from "./api";

// Short visit folio "<prefix>-<seq>-<check>", e.g. "B3-017-K" (SPEC 6.3.1).
// The check letter (mod 23 over the sequence number) catches typing mistakes at the stations.

/** 23 letters: no I, O or Y, to avoid confusion with 1, 0 and handwriting. */
export const FOLIO_CHECK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXZ";

export function folioCheckLetter(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) throw new Error("Folio sequence must be a non-negative integer");
  return FOLIO_CHECK_ALPHABET[seq % FOLIO_CHECK_ALPHABET.length]!;
}

/** formatFolio("B3", 17) === "B3-017-" + check letter. */
export function formatFolio(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}-${folioCheckLetter(seq)}`;
}

/** Pattern and check letter. Accepts lowercase/whitespace typed on the tablet. */
export function isValidFolio(folio: string | null | undefined): boolean {
  if (!folio) return false;
  const value = folio.trim().toUpperCase();
  if (!FOLIO_PATTERN.test(value)) return false;
  const [, seqText, check] = value.split("-");
  return folioCheckLetter(Number(seqText)) === check;
}
