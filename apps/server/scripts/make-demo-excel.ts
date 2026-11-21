import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { buildTemplateXlsx, TEMPLATE_SHEET } from "../src/imports/xlsx";

// Writes datos-ficticios/excel/plantilla-llena.xlsx: the import template filled with fictitious
// rows that exercise every review group (SPEC 6.7). Run: npm run demo:excel -w @er/server

const OUT = fileURLToPath(new URL("../../../datos-ficticios/excel/plantilla-llena.xlsx", import.meta.url));

// Columns: Nombre completo, Fecha de nacimiento, Entidad, ID del formato, Teléfono fijo, Celular, Residencia, Afiliación.
const ROWS: string[][] = [
  // 3 new fictitious patients
  ["Patricia Núñez Salazar", "14/02/1981", "Oaxaca", "NUSP810214", "55-0000-0081", "55-0000-0082", "Localidad Ejemplo Norte", "IMSS"],
  ["Verónica Ibarra Quintero", "09/06/1976", "Puebla", "", "", "55-0000-0083", "Rancho Prueba", "Ninguno"],
  ["Teresa Olvera Campos", "27/10/1992", "Jalisco", "OLCT921027", "", "55-0000-0084", "Villa Demo", "INSABI"],
  // Near-match of the seeded "Juana Martínez García" (same birth date, name without accents)
  ["Juana Martinez Garcia", "30/07/1972", "Michoacán", "", "55-0000-0085", "", "San Ejemplo", "IMSS"],
  // Invalid: 31 February does not exist
  ["Carmen Ruelas Pineda", "31/02/1990", "Colima", "", "", "55-0000-0086", "Villa Demo", ""],
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await buildTemplateXlsx()) as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet(TEMPLATE_SHEET);
  if (!sheet) throw new Error("Template sheet missing");
  for (const row of ROWS) sheet.addRow(row);
  writeFileSync(OUT, Buffer.from(await workbook.xlsx.writeBuffer()));
  console.log(`Wrote ${OUT} (${ROWS.length} rows)`);
}

void main();
