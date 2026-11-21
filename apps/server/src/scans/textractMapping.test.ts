import { describe, expect, it } from "vitest";
import { LOW_CONFIDENCE } from "@er/shared";
import { getTemplate, type Template } from "../templates";
import { breastReviewPage } from "../../test/fixtures/textractForm";
import { dateFromParts, DOUBTFUL_CONFIDENCE, mapTextractBlocks, NEARBY_VALUE_CONFIDENCE } from "./textractMapping";

// Replays a synthetic Textract page laid out like the test photos (no AWS call, no cost).

const template = getTemplate("revision-mamaria-eira") as Template;
const TODAY = new Date(2026, 10, 21);
const read = (opts: Parameters<typeof breastReviewPage>[0] = {}) => mapTextractBlocks(breastReviewPage(opts), template, TODAY);

describe("dates printed as Día / Mes / Año boxes", () => {
  it("builds the birth date from the Día, Mes and Año keys on its row", () => {
    const r = read({ birthRow: "keys" });
    expect(r.birthDate?.value).toBe("1990-01-05");
    expect(r.birthDate!.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
  });

  it("works when Textract glues the label to the first key", () => {
    expect(read({ birthRow: "labelKey" }).birthDate?.value).toBe("1990-01-05");
  });

  it("reads the row's words when Textract made no key-value pairs, stopping at '6. Edad en años'", () => {
    const r = read({ birthRow: "words" });
    expect(r.birthDate?.value).toBe("1990-01-05");
    expect(r.birthDate!.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
  });

  it("builds the attendance date from the table, values under each header", () => {
    expect(read().attendanceDate?.value).toBe("2026-11-21");
  });

  it("a corrected year (two numbers in the Año box) is proposed with low confidence", () => {
    for (const birthRow of ["keys", "words"] as const) {
      const r = read({ birthRow, birthDay: "02", birthMonth: "09", birthYear: ["1993", "1995"] });
      expect(r.birthDate?.value).toBe("1995-09-02");
      expect(r.birthDate!.confidence).toBeLessThanOrEqual(DOUBTFUL_CONFIDENCE);
    }
  });

  it("an impossible date keeps what was read and is marked low, never guessed", () => {
    const month13 = read({ birthMonth: "13" }).birthDate!;
    expect(month13).toEqual({ value: "05/13/1990", confidence: DOUBTFUL_CONFIDENCE });
    const future = read({ birthYear: ["2030"] }).birthDate!;
    expect(future.value).toBe("05/01/2030");
    expect(future.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("doubtful handwriting in the date turns amber", () => {
    expect(read({ birthConfidence: 85 }).birthDate!.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("dateFromParts: two-digit years pivot on the current year; impossible dates are rejected", () => {
    expect(dateFromParts("5", "1", "90", TODAY)).toEqual({ value: "1990-01-05", valid: true });
    expect(dateFromParts("5", "1", "05", TODAY)).toEqual({ value: "2005-01-05", valid: true });
    expect(dateFromParts("21", "11", "26", TODAY)).toEqual({ value: "2026-11-21", valid: true });
    expect(dateFromParts("22", "11", "26", TODAY).valid).toBe(false); // tomorrow
    expect(dateFromParts("30", "02", "1990", TODAY)).toEqual({ value: "30/02/1990", valid: false });
    expect(dateFromParts("05", "01", "1890", TODAY).valid).toBe(false);
    expect(dateFromParts("05", "", "1990", TODAY)).toEqual({ value: "05//1990", valid: false });
  });
});

describe("confidence from the words of the value", () => {
  it("doubtful handwriting turns amber even when the key-value pair is confident", () => {
    expect(read({ nameConfidence: 88 }).fullName!.confidence).toBeLessThan(LOW_CONFIDENCE);
    expect(read({ nameConfidence: 95 }).fullName!.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
  });

  it("printed text keeps its own confidence", () => {
    expect(read({ nameConfidence: 88, nameTextType: "PRINTED" }).fullName).toEqual({ value: "Lucía Ramírez Torres", confidence: 0.88 });
  });
});

describe("mobile number", () => {
  it("in its box: read as written, without a stray trailing dash", () => {
    const r = read({ mobile: { text: "55-0000-0040 -", placement: "inBox" } });
    expect(r.mobile?.value).toBe("55-0000-0040");
    expect(r.mobile!.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
  });

  it("written above the line: found next to its key and shown for review", () => {
    const r = read({ mobile: { text: "55-0000-0001", placement: "aboveLine" } });
    expect(r.mobile?.value).toBe("55-0000-0001");
    expect(r.mobile!.confidence).toBeLessThanOrEqual(NEARBY_VALUE_CONFIDENCE);
    expect(r.phone?.value).toBe(""); // the "Teléfono fijo" box stays empty: "Celular" bounds it
  });

  it("absent: stays empty", () => {
    const r = read({ mobile: null });
    expect(r.mobile?.value).toBe("");
    expect(r.phone?.value).toBe("");
  });
});
