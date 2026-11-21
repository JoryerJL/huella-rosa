import { describe, expect, it } from "vitest";
import { nameSimilarity, normalizeName, normalizePhone, scoreCandidate } from "./matching";

// Fictitious data only (CLAUDE.md rule 1).

describe("normalizeName", () => {
  it("lowercases, strips accents and collapses spaces", () => {
    expect(normalizeName("  Lucía   DEMO  Tres ")).toBe("lucia demo tres");
  });
});

describe("normalizePhone", () => {
  it("keeps digits only and the last 10", () => {
    expect(normalizePhone("+52 (55) 0000-0003")).toBe("5500000003");
    expect(normalizePhone(null)).toBe("");
  });
});

describe("nameSimilarity", () => {
  it("ignores surname order", () => {
    expect(nameSimilarity("Ana Prueba Demo", "Ana Demo Prueba")).toBe(1);
  });
});

describe("scoreCandidate", () => {
  it("accent difference + same birth date -> STRONG with SAME_BIRTH_DATE and SIMILAR_NAME", () => {
    const result = scoreCandidate(
      { fullName: "Lucia Demo Tres", birthDate: "1990-01-05" },
      { fullName: "Lucía Demo Tres", birthDate: "1990-01-05" },
    );
    expect(result.strength).toBe("STRONG");
    expect(result.reasons).toEqual(expect.arrayContaining(["SAME_BIRTH_DATE", "SIMILAR_NAME"]));
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("swapped surnames + same birth date -> STRONG", () => {
    const result = scoreCandidate(
      { fullName: "Ana Prueba Demo", birthDate: "1968-11-22" },
      { fullName: "Ana Demo Prueba", birthDate: "1968-11-22" },
    );
    expect(result.strength).toBe("STRONG");
  });

  it("similar name with a different birth date -> WEAK only", () => {
    const result = scoreCandidate(
      { fullName: "Rosa Demo Siete", birthDate: "1995-09-02" },
      { fullName: "Rosa Demo Seis", birthDate: "1979-04-18" },
    );
    expect(result.strength).toBe("WEAK");
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(70);
    expect(result.reasons).toEqual(["SIMILAR_NAME"]);
  });

  it("same formId with a different name -> STRONG with SAME_FORM_ID", () => {
    const result = scoreCandidate(
      { fullName: "Otra Persona Ficticia", birthDate: "2000-01-01", formId: "DEMO0000006" },
      { fullName: "Rosa Demo Seis", birthDate: "1979-04-18", formId: "DEMO0000006" },
    );
    expect(result.strength).toBe("STRONG");
    expect(result.reasons).toContain("SAME_FORM_ID");
  });

  it("same phone + same birth date -> STRONG", () => {
    const result = scoreCandidate(
      { fullName: "Nombre Distinto", birthDate: "1983-12-01", phone: "5500000008" },
      { fullName: "Elena Demo Ocho", birthDate: "1983-12-01", mobile: "55-0000-0008" },
    );
    expect(result.strength).toBe("STRONG");
    expect(result.reasons).toEqual(expect.arrayContaining(["SAME_PHONE", "SAME_BIRTH_DATE"]));
  });

  it("totally different person -> score 0", () => {
    const result = scoreCandidate(
      { fullName: "Carmen Ejemplo Ficticia", birthDate: "2001-02-03", phone: "5511112222", birthState: "Jalisco" },
      { fullName: "Elena Demo Ocho", birthDate: "1983-12-01", mobile: "55-0000-0008", birthState: "Jalisco" },
    );
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });
});
