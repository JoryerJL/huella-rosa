import {
  IMPORT_FIELDS,
  isEiraIdLike,
  scoreCandidate,
  type ImportColumn,
  type ImportField,
  type ImportRowData,
  type ImportSameAsRow,
  type SearchQuery,
} from "@er/shared";

// Row validation for imports (SPEC 6.7): plain Spanish reasons, never guesses a value.

export const FORM_ID_PROBLEM = "El ID del formato debe tener 4 letras y 6 números (por ejemplo RATL900105).";

export const AFFILIATION_OPTIONS = ["INSABI", "IMSS", "ISSSTE", "SEDENA", "SEMAR", "Ninguno", "Otro"];

/** Form "4. ID": 11 boxes on the paper form (plantillas/mamaria.json, longitud 11). */
const FORM_ID_PATTERN = /^[A-Z0-9]{11}$/;

/** EIRA ID rule (SPEC 6.1.1, 10 characters + optional 11th) or any 11 letters/digits as on paper. */
function isValidFormId(formId: string): boolean {
  return isEiraIdLike(formId) || FORM_ID_PATTERN.test(formId);
}

export type RowCheck =
  | { valid: true; data: ImportRowData }
  | { valid: false; data: ImportRowData; reason: string };

/** Picks the mapped cells of one spreadsheet row, trimmed. Empty cells are left out. */
export function rowValues(cells: string[], columns: ImportColumn[]): ImportRowData {
  const data: ImportRowData = {};
  for (const column of columns) {
    if (!column.field) continue;
    const value = (cells[column.index] ?? "").replace(/\s+/g, " ").trim();
    if (value) data[column.field] = value;
  }
  return data;
}

export function isBlankRow(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * DD/MM/AAAA (also with "-" or ".") or AAAA-MM-DD -> "YYYY-MM-DD".
 * Returns a plain reason when the text is not a date or the date does not exist.
 */
export function parseBirthDate(value: string, today = new Date()): { date: string } | { reason: string } {
  const text = value.trim();
  let parts: [number, number, number] | null = null;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (dmy) parts = [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])];
  else if (ymd) parts = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  if (!parts) {
    return { reason: `La fecha de nacimiento "${text}" no se entiende. Escríbela como día/mes/año, por ejemplo 12/03/1978.` };
  }
  const [year, month, day] = parts;
  if (!isRealDate(year, month, day)) {
    return { reason: `La fecha de nacimiento ${text} no existe en el calendario. Revisa el día y el mes.` };
  }
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (year < 1900 || iso > todayIso) {
    return { reason: `La fecha de nacimiento ${text} no puede ser correcta. Revisa el año.` };
  }
  return { date: iso };
}

/** Separators, spaces and a +52 prefix are fine; anything else is not a phone number. */
function checkPhone(value: string, label: string): { phone: string } | { reason: string } {
  if (!/^[\d\s()+.-]+$/.test(value)) {
    return { reason: `El ${label} solo puede tener números.` };
  }
  let digits = value.replace(/\D+/g, "");
  if (digits.length === 12 && digits.startsWith("52")) digits = digits.slice(2);
  if (digits.length !== 10) {
    return { reason: `El ${label} debe tener 10 números (tiene ${digits.length}).` };
  }
  return { phone: digits };
}

/** Validates and normalizes one row. Never invents a missing value. */
export function validateRow(raw: ImportRowData, today = new Date()): RowCheck {
  const data: ImportRowData = { ...raw };
  const problems: string[] = [];

  const name = data.fullName ?? "";
  if (!name) problems.push("Falta el nombre completo.");
  else if (!/\p{L}/u.test(name) || name.length < 3) problems.push("El nombre completo no parece un nombre.");

  if (!data.birthDate) {
    problems.push("Falta la fecha de nacimiento.");
  } else {
    const parsed = parseBirthDate(data.birthDate, today);
    if ("reason" in parsed) problems.push(parsed.reason);
    else data.birthDate = parsed.date;
  }

  if (data.formId) {
    const formId = data.formId.replace(/[\s-]+/g, "").toUpperCase();
    if (!isValidFormId(formId)) problems.push(FORM_ID_PROBLEM);
    else data.formId = formId;
  }

  for (const [field, label] of [
    ["phone", "teléfono fijo"],
    ["mobile", "celular"],
  ] as const) {
    const value = data[field];
    if (!value) continue;
    const checked = checkPhone(value, label);
    if ("reason" in checked) problems.push(checked.reason);
    else data[field] = checked.phone;
  }

  if (data.affiliation) {
    const option = AFFILIATION_OPTIONS.find((o) => o.toLowerCase() === data.affiliation!.toLowerCase());
    if (!option) problems.push(`La afiliación debe ser una de estas: ${AFFILIATION_OPTIONS.join(", ")}.`);
    else data.affiliation = option;
  }

  return problems.length > 0 ? { valid: false, data, reason: problems.join(" ") } : { valid: true, data };
}

/** Search query for the shared matcher, one per phone (the matcher takes a single query phone). */
export function matchQueries(data: ImportRowData): SearchQuery[] {
  const base = {
    fullName: data.fullName ?? "",
    birthDate: data.birthDate ?? "",
    formId: data.formId,
    birthState: data.birthState,
  };
  const phones = [...new Set([data.mobile, data.phone].filter((p): p is string => !!p))];
  return phones.length > 0 ? phones.map((phone) => ({ ...base, phone })) : [base];
}

/**
 * Earlier rows of the same file that look like the same person, by the same rules as search
 * (STRONG only). `earlier` holds the valid rows above this one.
 */
export function findSameAsRows(
  data: ImportRowData,
  earlier: { rowNumber: number; data: ImportRowData }[],
): ImportSameAsRow[] {
  const found: ImportSameAsRow[] = [];
  for (const other of earlier) {
    const subject = {
      fullName: other.data.fullName ?? "",
      birthDate: other.data.birthDate ?? "",
      formId: other.data.formId ?? null,
      phone: other.data.phone ?? null,
      mobile: other.data.mobile ?? null,
      birthState: other.data.birthState ?? null,
    };
    let best: ReturnType<typeof scoreCandidate> | null = null;
    for (const query of matchQueries(data)) {
      const score = scoreCandidate(query, subject);
      if (!best || score.score > best.score) best = score;
    }
    if (best && best.strength === "STRONG") found.push({ rowNumber: other.rowNumber, reasons: best.reasons });
  }
  return found;
}

/** Identification fields only: drops anything not in IMPORT_FIELDS (defensive, e.g. MCP input). */
export function onlyImportFields(data: Record<string, unknown>): ImportRowData {
  const clean: ImportRowData = {};
  for (const field of IMPORT_FIELDS as readonly ImportField[]) {
    const value = data[field];
    if (typeof value === "string" && value.trim()) clean[field] = value.trim();
  }
  return clean;
}
