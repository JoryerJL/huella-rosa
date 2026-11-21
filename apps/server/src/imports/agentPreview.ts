import { randomUUID } from "node:crypto";
import {
  AGENT_PREVIEW_TTL_MINUTES,
  IMPORT_FIELDS,
  type AgentApplyResult,
  type AgentPreview,
  type AgentPreviewRow,
  type AnalyzePhotoInput,
  type AnalyzeSpreadsheetInput,
  type ApplyImportInput,
  type ImportColumn,
  type ImportField,
  type ImportRowData,
  type ImportRowDecisionInput,
  type StaffProfile,
} from "@er/shared";
import { db } from "../db";
import { valkey } from "../valkey";
import { writeAudit } from "../audit";
import { getTemplate, templateIdForService, type Template } from "../templates";
import { ocrReader } from "../scans/ocr";
import type { AgentIdentity } from "../agentGrants";
import { readUpload, MAX_IMPORT_BYTES } from "../routes/imports";
import { isTemplateHeaders, mappingProblem, suggestMapping, templateMapping } from "./columns";
import {
  assessRows,
  countRows,
  decideRow,
  ImportError,
  rowsWithData,
  splitTable,
  storeRows,
  type AssessedRow,
} from "./service";

// Agent import in two steps (SPEC 6.7). The agent acts AS the signed-in person (intake only):
// 1. analyze_spreadsheet / analyze_form_photo run our parser or OCR + validation + matching and
//    keep a preview in Valkey for 30 minutes. Nothing is written to the database.
// 2. apply_import runs ONLY the decisions the person confirmed, through the same decision code as
//    the review screen (CREATE_PATIENT / UPDATE_PATIENT filling empty fields only). A preview can
//    be applied once. "isHer" needs the patient the person chose among the preview candidates.
// Only identification fields are read, returned or stored; clinical values never leave the OCR.
// Audit entries carry ids and counts only.

const PREVIEW_TTL_SECONDS = AGENT_PREVIEW_TTL_MINUTES * 60;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const previewKey = (id: string) => `agent:preview:${id}`;
const appliedKey = (id: string) => `agent:preview:${id}:applied`;

interface StoredPreview {
  id: string;
  kind: AgentPreview["kind"];
  userId: string;
  grantId: string;
  fileName: string;
  createdAt: string;
  expiresAt: string;
  columns?: AgentPreview["columns"];
  rows: (AssessedRow & { confidence?: AgentPreviewRow["confidence"] })[];
}

function decodeBase64(value: string, maxBytes: number, tooBig: string): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) throw new ImportError("El archivo llegó vacío. Vuelve a enviarlo.");
  if (bytes.length > maxBytes) throw new ImportError(tooBig, 400);
  return new Uint8Array(bytes);
}

function toPreviewRow(row: StoredPreview["rows"][number]): AgentPreviewRow {
  return {
    row: row.rowNumber,
    status: row.status,
    fields: row.data,
    ...(row.confidence ? { confidence: row.confidence } : {}),
    reason: row.reason,
    candidates: (row.candidates?.patients ?? []).map((c) => ({
      patientId: c.patient.id,
      fullName: c.patient.fullName,
      birthDate: c.patient.birthDate,
      birthState: c.patient.birthState,
      localityName: c.patient.localityName,
      formId: c.patient.formId,
      phoneLast4: c.patient.phoneLast4,
      strength: c.strength,
      score: c.score,
      reasons: c.reasons,
    })),
    sameAsRows: row.candidates?.rows ?? [],
  };
}

function toPreview(stored: StoredPreview): AgentPreview {
  const counts = countRows(stored.rows.map((r) => r.status));
  return {
    previewId: stored.id,
    kind: stored.kind,
    fileName: stored.fileName,
    expiresAt: stored.expiresAt,
    ...(stored.columns ? { columns: stored.columns } : {}),
    counts: { new: counts.new, possibleMatch: counts.possibleMatch, invalid: counts.invalid },
    rows: stored.rows.map(toPreviewRow),
  };
}

async function savePreview(
  agent: AgentIdentity,
  input: Pick<StoredPreview, "kind" | "fileName" | "columns" | "rows">,
): Promise<AgentPreview> {
  const now = Date.now();
  const stored: StoredPreview = {
    id: randomUUID(),
    userId: agent.userId,
    grantId: agent.grantId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PREVIEW_TTL_SECONDS * 1000).toISOString(),
    ...input,
  };
  await valkey.set(previewKey(stored.id), JSON.stringify(stored), "EX", PREVIEW_TTL_SECONDS);
  const counts = countRows(stored.rows.map((r) => r.status));
  await writeAudit({
    actorId: agent.actorId,
    action: "AGENT_ANALYSIS",
    entity: "AgentPreview",
    entityId: stored.id,
    detail: `Análisis por ${agent.actorId} (${agent.clientName}) · kind=${stored.kind} rows=${counts.total} new=${counts.new} possible=${counts.possibleMatch} invalid=${counts.invalid}`,
  });
  return toPreview(stored);
}

// ---------- Analyze ----------

export async function analyzeSpreadsheet(input: AnalyzeSpreadsheetInput, agent: AgentIdentity): Promise<AgentPreview> {
  const bytes = decodeBase64(input.fileBase64, MAX_IMPORT_BYTES, "El archivo pesa más de 2 MB. Divídelo en varios archivos.");
  const fileName = input.fileName.slice(0, 200);
  const file = new File([new Uint8Array(bytes)], fileName);
  const { headers, rows } = splitTable(await readUpload(file));
  // The agent shows this mapping to the person as part of the plan.
  const columns: ImportColumn[] = isTemplateHeaders(headers) ? templateMapping(headers) : suggestMapping(headers);
  const problem = mappingProblem(columns);
  if (problem) throw new ImportError(problem);
  const assessed = await assessRows(rowsWithData(rows, columns));
  return savePreview(agent, {
    kind: "SPREADSHEET",
    fileName,
    columns: columns.map((c) => ({ header: c.header, field: c.field })),
    rows: assessed,
  });
}

/** "6" -> "Ninguno": checkbox codes of the paper form become the option label. */
function optionLabel(template: Template, key: string, value: string): string {
  let found: string | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const record = node as Record<string, unknown>;
    if (record.clave === key && record.opciones && typeof record.opciones === "object") {
      const label = (record.opciones as Record<string, unknown>)[value];
      if (typeof label === "string") found = label;
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(template);
  return found ?? value;
}

export async function analyzePhoto(input: AnalyzePhotoInput, agent: AgentIdentity): Promise<AgentPreview> {
  const bytes = decodeBase64(input.imageBase64, MAX_PHOTO_BYTES, "La foto es muy pesada. Toma otra.");
  const template = getTemplate(templateIdForService("BREAST_REVIEW"));
  if (!template) throw new ImportError("No encontramos la plantilla del formato.");
  const fileName = (input.fileName ?? "").slice(0, 200) || "Foto del formato";
  let extraction;
  try {
    extraction = await ocrReader()({ bytes, originalName: fileName, template });
  } catch {
    throw new ImportError("No pudimos leer la foto. Toma otra con buena luz y el formato completo.");
  }
  // Identification fields only: clinical values read by the OCR are dropped here.
  const data: ImportRowData = {};
  const confidence: Partial<Record<ImportField, number>> = {};
  for (const field of IMPORT_FIELDS) {
    const read = extraction[field];
    const value = read?.value?.trim();
    if (!value) continue;
    data[field] = field === "affiliation" ? optionLabel(template, field, value) : value;
    confidence[field] = read.confidence;
  }
  if (!data.fullName && !data.birthDate) {
    throw new ImportError("No encontramos el nombre ni la fecha de nacimiento en la foto. Toma otra con el formato completo.");
  }
  const [assessed] = await assessRows([{ rowNumber: 1, data }]);
  return savePreview(agent, { kind: "PHOTO", fileName, rows: [{ ...assessed, confidence }] });
}

// ---------- Apply (only what the person confirmed) ----------

const ACTION: Record<ApplyImportInput["decisions"][number]["action"], (patientId?: string) => ImportRowDecisionInput> = {
  register: () => ({ action: "register" }),
  isHer: (patientId) => ({ action: "isHer", patientId: patientId ?? "" }),
  skip: () => ({ action: "discard" }),
};

const ALREADY_APPLIED = "Esta vista previa ya se aplicó. Revisa el lote en Importar.";

export async function applyPreview(input: ApplyImportInput, agent: AgentIdentity): Promise<AgentApplyResult> {
  if (await valkey.get(appliedKey(input.previewId))) throw new ImportError(ALREADY_APPLIED, 409);
  const raw = await valkey.get(previewKey(input.previewId));
  const preview = raw ? (JSON.parse(raw) as StoredPreview) : null;
  // Another person's preview looks the same as an expired one.
  if (!preview || preview.userId !== agent.userId) {
    throw new ImportError(
      `Esta vista previa ya no existe o venció (duran ${AGENT_PREVIEW_TTL_MINUTES} minutos). Vuelve a analizar el archivo.`,
      404,
    );
  }

  // Check every decision before touching anything.
  const byRow = new Map(preview.rows.map((r) => [r.rowNumber, r]));
  const seen = new Set<number>();
  for (const d of input.decisions) {
    const row = byRow.get(d.row);
    if (!row) throw new ImportError(`La fila ${d.row} no está en la vista previa.`);
    if (seen.has(d.row)) throw new ImportError(`La fila ${d.row} tiene más de una decisión.`);
    seen.add(d.row);
    if (d.action === "isHer") {
      const allowed = new Set((row.candidates?.patients ?? []).map((c) => c.patient.id));
      if (!d.patientId || !allowed.has(d.patientId)) {
        throw new ImportError(`En la fila ${d.row}, "Es ella" necesita una de las pacientes que se mostraron para esa fila.`);
      }
    }
    if (d.action === "register" && row.status === "INVALID") {
      throw new ImportError(`La fila ${d.row} tiene datos por corregir: ${row.reason ?? ""}`.trim());
    }
  }

  // A preview is applied once, even with two calls at the same time.
  const claimed = await valkey.set(appliedKey(preview.id), "1", "EX", PREVIEW_TTL_SECONDS, "NX");
  if (claimed !== "OK") throw new ImportError(ALREADY_APPLIED, 409);

  const staff: StaffProfile = { id: agent.userId, name: agent.userName, role: agent.role };
  const batch = await db.importBatch.create({
    data: {
      source: "MCP",
      fileName: preview.fileName,
      columnMapping: JSON.stringify({ confirmed: true, columns: [] }),
      createdBy: agent.actorId,
      agentGrantId: agent.grantId,
    },
  });
  await storeRows(batch.id, preview.rows);
  const rows = await db.importRow.findMany({ where: { batchId: batch.id }, select: { id: true, rowNumber: true } });
  const idByRow = new Map(rows.map((r) => [r.rowNumber, r.id]));

  const result: AgentApplyResult = {
    batchId: batch.id,
    registered: 0,
    linked: 0,
    skipped: 0,
    failed: [],
    pending: preview.rows.length - input.decisions.length,
    reviewUrl: `/intake/import/${batch.id}`,
  };
  for (const d of [...input.decisions].sort((a, b) => a.row - b.row)) {
    try {
      await decideRow(batch.id, idByRow.get(d.row)!, ACTION[d.action](d.patientId), { staff, deviceId: "agent" });
      if (d.action === "register") result.registered++;
      else if (d.action === "isHer") result.linked++;
      else result.skipped++;
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      result.failed.push({ row: d.row, reason: error.message });
    }
  }
  await valkey.del(previewKey(preview.id));
  await writeAudit({
    actorId: agent.userId,
    action: "AGENT_IMPORT_CONFIRMED",
    entity: "ImportBatch",
    entityId: batch.id,
    detail:
      `Importación confirmada por ${agent.userName} vía agente (${agent.clientName}) · preview=${preview.id} ` +
      `registered=${result.registered} isHer=${result.linked} skipped=${result.skipped} failed=${result.failed.length} pending=${result.pending}`,
  });
  return result;
}
