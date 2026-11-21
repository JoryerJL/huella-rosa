import { describe, expect, it } from "vitest";
import { decodeCsv, detectDelimiter, parseCsv } from "./csv";
import { headerSimilarity, isTemplateHeaders, mappingProblem, suggestMapping, TEMPLATE_HEADERS } from "./columns";
import { findSameAsRows, parseBirthDate, rowValues, validateRow } from "./rows";

const TODAY = new Date(2026, 10, 21);

describe("parseCsv", () => {
  it("reads quoted fields with commas, escaped quotes and newlines", () => {
    const text = 'NOMBRE,NOTA\r\n"Peña, Irma","dijo ""hola"""\n"Ana\nCruz",x\n';
    expect(parseCsv(text)).toEqual([
      ["NOMBRE", "NOTA"],
      ["Peña, Irma", 'dijo "hola"'],
      ["Ana\nCruz", "x"],
    ]);
  });

  it("keeps the last line without a trailing newline and empty cells", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("detects the semicolon delimiter used by Spanish-locale Excel", () => {
    const text = "NOMBRE;F. NAC\nAna;01/02/1990\n";
    expect(detectDelimiter(text)).toBe(";");
    expect(parseCsv(text)).toEqual([
      ["NOMBRE", "F. NAC"],
      ["Ana", "01/02/1990"],
    ]);
  });

  it("decodes UTF-8 with BOM and falls back to Windows-1252", () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Peña")]);
    expect(decodeCsv(utf8)).toBe("Peña");
    expect(decodeCsv(new Uint8Array([0x50, 0x65, 0xf1, 0x61]))).toBe("Peña");
  });
});

describe("column mapping suggestion", () => {
  it("maps EIRA-style headers to fields and leaves unknown ones out", () => {
    const columns = suggestMapping(["NOMBRE", "F. NAC", "EDO. NAC", "TEL", "LOCALIDAD", "CAPTURÓ"]);
    expect(columns.map((c) => c.suggested)).toEqual(["fullName", "birthDate", "birthState", "phone", "residence", null]);
    expect(columns.every((c) => c.field === c.suggested)).toBe(true);
  });

  it("never suggests the same field for two columns", () => {
    const columns = suggestMapping(["Nombre", "Nombre completo"]);
    expect(columns.filter((c) => c.suggested === "fullName")).toHaveLength(1);
    expect(columns.map((c) => c.suggested)).toEqual(["fullName", null]); // tie: leftmost column wins
  });

  it("matches abbreviations and accents", () => {
    expect(headerSimilarity("Fecha nac.", "fecha de nacimiento")).toBe(1);
    expect(headerSimilarity("TELÉFONO", "telefono")).toBe(1);
    expect(headerSimilarity("Observaciones", "telefono")).toBe(0);
  });

  it("recognizes the template headers exactly", () => {
    expect(isTemplateHeaders(Object.values(TEMPLATE_HEADERS))).toBe(true);
    expect(isTemplateHeaders(["NOMBRE", "F. NAC"])).toBe(false);
  });

  it("requires name and birth date, each field once", () => {
    expect(mappingProblem([{ field: "fullName" }])).toMatch(/fecha de nacimiento/);
    expect(mappingProblem([{ field: "fullName" }, { field: "fullName" }, { field: "birthDate" }])).toMatch(/mismo dato/);
    expect(mappingProblem([{ field: "fullName" }, { field: "birthDate" }, { field: null }])).toBeNull();
  });
});

describe("row validation", () => {
  it("normalizes a valid row", () => {
    const check = validateRow(
      {
        fullName: "Patricia Núñez Salazar",
        birthDate: "14/02/1981",
        formId: "nusp-810214",
        phone: "55-0000-0081",
        mobile: "+52 55 0000 0082",
        affiliation: "imss",
      },
      TODAY,
    );
    expect(check).toEqual({
      valid: true,
      data: {
        fullName: "Patricia Núñez Salazar",
        birthDate: "1981-02-14",
        formId: "NUSP810214",
        phone: "5500000081",
        mobile: "5500000082",
        affiliation: "IMSS",
      },
    });
  });

  it("rejects a date that does not exist with a plain reason", () => {
    const check = validateRow({ fullName: "Carmen Ruelas Pineda", birthDate: "31/02/1990" }, TODAY);
    expect(check.valid).toBe(false);
    expect(!check.valid && check.reason).toBe("La fecha de nacimiento 31/02/1990 no existe en el calendario. Revisa el día y el mes.");
  });

  it("requires name and birth date", () => {
    const check = validateRow({}, TODAY);
    expect(!check.valid && check.reason).toBe("Falta el nombre completo. Falta la fecha de nacimiento.");
  });

  it("checks phone digits, form ID format and future dates", () => {
    const check = validateRow(
      { fullName: "Ana Prueba", birthDate: "01/01/2030", phone: "55-ABC", formId: "123" },
      TODAY,
    );
    expect(check.valid).toBe(false);
    const reason = !check.valid ? check.reason : "";
    expect(reason).toContain("no puede ser correcta");
    expect(reason).toContain("El teléfono fijo solo puede tener números.");
    expect(reason).toContain("El ID del formato debe tener 4 letras y 6 números (por ejemplo RATL900105).");
  });

  it("accepts ISO dates and rejects text", () => {
    expect(parseBirthDate("1972-07-30", TODAY)).toEqual({ date: "1972-07-30" });
    expect("reason" in parseBirthDate("treinta de julio", TODAY)).toBe(true);
  });

  it("takes only mapped columns", () => {
    const data = rowValues(["Ana  Cruz ", "x", "01/02/1990"], [
      { index: 0, header: "N", field: "fullName", suggested: "fullName" },
      { index: 1, header: "Obs", field: null, suggested: null },
      { index: 2, header: "F", field: "birthDate", suggested: "birthDate" },
    ]);
    expect(data).toEqual({ fullName: "Ana Cruz", birthDate: "01/02/1990" });
  });
});

describe("in-file duplicates", () => {
  const earlier = [
    { rowNumber: 2, data: { fullName: "Gabriela Ponce Rivas", birthDate: "1988-05-03", mobile: "5500000091" } },
    { rowNumber: 3, data: { fullName: "Irma Delgado Peña", birthDate: "1975-09-21" } },
  ];

  it("flags an earlier row with the same birth date and a similar name", () => {
    expect(findSameAsRows({ fullName: "Gabriela Rivas Ponce", birthDate: "1988-05-03" }, earlier)).toEqual([
      { rowNumber: 2, reasons: ["SAME_BIRTH_DATE", "SIMILAR_NAME"] },
    ]);
  });

  it("flags the same phone and birth date even with another name", () => {
    const found = findSameAsRows({ fullName: "Gaby P.", birthDate: "1988-05-03", phone: "5500000091" }, earlier);
    expect(found.map((f) => f.rowNumber)).toEqual([2]);
  });

  it("does not flag a similar name alone", () => {
    expect(findSameAsRows({ fullName: "Irma Delgado Peña", birthDate: "1980-01-01" }, earlier)).toEqual([]);
  });
});
