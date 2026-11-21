import { IMPORT_FIELDS, type ImportColumn, type ImportField } from "@er/shared";

// Column headers of the import template and automatic mapping of other files' headers.
// Fields are the identification fields of plantillas/mamaria.json, in the paper form's order.

/** Spanish header of each template column (sheet "Pacientes"). */
export const TEMPLATE_HEADERS: Record<ImportField, string> = {
  fullName: "Nombre completo",
  birthDate: "Fecha de nacimiento (DD/MM/AAAA)",
  birthState: "Entidad de nacimiento",
  formId: "ID del formato",
  phone: "Teléfono fijo",
  mobile: "Celular",
  residence: "Residencia habitual",
  affiliation: "Afiliación",
};

/** Other ways EIRA spreadsheets name the same field (normalized form, see normalizeHeader). */
const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  fullName: ["nombre completo", "nombre", "nombre de la paciente", "paciente", "nombre y apellidos", "2 nombre"],
  birthDate: [
    "fecha de nacimiento dd mm aaaa",
    "fecha de nacimiento",
    "fecha nacimiento",
    "f nac",
    "fec nac",
    "nacimiento",
    "5 fecha de nacimiento",
  ],
  birthState: ["entidad de nacimiento", "entidad", "estado de nacimiento", "edo nac", "lugar de nacimiento"],
  formId: ["id del formato", "id", "4 id", "id eira", "id formato"],
  phone: ["telefono fijo", "telefono", "tel", "tel fijo", "8 telefono fijo"],
  mobile: ["celular", "cel", "movil", "telefono celular", "tel celular", "8 celular"],
  residence: ["residencia habitual", "residencia", "domicilio", "direccion", "localidad", "comunidad"],
  affiliation: ["afiliacion", "derechohabiencia", "seguro", "servicio medico", "9 afiliacion"],
};

/** Minimum similarity (0-1) for a header to be suggested as a field. */
export const SUGGEST_THRESHOLD = 0.6;

/** Lowercase, no accents, letters/digits only, single spaces. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["de", "del", "la", "el", "y", "no"]);

function tokens(value: string): string[] {
  return normalizeHeader(value)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Abbreviations count: "nac" matches "nacimiento", "tel" matches "telefono". */
function tokenMatches(a: string, b: string): boolean {
  return a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));
}

/** Dice similarity over tokens with prefix matching (0-1). Exact normalized match is 1. */
export function headerSimilarity(header: string, label: string): number {
  if (normalizeHeader(header) === normalizeHeader(label)) return 1;
  const ta = tokens(header);
  const tb = tokens(label);
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Set<number>();
  let matched = 0;
  for (const token of ta) {
    const idx = tb.findIndex((other, i) => !used.has(i) && tokenMatches(token, other));
    if (idx >= 0) {
      used.add(idx);
      matched++;
    }
  }
  return (2 * matched) / (ta.length + tb.length);
}

function bestScore(header: string, field: ImportField): number {
  return Math.max(...HEADER_SYNONYMS[field].map((label) => headerSimilarity(header, label)));
}

/**
 * Proposes a field for each header (null = do not import). Each field goes to at most one
 * column: the best-scoring pairs win first. The person always confirms before rows are read.
 */
export function suggestMapping(headers: string[]): ImportColumn[] {
  const pairs: { index: number; field: ImportField; score: number }[] = [];
  headers.forEach((header, index) => {
    for (const field of IMPORT_FIELDS) {
      const score = bestScore(header, field);
      if (score >= SUGGEST_THRESHOLD) pairs.push({ index, field, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.index - b.index);

  const byIndex = new Map<number, ImportField>();
  const taken = new Set<ImportField>();
  for (const pair of pairs) {
    if (byIndex.has(pair.index) || taken.has(pair.field)) continue;
    byIndex.set(pair.index, pair.field);
    taken.add(pair.field);
  }
  return headers.map((header, index) => {
    const field = byIndex.get(index) ?? null;
    return { index, header, field, suggested: field };
  });
}

/** True when every non-empty header is exactly a template header: no mapping step needed. */
export function isTemplateHeaders(headers: string[]): boolean {
  const known = new Set(Object.values(TEMPLATE_HEADERS).map(normalizeHeader));
  const present = headers.map(normalizeHeader).filter((h) => h !== "");
  return present.length > 0 && present.every((h) => known.has(h)) && new Set(present).size === present.length;
}

/** Template mapping: header -> field by exact label. */
export function templateMapping(headers: string[]): ImportColumn[] {
  const byLabel = new Map(
    (Object.entries(TEMPLATE_HEADERS) as [ImportField, string][]).map(([field, label]) => [normalizeHeader(label), field]),
  );
  return headers.map((header, index) => {
    const field = byLabel.get(normalizeHeader(header)) ?? null;
    return { index, header, field, suggested: field };
  });
}

/** A mapping can be used once it has name and birth date, each field at most once. */
export function mappingProblem(columns: { field: ImportField | null }[]): string | null {
  const fields = columns.map((c) => c.field).filter((f): f is ImportField => f !== null);
  if (new Set(fields).size !== fields.length) return "Dos columnas van al mismo dato. Elige un dato distinto para cada una.";
  if (!fields.includes("fullName")) return "Falta elegir la columna del nombre completo.";
  if (!fields.includes("birthDate")) return "Falta elegir la columna de la fecha de nacimiento.";
  return null;
}
