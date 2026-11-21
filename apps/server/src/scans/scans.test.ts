import { describe, expect, it } from "vitest";
import type { Block } from "@aws-sdk/client-textract";
import { LOW_CONFIDENCE } from "@er/shared";
import { getTemplate, type Template } from "../templates";
import { filterForRole, visibleKeys } from "./fields";
import { readMock, sampleNameFor } from "./ocr";
import { mapTextractBlocks, normalizeLabel, toIsoDate } from "./textractMapping";
import { rolesToConfirm } from "../routes/scans";

const template = getTemplate("revision-mamaria-eira") as Template;
const bytes = new Uint8Array();
const NO_TRANSCRIBE = template.campos.filter((f) => f.no_transcribir).map((f) => f.clave);
const IDENTIFICATION = template.campos.filter((f) => f.identificacion).map((f) => f.clave);
const ownedBy = (role: string) => template.campos.filter((f) => f.filledBy === role && !f.no_transcribir).map((f) => f.clave);

describe("mock OCR", () => {
  it("matches the sample by original file name", () => {
    expect(sampleNameFor("formato-01.svg")).toBe("formato-01");
    expect(sampleNameFor("IMG Formato-03 (1).jpg")).toBe("formato-03");
    expect(sampleNameFor("photo.jpg")).toBeNull();
  });

  it("reads formato-01 (recurring patient) with its expected values", async () => {
    const read = await readMock({ bytes, originalName: "formato-01.jpg", template });
    expect(read.fullName).toEqual({ value: "Lucía Ramírez Torres", confidence: 0.96 });
    expect(read.birthDate?.value).toBe("1990-01-05");
    expect(read.mobile?.value).toBe("55-0000-0003");
    expect(read.formId?.value).toBe("RATL900105");
  });

  it("never proposes no_transcribir fields", async () => {
    for (const name of ["formato-01.svg", "formato-02.svg", "formato-03.svg", "unknown.jpg"]) {
      const read = await readMock({ bytes, originalName: name, template });
      for (const key of NO_TRANSCRIBE) expect(read).not.toHaveProperty(key);
    }
  });

  it("formato-03 has one identification field with low confidence", async () => {
    const read = await readMock({ bytes, originalName: "formato-03.svg", template });
    const low = IDENTIFICATION.filter((k) => read[k] && read[k]!.value && read[k]!.confidence < LOW_CONFIDENCE);
    expect(low).toEqual(["birthDate"]);
  });

  it("returns every field empty with confidence 0 for an unknown photo", async () => {
    const read = await readMock({ bytes, originalName: "IMG_2041.jpg", template });
    expect(Object.keys(read).length).toBe(template.campos.length - NO_TRANSCRIBE.length);
    expect(Object.values(read).every((v) => v.value === "" && v.confidence === 0)).toBe(true);
  });
});

describe("role filtering", () => {
  it("intake gets identification fields only, never clinical ones", async () => {
    const read = await readMock({ bytes, originalName: "formato-01.svg", template });
    const keys = Object.keys(filterForRole(read, template, "intake")).sort();
    expect(keys).toEqual([...IDENTIFICATION].sort());
    for (const key of [...ownedBy("doctor"), ...ownedBy("nutritionist")]) expect(keys).not.toContain(key);
  });

  it("a specialist gets only its own fields plus identification", async () => {
    const read = await readMock({ bytes, originalName: "formato-01.svg", template });
    const doctor = Object.keys(filterForRole(read, template, "doctor"));
    expect(doctor).toContain("birads");
    expect(doctor).toContain("fullName");
    expect(doctor).not.toContain("weight");
    const nutritionist = Object.keys(filterForRole(read, template, "nutritionist"));
    expect(nutritionist).toContain("weight");
    expect(nutritionist).not.toContain("birads");
  });

  it("admin sees no read values", () => {
    expect(visibleKeys(template, "admin").size).toBe(0);
  });

  it("asks each role with read values to confirm; intake only when no visit is linked", async () => {
    const read = await readMock({ bytes, originalName: "formato-01.svg", template });
    expect(rolesToConfirm(read, template, false)).toEqual(["intake", "nutritionist", "doctor"]);
    expect(rolesToConfirm(read, template, true)).toEqual(["nutritionist", "doctor"]);
  });
});

describe("Textract mapping (recorded fake response, no AWS call)", () => {
  // Shape of AnalyzeDocument FORMS output: KEY and VALUE blocks pointing at WORD blocks.
  const word = (id: string, text: string): Block => ({ BlockType: "WORD", Id: id, Text: text });
  const kv = (keyId: string, valueId: string, keyWords: string[], valueWords: string[], conf: [number, number]): Block[] => [
    { BlockType: "KEY_VALUE_SET", Id: keyId, EntityTypes: ["KEY"], Confidence: conf[0], Relationships: [{ Type: "VALUE", Ids: [valueId] }, { Type: "CHILD", Ids: keyWords }] },
    { BlockType: "KEY_VALUE_SET", Id: valueId, EntityTypes: ["VALUE"], Confidence: conf[1], Relationships: [{ Type: "CHILD", Ids: valueWords }] },
  ];
  const blocks: Block[] = [
    word("w1", "2."), word("w2", "Nombre:"), word("w3", "Lucía"), word("w4", "Ramírez"), word("w5", "Torres"),
    ...kv("k1", "v1", ["w1", "w2"], ["w3", "w4", "w5"], [98, 95]),
    word("w6", "5."), word("w7", "Fecha"), word("w8", "de"), word("w9", "nacimiento"), word("w10", "05/01/1990"),
    ...kv("k2", "v2", ["w6", "w7", "w8", "w9"], ["w10"], [97, 62]),
    word("w11", "22."), word("w12", "BIRADS"), word("w13", "1"),
    ...kv("k3", "v3", ["w11", "w12"], ["w13"], [96, 90]),
    word("w14", "Notas"), word("w15", "texto"), word("w16", "manuscrito"),
    ...kv("k4", "v4", ["w14"], ["w15", "w16"], [95, 90]),
    word("w17", "Campo"), word("w18", "desconocido"), word("w19", "x"),
    ...kv("k5", "v5", ["w17", "w18"], ["w19"], [95, 90]),
  ];

  it("maps key labels to template keys, normalizing dates and confidence", () => {
    const read = mapTextractBlocks(blocks, template);
    expect(read.fullName).toEqual({ value: "Lucía Ramírez Torres", confidence: 0.95 });
    expect(read.birthDate).toEqual({ value: "1990-01-05", confidence: 0.62 });
    expect(read.birads).toEqual({ value: "1", confidence: 0.9 });
  });

  it("skips no_transcribir fields and unknown labels", () => {
    const read = mapTextractBlocks(blocks, template);
    expect(read).not.toHaveProperty("notes");
    expect(Object.keys(read).sort()).toEqual(["birads", "birthDate", "fullName"]);
  });

  it("normalizes labels and paper dates", () => {
    expect(normalizeLabel("16.1 Fecha de última mastografía:")).toBe("fecha de ultima mastografia");
    expect(toIsoDate("5/1/1990")).toBe("1990-01-05");
    expect(toIsoDate("0?/02/1975")).toBe("0?/02/1975");
  });
});
