import type { Block } from "@aws-sdk/client-textract";
import { LOW_CONFIDENCE } from "@er/shared";
import type { Template, TemplateField } from "../templates";
import type { Extraction } from "./fields";

// Maps an AnalyzeDocument (FORMS) response to template keys by matching each KEY label to the
// field's `etiqueta`. Pure: no AWS call. It only copies what was printed or typed in a box;
// it never interprets clinical text, and `no_transcribir` fields are skipped.
//
// Paper dates are three boxes on one row ("5. Fecha de nacimiento  Día __ Mes __ Año ____"), so a
// date field is also assembled from the Día/Mes/Año keys on the row of its label. Confidence comes
// from the words of the value (not from the key-value pair), so doubtful handwriting turns amber.

/** Handwritten words below this Textract confidence are shown for review (amber). */
export const HANDWRITING_REVIEW_BELOW = 0.9;
/** Confidence given to values a person must fix: impossible dates, visible corrections. */
export const DOUBTFUL_CONFIDENCE = 0.5;
/** Ceiling for a value found next to its key but outside Textract's value box. */
export const NEARBY_VALUE_CONFIDENCE = 0.6;

/** "2. Nombre:" -> "nombre"; accents, numbering, punctuation and spacing do not matter. */
export function normalizeLabel(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*\d+(\.\d+)?\.?\s*/, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** dd/mm/yyyy (paper format) -> YYYY-MM-DD; anything else is kept as read for a person to fix. */
export function toIsoDate(text: string): string {
  const m = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return text.trim();
  return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Day, month and year as read from the paper -> "YYYY-MM-DD" when it is a real, past date.
 * Two-digit years pivot on the current year ("90" -> 1990, "05" -> 2005 in 2026). Anything else
 * (month 13, 30 Feb, a future date, a missing part) keeps what was read as "dd/mm/yyyy" with
 * `valid: false`, so a person fixes it instead of the reader guessing.
 */
export function dateFromParts(day: string, month: string, year: string, today = new Date()): { value: string; valid: boolean } {
  const d = day.replace(/\D/g, "");
  const m = month.replace(/\D/g, "");
  let y = year.replace(/\D/g, "");
  const asRead = { value: `${d}/${m}/${y}`, valid: false };
  if (!d || !m || d.length > 2 || m.length > 2 || (y.length !== 2 && y.length !== 4)) return asRead;
  if (y.length === 2) {
    const pivot = today.getFullYear() % 100;
    y = `${Number(y) <= pivot ? Math.floor(today.getFullYear() / 100) : Math.floor(today.getFullYear() / 100) - 1}${y}`;
  }
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  const date = new Date(Date.UTC(yy, mm - 1, dd));
  const real = date.getUTCFullYear() === yy && date.getUTCMonth() === mm - 1 && date.getUTCDate() === dd;
  const value = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (!real || yy < 1900 || value > localIso(today)) return { value: `${d}/${m}/${y}`, valid: false };
  return { value, valid: true };
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function boxOf(block: Block | undefined): Box | null {
  const b = block?.Geometry?.BoundingBox;
  if (!b || b.Left === undefined || b.Top === undefined || b.Width === undefined || b.Height === undefined) return null;
  return { left: b.Left, top: b.Top, width: b.Width, height: b.Height };
}
const centerY = (b: Box) => b.top + b.height / 2;
/** Same printed row: vertical centers closer than most of the taller box. */
const sameRow = (a: Box, b: Box) => Math.abs(centerY(a) - centerY(b)) <= Math.max(a.height, b.height) * 0.75;

interface Ctx {
  blocks: Block[];
  byId: Map<string, Block>;
  keys: Block[];
  /** WORD ids already inside a KEY or VALUE block. */
  pairedWords: Set<string>;
  today: Date;
}

function childWords(block: Block, byId: Map<string, Block>): { words: Block[]; selected: boolean } {
  const words: Block[] = [];
  let selected = false;
  for (const rel of block.Relationships ?? []) {
    if (rel.Type !== "CHILD") continue;
    for (const id of rel.Ids ?? []) {
      const child = byId.get(id);
      if (child?.BlockType === "WORD" && child.Text) words.push(child);
      if (child?.BlockType === "SELECTION_ELEMENT" && child.SelectionStatus === "SELECTED") selected = true;
    }
  }
  return { words, selected };
}

const textOf = (words: Block[]) => words.map((w) => w.Text).join(" ");
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Confidence of a read value from its words: the lowest word confidence. Handwritten words are
 * rescaled so HANDWRITING_REVIEW_BELOW lands on the shared amber line (LOW_CONFIDENCE). Without
 * word confidences it falls back to the value block's own confidence (never the key's).
 */
export function wordsConfidence(words: Block[], fallback: number | undefined): number {
  const scored = words.filter((w) => typeof w.Confidence === "number");
  if (scored.length === 0) return round2((fallback ?? 0) / 100);
  let conf = Math.min(...scored.map((w) => w.Confidence!)) / 100;
  if (scored.some((w) => w.TextType === "HANDWRITING")) conf = (conf * LOW_CONFIDENCE) / HANDWRITING_REVIEW_BELOW;
  return round2(Math.min(1, conf));
}

function valueBlockOf(key: Block, byId: Map<string, Block>): Block | undefined {
  const id = key.Relationships?.find((r) => r.Type === "VALUE")?.Ids?.[0];
  return id ? byId.get(id) : undefined;
}

/**
 * Handwriting written above or past the line is often left out of Textract's value box. Take the
 * unpaired words right of the key, from slightly above to slightly below its row, up to the next
 * key or printed word on that row.
 */
function nearbyValueWords(key: Block, ctx: Ctx): Block[] {
  const kb = boxOf(key);
  if (!kb) return [];
  const right = kb.left + kb.width;
  const nextKeyLeft = Math.min(
    1,
    ...ctx.keys
      .filter((k) => k !== key)
      .map(boxOf)
      .filter((b): b is Box => !!b && b.left > right - 0.005 && sameRow(b, kb))
      .map((b) => b.left),
  );
  const candidates = ctx.blocks
    .filter((b) => b.BlockType === "WORD" && b.Id && b.Text && !ctx.pairedWords.has(b.Id))
    .map((b) => ({ b, box: boxOf(b) }))
    .filter((c): c is { b: Block; box: Box } => {
      if (!c.box) return false;
      const cy = centerY(c.box);
      return c.box.left >= right - 0.005 && c.box.left < nextKeyLeft && cy >= kb.top - 1.5 * kb.height && cy <= kb.top + 1.5 * kb.height;
    })
    .sort((a, b) => a.box.left - b.box.left);
  const out: Block[] = [];
  let lastRight = right;
  for (const c of candidates) {
    if (c.b.TextType === "PRINTED") break; // the next printed label on the row
    if (c.box.left - lastRight > 0.15) break; // too far from the key
    out.push(c.b);
    lastRight = c.box.left + c.box.width;
  }
  return out;
}

const PARTS = ["dia", "mes", "ano"] as const;
const partOf = (keyText: string) => PARTS.find((p) => new RegExp(`(^| )${p}$`).test(normalizeLabel(keyText)));

/** A date part read from one box: the last number written, and whether there were several. */
function readPart(words: Block[]): { text: string; corrected: boolean } {
  const groups = textOf(words).match(/\d+/g) ?? [];
  return { text: groups.at(-1) ?? "", corrected: groups.length > 1 };
}

function finishDate(parts: { text: string; corrected: boolean }[], words: Block[], fallback: number | undefined, today: Date) {
  if (parts.every((p) => !p.text)) return null;
  const { value, valid } = dateFromParts(parts[0]!.text, parts[1]!.text, parts[2]!.text, today);
  let confidence = wordsConfidence(words, fallback);
  if (!valid || parts.some((p) => p.corrected)) confidence = Math.min(confidence, DOUBTFUL_CONFIDENCE);
  return { value, confidence };
}

/** A "Día __ Mes __ Año ____" date on the row of the field's label (or under it, in a table). */
function readDateRow(field: TemplateField, ctx: Ctx): { value: string; confidence: number } | null {
  const label = normalizeLabel(field.etiqueta ?? "");
  if (!label) return null;
  const anchorBlock =
    ctx.blocks.find((b) => b.BlockType === "LINE" && b.Text && normalizeLabel(b.Text).includes(label) && boxOf(b)) ??
    ctx.keys.find((k) => normalizeLabel(textOf(childWords(k, ctx.byId).words)).includes(label) && boxOf(k));
  const anchor = boxOf(anchorBlock);
  if (!anchor) return null;

  // 1. Día / Mes / Año keys, in that order, left to right on the label's row.
  const rowKeys = ctx.keys
    .map((k) => ({ k, box: boxOf(k), part: partOf(textOf(childWords(k, ctx.byId).words)) }))
    .filter((x): x is { k: Block; box: Box; part: (typeof PARTS)[number] } => !!x.box && !!x.part && x.box.left + x.box.width > anchor.left && sameRow(x.box, anchor))
    .sort((a, b) => a.box.left - b.box.left);
  const chosen: Block[] = [];
  let from = -1;
  for (const part of PARTS) {
    const hit = rowKeys.find((x) => x.part === part && x.box.left > from);
    if (!hit) break;
    chosen.push(hit.k);
    from = hit.box.left;
  }
  if (chosen.length === 3) {
    const values = chosen.map((k) => valueBlockOf(k, ctx.byId));
    const words = values.map((v) => (v ? childWords(v, ctx.byId).words : []));
    const minValueConf = Math.min(...values.map((v) => v?.Confidence ?? 100));
    const date = finishDate(words.map(readPart), words.flat(), minValueConf, ctx.today);
    if (date) return date;
  }

  // 2. No usable keys: read the row's words, "... Día 05 Mes 01 Año 1990 6. Edad ...".
  const rowWords = ctx.blocks
    .filter((b) => b.BlockType === "WORD" && b.Text)
    .map((b) => ({ b, box: boxOf(b) }))
    .filter((x): x is { b: Block; box: Box } => !!x.box && x.box.left >= anchor.left - 0.005 && sameRow(x.box, anchor))
    .sort((a, b) => a.box.left - b.box.left);
  const slots: Record<string, Block[]> = {};
  let current: string | null = null;
  for (const { b } of rowWords) {
    const token = normalizeLabel(b.Text!);
    const part = PARTS.find((p) => p === token && !slots[p]);
    if (part && (part === "dia" || slots[PARTS[PARTS.indexOf(part) - 1]!])) {
      current = part;
      slots[part] = [];
      continue;
    }
    if (!current) continue;
    if (!/\d/.test(b.Text!) || /^\d+\.$/.test(b.Text!.trim())) {
      if (current === "ano") break; // "6." or "Edad": the next label starts
      continue;
    }
    slots[current]!.push(b);
  }
  if (!slots.ano) return null;
  const words = PARTS.map((p) => slots[p] ?? []);
  return finishDate(words.map(readPart), words.flat(), undefined, ctx.today);
}

function valueFor(field: TemplateField, text: string): string {
  if (field.tipo === "fecha") return toIsoDate(text);
  if (field.tipo === "casilla" && field.opciones) {
    // A checked box is reported as its option key ("1"); match by key or by visible label.
    const wanted = normalizeLabel(text);
    for (const [key, label] of Object.entries(field.opciones)) {
      if (wanted === key || wanted === normalizeLabel(label)) return key;
    }
  }
  // A stray dash or dot after a handwritten value ("55-0000-0040 -") is not part of it.
  return text.trim().replace(/[\s\-–—_.,:;]+$/, "");
}

/** A direct date value ("05/01/1990" in one box) is checked like an assembled one. */
function checkedDate(value: string, confidence: number, today: Date): number {
  const m = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, mo, d] = value.split("-");
    return dateFromParts(d!, mo!, y!, today).valid ? confidence : Math.min(confidence, DOUBTFUL_CONFIDENCE);
  }
  if (m && dateFromParts(m[1]!, m[2]!, m[3]!, today).valid) return confidence;
  return value ? Math.min(confidence, DOUBTFUL_CONFIDENCE) : confidence;
}

export function mapTextractBlocks(blocks: Block[], template: Template, today = new Date()): Extraction {
  const byId = new Map(blocks.filter((b) => b.Id).map((b) => [b.Id!, b]));
  const keys = blocks.filter((b) => b.BlockType === "KEY_VALUE_SET" && b.EntityTypes?.includes("KEY"));
  const pairedWords = new Set<string>();
  for (const b of blocks) {
    if (b.BlockType !== "KEY_VALUE_SET") continue;
    for (const w of childWords(b, byId).words) pairedWords.add(w.Id!);
  }
  const ctx: Ctx = { blocks, byId, keys, pairedWords, today };

  const byLabel = new Map<string, TemplateField>();
  for (const f of template.campos) {
    if (!f.no_transcribir && f.etiqueta) byLabel.set(normalizeLabel(f.etiqueta), f);
  }

  const out: Extraction = {};
  for (const key of keys) {
    const field = byLabel.get(normalizeLabel(textOf(childWords(key, byId).words)));
    if (!field) continue;
    const valueBlock = valueBlockOf(key, byId);
    if (!valueBlock) continue;
    let { words, selected } = childWords(valueBlock, byId);
    let confidence = wordsConfidence(words, valueBlock.Confidence);
    if (words.length === 0 && !selected && field.tipo !== "casilla" && field.tipo !== "fecha") {
      words = nearbyValueWords(key, ctx);
      if (words.length > 0) confidence = Math.min(wordsConfidence(words, undefined), NEARBY_VALUE_CONFIDENCE);
    }
    const raw = textOf(words) || (selected ? "X" : "");
    const value = valueFor(field, raw);
    if (field.tipo === "fecha") confidence = checkedDate(value, confidence, today);
    const previous = out[field.clave];
    // Same label twice (e.g. two "8." boxes): a value beats an empty box, then the clearer reading wins.
    if (previous) {
      const filled = (v: string) => (v === "" ? 0 : 1);
      if (filled(previous.value) > filled(value)) continue;
      if (filled(previous.value) === filled(value) && previous.confidence >= confidence) continue;
    }
    out[field.clave] = { value, confidence };
  }

  // Dates printed as Día / Mes / Año boxes: assembled from the row when no single box had them.
  for (const field of template.campos) {
    if (field.tipo !== "fecha" || field.no_transcribir || !field.etiqueta) continue;
    const direct = out[field.clave];
    if (direct && /^\d{4}-\d{2}-\d{2}$/.test(direct.value)) continue;
    const row = readDateRow(field, ctx);
    if (row) out[field.clave] = row;
  }
  return out;
}
