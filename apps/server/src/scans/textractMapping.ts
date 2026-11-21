import type { Block } from "@aws-sdk/client-textract";
import type { Template, TemplateField } from "../templates";
import type { Extraction } from "./fields";

// Maps an AnalyzeDocument (FORMS) response to template keys by matching each KEY label to the
// field's `etiqueta`. Pure: no AWS call. It only copies what was printed or typed in a box;
// it never interprets clinical text, and `no_transcribir` fields are skipped.

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

function childText(block: Block, byId: Map<string, Block>): { text: string; selected: boolean } {
  const words: string[] = [];
  let selected = false;
  for (const rel of block.Relationships ?? []) {
    if (rel.Type !== "CHILD") continue;
    for (const id of rel.Ids ?? []) {
      const child = byId.get(id);
      if (child?.BlockType === "WORD" && child.Text) words.push(child.Text);
      if (child?.BlockType === "SELECTION_ELEMENT" && child.SelectionStatus === "SELECTED") selected = true;
    }
  }
  return { text: words.join(" "), selected };
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
  return text.trim();
}

export function mapTextractBlocks(blocks: Block[], template: Template): Extraction {
  const byId = new Map(blocks.filter((b) => b.Id).map((b) => [b.Id!, b]));
  const byLabel = new Map<string, TemplateField>();
  for (const f of template.campos) {
    if (!f.no_transcribir && f.etiqueta) byLabel.set(normalizeLabel(f.etiqueta), f);
  }

  const out: Extraction = {};
  for (const block of blocks) {
    if (block.BlockType !== "KEY_VALUE_SET" || !block.EntityTypes?.includes("KEY")) continue;
    const field = byLabel.get(normalizeLabel(childText(block, byId).text));
    if (!field) continue;
    const valueId = block.Relationships?.find((r) => r.Type === "VALUE")?.Ids?.[0];
    const valueBlock = valueId ? byId.get(valueId) : undefined;
    if (!valueBlock) continue;
    const { text, selected } = childText(valueBlock, byId);
    const raw = text || (selected ? "X" : "");
    const confidence = Math.min(block.Confidence ?? 0, valueBlock.Confidence ?? 0) / 100;
    const previous = out[field.clave];
    // Same label twice (e.g. two "8." boxes): keep the clearer reading.
    if (previous && previous.confidence >= confidence) continue;
    out[field.clave] = { value: valueFor(field, raw), confidence: Math.round(confidence * 100) / 100 };
  }
  return out;
}
