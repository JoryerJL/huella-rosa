import ExcelJS from "exceljs";
import { IMPORT_FIELDS } from "@er/shared";
import { TEMPLATE_HEADERS } from "./columns";

// Excel side of imports (SPEC 6.7): the downloadable template and reading uploaded .xlsx files.

export const TEMPLATE_SHEET = "Pacientes";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const INSTRUCTIONS = [
  "Cómo llenar esta plantilla",
  "",
  "1. Escribe una paciente por renglón en la hoja «Pacientes». No cambies los títulos de las columnas.",
  "2. Nombre completo y fecha de nacimiento son obligatorios. Los demás datos ayudan a reconocerla.",
  "3. Escribe la fecha de nacimiento como día/mes/año con números, por ejemplo 12/03/1978.",
  "4. Teléfono fijo y celular: 10 números, sin letras. Puedes usar guiones o espacios.",
  "5. ID del formato: las 11 letras o números de la casilla «4. ID» del formato en papel.",
  "6. Afiliación: INSABI, IMSS, ISSSTE, SEDENA, SEMAR, Ninguno u Otro.",
  "7. Solo datos para identificarla. No escribas resultados, diagnósticos ni notas de la consulta.",
  "",
  "Al subir el archivo, nada se guarda solo: revisas cada renglón y confirmas si es una paciente nueva o si ya tiene expediente.",
  "",
  "Ejemplo (datos inventados):",
];

/** Fictitious example shown on the instructions sheet only (never on the data sheet). */
const EXAMPLE_ROW: Record<(typeof IMPORT_FIELDS)[number], string> = {
  fullName: "Paula Ejemplo Ficticia",
  birthDate: "12/03/1978",
  birthState: "Jalisco",
  formId: "DEMO0000099",
  phone: "55-0000-0099",
  mobile: "55-0000-0098",
  residence: "Localidad Ejemplo",
  affiliation: "IMSS",
};

/** The .xlsx template: sheet "Pacientes" with the identification columns, sheet "Instrucciones". */
export async function buildTemplateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Huella Rosa";

  const sheet = workbook.addWorksheet(TEMPLATE_SHEET);
  sheet.columns = IMPORT_FIELDS.map((field) => ({
    header: TEMPLATE_HEADERS[field],
    key: field,
    width: Math.max(18, TEMPLATE_HEADERS[field].length + 4),
    // Text cells: keeps phone separators and dates exactly as typed.
    style: { numFmt: "@" },
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const help = workbook.addWorksheet("Instrucciones");
  help.getColumn(1).width = 110;
  INSTRUCTIONS.forEach((line, i) => {
    help.getCell(i + 1, 1).value = line;
  });
  help.getCell(1, 1).font = { bold: true, size: 14 };
  const exampleStart = INSTRUCTIONS.length + 1;
  IMPORT_FIELDS.forEach((field, i) => {
    help.getCell(exampleStart + i, 1).value = `${TEMPLATE_HEADERS[field]}: ${EXAMPLE_ROW[field]}`;
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Plain text of a cell. Excel dates become DD/MM/AAAA (they are stored as UTC midnight). */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
  }
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return cellText((value.result ?? null) as ExcelJS.CellValue);
    if ("text" in value) return String(value.text);
    if ("error" in value) return "";
    return "";
  }
  return String(value);
}

/** Reads the "Pacientes" sheet (or the first sheet) as rows of text cells, header first. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet(TEMPLATE_SHEET) ?? workbook.worksheets[0];
  if (!sheet) return [];
  const width = sheet.columnCount;
  const rows: string[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  }
  return rows;
}
