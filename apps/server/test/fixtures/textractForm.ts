import type { Block } from "@aws-sdk/client-textract";

// Synthetic AnalyzeDocument (FORMS) page of the breast review form, fictitious data only.
// Positions (0-1 of the page) were measured on the test photos of docs/OCR-PRUEBAS.md: the
// "Día __ Mes __ Año ____" boxes of "5. Fecha de nacimiento", the "1. Fecha de atención" table
// (values under their headers) and the "8. Teléfono fijo ___ Celular ___" row. Labels are
// PRINTED words; filled-in values are HANDWRITING words.

type Rect = [left: number, top: number, width: number, height: number];

export interface FormOptions {
  /** How Textract grouped the birth date row. */
  birthRow?: "keys" | "labelKey" | "words";
  birthDay?: string;
  birthMonth?: string;
  /** Several entries = a corrected year (crossed out, rewritten next to it). */
  birthYear?: string[];
  /** Word confidence (0-100) of the handwritten birth date values. */
  birthConfidence?: number;
  /** Word confidence (0-100) of the handwritten name. */
  nameConfidence?: number;
  nameTextType?: "HANDWRITING" | "PRINTED";
  /** Mobile inside its value box, written above the line outside it, or absent. */
  mobile?: { text: string; placement: "inBox" | "aboveLine" } | null;
}

export function breastReviewPage(opts: FormOptions = {}): Block[] {
  let n = 0;
  const blocks: Block[] = [];
  const geometry = ([left, top, width, height]: Rect) => ({ BoundingBox: { Left: left, Top: top, Width: width, Height: height } });
  const word = (text: string, rect: Rect, handwriting = false, conf = 99): Block => {
    const b: Block = { BlockType: "WORD", Id: `w${++n}`, Text: text, Confidence: conf, TextType: handwriting ? "HANDWRITING" : "PRINTED", Geometry: geometry(rect) };
    blocks.push(b);
    return b;
  };
  const line = (text: string, rect: Rect, words: Block[]) =>
    blocks.push({ BlockType: "LINE", Id: `l${++n}`, Text: text, Confidence: 99, Geometry: geometry(rect), Relationships: [{ Type: "CHILD", Ids: words.map((w) => w.Id!) }] });
  const pair = (keyWords: Block[], keyRect: Rect, valueWords: Block[], valueRect: Rect, pairConf = 90) => {
    const keyId = `k${++n}`;
    const valueId = `v${++n}`;
    blocks.push(
      { BlockType: "KEY_VALUE_SET", Id: keyId, EntityTypes: ["KEY"], Confidence: pairConf, Geometry: geometry(keyRect), Relationships: [{ Type: "VALUE", Ids: [valueId] }, { Type: "CHILD", Ids: keyWords.map((w) => w.Id!) }] },
      { BlockType: "KEY_VALUE_SET", Id: valueId, EntityTypes: ["VALUE"], Confidence: pairConf, Geometry: geometry(valueRect), Relationships: valueWords.length ? [{ Type: "CHILD", Ids: valueWords.map((w) => w.Id!) }] : [] },
    );
  };

  // 1. Fecha de atención: a table, values under the Día / Mes / Año headers.
  const att = [word("1.Fecha", [0.487, 0.25, 0.06, 0.014]), word("de", [0.55, 0.25, 0.015, 0.014]), word("atención", [0.57, 0.25, 0.065, 0.014])];
  line("1.Fecha de atención", [0.487, 0.25, 0.148, 0.014], att);
  for (const [label, value, left] of [["Día", "21", 0.65], ["Mes", "11", 0.73], ["Año", "2026", 0.836]] as const) {
    const k = word(label, [left, 0.25, 0.03, 0.012]);
    const v = word(value, [left + 0.02, 0.264, 0.04, 0.018], true, 97);
    pair([k], [left, 0.25, 0.03, 0.012], [v], [left + 0.02, 0.264, 0.04, 0.018]);
  }

  // 2. Nombre
  const nameKey = [word("2.", [0.083, 0.307, 0.012, 0.014]), word("Nombre", [0.097, 0.307, 0.05, 0.014])];
  const handName = (opts.nameTextType ?? "HANDWRITING") === "HANDWRITING";
  const nameConf = opts.nameConfidence ?? 97;
  const name = [
    word("Lucía", [0.175, 0.302, 0.055, 0.018], handName, nameConf),
    word("Ramírez", [0.25, 0.302, 0.08, 0.018], handName, 99),
    word("Torres", [0.355, 0.302, 0.07, 0.018], handName, 99),
  ];
  pair(nameKey, [0.083, 0.307, 0.064, 0.014], name, [0.175, 0.302, 0.25, 0.018], 95);

  // 5. Fecha de nacimiento  Día __ Mes __ Año ____   6. Edad en años __
  const label = [word("5.", [0.083, 0.359, 0.015, 0.014]), word("Fecha", [0.1, 0.359, 0.04, 0.014]), word("de", [0.143, 0.359, 0.015, 0.014]), word("nacimiento", [0.16, 0.359, 0.085, 0.014])];
  line("5. Fecha de nacimiento", [0.083, 0.359, 0.162, 0.014], label);
  const conf = opts.birthConfidence ?? 98;
  const dia = word("Día", [0.25, 0.359, 0.025, 0.014]);
  const day = word(opts.birthDay ?? "05", [0.278, 0.355, 0.025, 0.016], true, conf);
  const mes = word("Mes", [0.32, 0.359, 0.03, 0.014]);
  const month = word(opts.birthMonth ?? "01", [0.355, 0.355, 0.025, 0.016], true, conf);
  const ano = word("Año", [0.396, 0.359, 0.03, 0.014]);
  const years = (opts.birthYear ?? ["1990"]).map((y, i) => word(y, [0.43 + i * 0.05, 0.355, 0.045, 0.016], true, conf));
  const shift = (years.length - 1) * 0.05;
  word("6.", [0.495 + shift, 0.359, 0.012, 0.014]);
  word("Edad", [0.51 + shift, 0.359, 0.035, 0.014]);
  word("años", [0.55 + shift, 0.359, 0.035, 0.014]);
  word("36", [0.6 + shift, 0.355, 0.025, 0.016], true, conf);
  if (opts.birthRow === "keys" || opts.birthRow === undefined) {
    pair([dia], [0.25, 0.359, 0.025, 0.014], [day], [0.278, 0.355, 0.025, 0.016]);
    pair([mes], [0.32, 0.359, 0.03, 0.014], [month], [0.355, 0.355, 0.025, 0.016]);
    pair([ano], [0.396, 0.359, 0.03, 0.014], years, [0.43, 0.355, 0.045 * years.length, 0.016]);
  } else if (opts.birthRow === "labelKey") {
    pair([...label, dia], [0.083, 0.359, 0.192, 0.014], [day], [0.278, 0.355, 0.025, 0.016]);
    pair([mes], [0.32, 0.359, 0.03, 0.014], [month], [0.355, 0.355, 0.025, 0.016]);
    pair([ano], [0.396, 0.359, 0.03, 0.014], years, [0.43, 0.355, 0.045 * years.length, 0.016]);
  }

  // 8. Teléfono fijo ________  Celular ________
  const fijo = [word("8.", [0.083, 0.441, 0.012, 0.014]), word("Teléfono", [0.098, 0.441, 0.06, 0.014]), word("fijo", [0.16, 0.441, 0.025, 0.014])];
  pair(fijo, [0.083, 0.441, 0.103, 0.014], [], [0.19, 0.441, 0.19, 0.014]);
  const celular = word("Celular", [0.397, 0.441, 0.055, 0.014]);
  const mobile = opts.mobile === undefined ? { text: "55-0000-0003", placement: "inBox" as const } : opts.mobile;
  if (mobile?.placement === "inBox") {
    const v = word(mobile.text, [0.47, 0.437, 0.13, 0.018], true, 96);
    pair([celular], [0.397, 0.441, 0.055, 0.014], [v], [0.455, 0.437, 0.2, 0.018]);
  } else {
    pair([celular], [0.397, 0.441, 0.055, 0.014], [], [0.455, 0.441, 0.2, 0.014]);
    if (mobile) word(mobile.text, [0.49, 0.426, 0.13, 0.018], true, 96);
  }
  return blocks;
}
