import { describe, expect, it } from "vitest";
import { hashPhone, nameSimilarity, normalizeName, normalizePhone, scoreCandidate } from "./matching";

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
    expect(nameSimilarity("Ana Cruz Sánchez", "Ana Sánchez Cruz")).toBe(1);
  });
});

describe("scoreCandidate", () => {
  it("accent difference + same birth date -> STRONG with SAME_BIRTH_DATE and SIMILAR_NAME", () => {
    const result = scoreCandidate(
      { fullName: "Lucia Ramirez Torres", birthDate: "1990-01-05" },
      { fullName: "Lucía Ramírez Torres", birthDate: "1990-01-05" },
    );
    expect(result.strength).toBe("STRONG");
    expect(result.reasons).toEqual(expect.arrayContaining(["SAME_BIRTH_DATE", "SIMILAR_NAME"]));
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("swapped surnames + same birth date -> STRONG", () => {
    const result = scoreCandidate(
      { fullName: "Ana Cruz Sánchez", birthDate: "1968-11-22" },
      { fullName: "Ana Sánchez Cruz", birthDate: "1968-11-22" },
    );
    expect(result.strength).toBe("STRONG");
  });

  it("similar name with a different birth date -> WEAK only", () => {
    const result = scoreCandidate(
      { fullName: "Rosa Flores Mendoza", birthDate: "1995-09-02" },
      { fullName: "Rosa Flores Morales", birthDate: "1979-04-18" },
    );
    expect(result.strength).toBe("WEAK");
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(70);
    expect(result.reasons).toEqual(["SIMILAR_NAME"]);
  });

  it("same formId with a different name -> STRONG with SAME_FORM_ID", () => {
    const result = scoreCandidate(
      { fullName: "Otra Persona Ficticia", birthDate: "2000-01-01", formId: "DEMO0000006" },
      { fullName: "Rosa Flores Morales", birthDate: "1979-04-18", formId: "DEMO0000006" },
    );
    expect(result.strength).toBe("STRONG");
    expect(result.reasons).toContain("SAME_FORM_ID");
  });

  it("same phone + same birth date -> STRONG", () => {
    const result = scoreCandidate(
      { fullName: "Nombre Distinto", birthDate: "1983-12-01", phone: "5500000008" },
      { fullName: "Elena Gómez Vázquez", birthDate: "1983-12-01", mobile: "55-0000-0008" },
    );
    expect(result.strength).toBe("STRONG");
    expect(result.reasons).toEqual(expect.arrayContaining(["SAME_PHONE", "SAME_BIRTH_DATE"]));
  });

  it("totally different person -> score 0", () => {
    const result = scoreCandidate(
      { fullName: "Carmen Ejemplo Ficticia", birthDate: "2001-02-03", phone: "5511112222", birthState: "Jalisco" },
      { fullName: "Elena Gómez Vázquez", birthDate: "1983-12-01", mobile: "55-0000-0008", birthState: "Jalisco" },
    );
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });
});

describe("hashPhone", () => {
  it("hashes the normalized phone as SHA-256 hex, so formatting does not matter", async () => {
    const a = await hashPhone("+52 (55) 0000-0003");
    const b = await hashPhone("55-0000-0003");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toContain("5500000003");
  });

  it("returns an empty string when there are too few digits to identify anyone", async () => {
    expect(await hashPhone(null)).toBe("");
    expect(await hashPhone("12-34")).toBe("");
  });
});

describe("scoreCandidate with phone hashes (offline package)", () => {
  it("same phone formatted differently + same birth date -> STRONG with SAME_PHONE via hashes", async () => {
    const candidate = {
      fullName: "Elena Gómez Vázquez",
      birthDate: "1983-12-01",
      phoneHashes: [await hashPhone("55-0000-0008")],
    };
    const query = { fullName: "Nombre Distinto", birthDate: "1983-12-01", phone: "+52 55 0000 0008" };
    const result = scoreCandidate(query, candidate, await hashPhone(query.phone));
    expect(result.strength).toBe("STRONG");
    expect(result.reasons).toEqual(expect.arrayContaining(["SAME_PHONE", "SAME_BIRTH_DATE"]));
  });

  it("different phone hash -> no SAME_PHONE", async () => {
    const result = scoreCandidate(
      { fullName: "Nombre Distinto", birthDate: "1983-12-01", phone: "5511112222" },
      { fullName: "Elena Gómez Vázquez", birthDate: "1983-12-01", phoneHashes: [await hashPhone("5500000008")] },
      await hashPhone("5511112222"),
    );
    expect(result.reasons).not.toContain("SAME_PHONE");
    expect(result.strength).toBe("WEAK");
  });

  it("without a query hash, plain phone matching still works as before", () => {
    const result = scoreCandidate(
      { fullName: "Nombre Distinto", birthDate: "1983-12-01", phone: "5500000008" },
      { fullName: "Elena Gómez Vázquez", birthDate: "1983-12-01", mobile: "55-0000-0008", phoneHashes: [] },
    );
    expect(result.reasons).toContain("SAME_PHONE");
  });
});
