import { describe, expect, it } from "vitest";
import { folioCheckLetter, formatFolio, isValidFolio } from "./folio";

describe("folio", () => {
  it("computes the check letter as mod 23 over the sequence", () => {
    expect(folioCheckLetter(0)).toBe("A");
    expect(folioCheckLetter(17)).toBe("T");
    expect(folioCheckLetter(23)).toBe("A");
    expect(folioCheckLetter(22)).toBe("Z");
  });

  it("formats prefix, padded sequence and check letter", () => {
    expect(formatFolio("B3", 17)).toBe("B3-017-T");
    expect(formatFolio("S1", 1234)).toBe(`S1-1234-${folioCheckLetter(1234)}`);
  });

  it("accepts a valid folio", () => {
    expect(isValidFolio("B3-017-T")).toBe(true);
    expect(isValidFolio(formatFolio("Z9", 999))).toBe(true);
    expect(isValidFolio(" b3-017-t ")).toBe(true);
  });

  it("rejects a wrong check letter", () => {
    expect(isValidFolio("B3-017-K")).toBe(false);
    expect(isValidFolio("B3-018-T")).toBe(false);
  });

  it("rejects a wrong pattern", () => {
    expect(isValidFolio("B-017-T")).toBe(false);
    expect(isValidFolio("B3-17-T")).toBe(false);
    expect(isValidFolio("B3017T")).toBe(false);
    expect(isValidFolio("")).toBe(false);
    expect(isValidFolio(null)).toBe(false);
  });
});
