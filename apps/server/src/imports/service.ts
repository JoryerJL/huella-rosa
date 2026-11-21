import { randomUUID } from "node:crypto";
import {
  IMPORT_FIELDS,
  type ImportBatchCounts,
  type ImportBatchSummary,
  type ImportBatchView,
  type ImportColumn,
  type ImportColumnMapping,
  type ImportField,
  type ImportRowData,
  type ImportRowDecision,
  type ImportRowDecisionInput,
  type ImportRowStatus,
  type ImportRowView,
  type ImportSameAsRow,
  type ImportSource,
  type MatchCandidate,
  type MatchScore,
  type PatientFields,
  type StaffProfile,
  type SyncOp,
} from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { applySyncOp } from "../sync";
import { scoreMainCandidates } from "../matchCandidates";
import { summaryInclude, toSummary } from "../routes/patients";
import { publishChange } from "../changes";
import { currentCursor } from "../campaignPackage";
import { isBlankRow, findSameAsRows, matchQueries, rowValues, validateRow } from "./rows";
import { isTemplateHeaders, mappingProblem, suggestMapping, templateMapping } from "./columns";

// Import batches (SPEC 6.7). A batch only proposes: rows are validated and matched like a search,
// and nothing becomes a patient until a person decides. Confirmed rows go through applySyncOp
// (the single write path) as CREATE_PATIENT / UPDATE_PATIENT ops. Audit entries carry counts
// and ids only, never row values.

export const MAX_IMPORT_ROWS = 1000;
const MAX_CANDIDATES = 5;
const OPEN_ROW_STATUSES: ImportRowStatus[] = ["NEW", "POSSIBLE_MATCH"];

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

interface PendingRow {
  rowNumber: number;
  cells: string[];
}

interface StoredCandidates {
  patients: MatchCandidate[];
  rows: ImportSameAsRow[];
}

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

// ---------- Creating a batch ----------

/** Header row + data rows (with their spreadsheet row numbers), blank rows dropped. */
function splitTable(table: string[][]): { headers: string[]; rows: PendingRow[] } {
  const headerIndex = table.findIndex((cells) => !isBlankRow(cells));
  if (headerIndex < 0) throw new ImportError("El archivo está vacío. Revisa que tenga la fila de títulos y al menos una paciente.");
  const headers = table[headerIndex].map((h) => h.trim());
  // Ignore empty columns at the right end.
  while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();
  const rows: PendingRow[] = [];
  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i].slice(0, headers.length);
    if (!isBlankRow(cells)) rows.push({ rowNumber: i + 1, cells });
  }
  if (rows.length === 0) throw new ImportError("El archivo no tiene pacientes debajo de la fila de títulos.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportError(`El archivo tiene ${rows.length} renglones. El máximo es ${MAX_IMPORT_ROWS}: divídelo en varios archivos.`);
  }
  return { headers, rows };
}

/**
 * Creates a batch from a parsed spreadsheet. Template headers map on their own; any other
 * headers get a suggested mapping and the batch waits for POST /api/imports/:id/mapping.
 */
export async function createBatchFromTable(input: {
  table: string[][];
  fileName: string | null;
  staff: StaffProfile;
  deviceId: string | null;
}): Promise<ImportBatchView> {
  const { headers, rows } = splitTable(input.table);
  const isTemplate = isTemplateHeaders(headers);
  const source: ImportSource = isTemplate ? "TEMPLATE" : "EXCEL";
  const mapping: ImportColumnMapping = isTemplate
    ? { confirmed: true, columns: templateMapping(headers) }
    : { confirmed: false, columns: suggestMapping(headers) };

  const batch = await db.importBatch.create({
    data: {
      source,
      fileName: input.fileName,
      columnMapping: JSON.stringify(mapping),
      // Raw cells live here only until the mapping is confirmed; then only mapped fields are kept.
      pendingRows: isTemplate ? null : JSON.stringify(rows),
      createdBy: input.staff.id,
    },
  });

  const counts = isTemplate ? await evaluateRows(batch.id, rowsWithData(rows, mapping.columns)) : null;
  await writeAudit({
    actorId: input.staff.id,
    action: "IMPORT_UPLOADED",
    deviceId: input.deviceId,
    entity: "ImportBatch",
    entityId: batch.id,
    detail: counts ? countsDetail(counts) : `rows=${rows.length} mapping=pending`,
  });
  return getBatchView(batch.id);
}

function rowsWithData(rows: PendingRow[], columns: ImportColumn[]) {
  return rows.map((row) => ({ rowNumber: row.rowNumber, data: rowValues(row.cells, columns) }));
}

function countsDetail(counts: ImportBatchCounts) {
  return `rows=${counts.total} new=${counts.new} possible=${counts.possibleMatch} invalid=${counts.invalid}`;
}

/** Confirms the column mapping chosen by the person, then validates and matches the rows. */
export async function confirmMapping(
  batchId: string,
  chosen: { index: number; field: ImportField | null }[],
  staff: StaffProfile,
  deviceId: string | null,
): Promise<ImportBatchView> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportError("No encontramos este archivo.", 404);
  const mapping = parseJson<ImportColumnMapping>(batch.columnMapping, { confirmed: false, columns: [] });
  if (mapping.confirmed || !batch.pendingRows) throw new ImportError("Las columnas de este archivo ya se confirmaron.", 409);

  const fieldByIndex = new Map(chosen.map((c) => [c.index, c.field]));
  const columns = mapping.columns.map((column) => ({ ...column, field: fieldByIndex.get(column.index) ?? null }));
  const problem = mappingProblem(columns);
  if (problem) throw new ImportError(problem);

  const rows = parseJson<PendingRow[]>(batch.pendingRows, []);
  // Claim the batch: only one confirmation evaluates the rows.
  const claimed = await db.importBatch.updateMany({
    where: { id: batchId, pendingRows: { not: null } },
    data: { columnMapping: JSON.stringify({ confirmed: true, columns }), pendingRows: null },
  });
  if (claimed.count === 0) throw new ImportError("Las columnas de este archivo ya se confirmaron.", 409);

  const counts = await evaluateRows(batchId, rowsWithData(rows, columns));
  await writeAudit({
    actorId: staff.id,
    action: "IMPORT_MAPPING_CONFIRMED",
    deviceId,
    entity: "ImportBatch",
    entityId: batchId,
    detail: `fields=${columns.flatMap((c) => (c.field ? [c.field] : [])).join(",")} ${countsDetail(counts)}`,
  });
  return getBatchView(batchId);
}

/** Best score per main record over each of the row's phones (same lookup as search). */
async function candidatesFor(data: ImportRowData): Promise<MatchCandidate[]> {
  const best = new Map<string, MatchScore>();
  for (const query of matchQueries(data)) {
    for (const [id, score] of await scoreMainCandidates(query)) {
      const current = best.get(id);
      if (!current || score.score > current.score) best.set(id, score);
    }
  }
  // A lone weak signal (only a similar name, only the birth date) is not worth a review.
  const ranked = [...best.entries()]
    .filter(([, s]) => s.strength === "STRONG" || s.reasons.filter((r) => r !== "SAME_BIRTH_STATE").length >= 2)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_CANDIDATES);
  if (ranked.length === 0) return [];
  const mains = await db.patient.findMany({ where: { id: { in: ranked.map(([id]) => id) } }, include: summaryInclude });
  const byId = new Map(mains.map((m) => [m.id, m]));
  return ranked.flatMap(([id, score]) => {
    const main = byId.get(id);
    return main ? [{ patient: toSummary(main), ...score }] : [];
  });
}

/**
 * Validates and matches rows, storing each as INVALID, NEW or POSSIBLE_MATCH. Reusable by the
 * MCP `propose_import` tool (block 4), which hands over already-normalized identification data.
 */
export async function evaluateRows(
  batchId: string,
  items: { rowNumber: number; data: ImportRowData }[],
): Promise<ImportBatchCounts> {
  const earlier: { rowNumber: number; data: ImportRowData }[] = [];
  const records = [];
  for (const item of items) {
    const check = validateRow(item.data);
    if (!check.valid) {
      records.push({ batchId, rowNumber: item.rowNumber, data: JSON.stringify(check.data), status: "INVALID", reason: check.reason });
      continue;
    }
    const patients = await candidatesFor(check.data);
    const rows = findSameAsRows(check.data, earlier);
    earlier.push({ rowNumber: item.rowNumber, data: check.data });
    const candidates: StoredCandidates = { patients, rows };
    records.push({
      batchId,
      rowNumber: item.rowNumber,
      data: JSON.stringify(check.data),
      status: patients.length > 0 || rows.length > 0 ? "POSSIBLE_MATCH" : "NEW",
      candidates: JSON.stringify(candidates),
    });
  }
  await db.importRow.createMany({ data: records });
  return countRows(records.map((r) => r.status as ImportRowStatus));
}

function countRows(statuses: ImportRowStatus[]): ImportBatchCounts {
  const count = (s: ImportRowStatus) => statuses.filter((x) => x === s).length;
  return {
    total: statuses.length,
    new: count("NEW"),
    possibleMatch: count("POSSIBLE_MATCH"),
    invalid: count("INVALID"),
    confirmed: count("CONFIRMED"),
    discarded: count("DISCARDED"),
  };
}

// ---------- Reading ----------

type BatchRecord = Awaited<ReturnType<typeof db.importBatch.findMany>>[number];

function toSummaryView(batch: BatchRecord, statuses: ImportRowStatus[]): ImportBatchSummary {
  const mapping = parseJson<ImportColumnMapping>(batch.columnMapping, { confirmed: false, columns: [] });
  return {
    id: batch.id,
    source: batch.source as ImportSource,
    fileName: batch.fileName,
    status: batch.status as ImportBatchSummary["status"],
    createdAt: batch.createdAt.toISOString(),
    needsMapping: !mapping.confirmed,
    counts: mapping.confirmed
      ? countRows(statuses)
      : { ...countRows([]), total: parseJson<PendingRow[]>(batch.pendingRows, []).length },
  };
}

export async function listBatches(limit = 20): Promise<ImportBatchSummary[]> {
  const batches = await db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const rows = await db.importRow.findMany({
    where: { batchId: { in: batches.map((b) => b.id) } },
    select: { batchId: true, status: true },
  });
  return batches.map((batch) =>
    toSummaryView(
      batch,
      rows.filter((r) => r.batchId === batch.id).map((r) => r.status as ImportRowStatus),
    ),
  );
}

export async function getBatchView(batchId: string): Promise<ImportBatchView> {
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!batch) throw new ImportError("No encontramos este archivo.", 404);
  const rows: ImportRowView[] = batch.rows.map((row) => {
    const candidates = parseJson<StoredCandidates>(row.candidates, { patients: [], rows: [] });
    return {
      id: row.id,
      rowNumber: row.rowNumber,
      status: row.status as ImportRowStatus,
      data: parseJson<ImportRowData>(row.data, {}),
      reason: row.reason,
      candidates: candidates.patients ?? [],
      sameAsRows: candidates.rows ?? [],
      decision: (row.decision as ImportRowDecision | null) ?? null,
      patientId: row.patientId,
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  });
  return {
    ...toSummaryView(batch, rows.map((r) => r.status)),
    mapping: parseJson<ImportColumnMapping>(batch.columnMapping, { confirmed: false, columns: [] }),
    rows,
  };
}

// ---------- Decisions (always an explicit person action) ----------

interface DecisionContext {
  staff: StaffProfile;
  deviceId: string | null;
}

/** Patient fields from the row; only what the row carries. */
function patientFieldsFrom(data: ImportRowData): PatientFields {
  const fields: PatientFields = { fullName: data.fullName ?? "", birthDate: data.birthDate ?? "" };
  for (const field of IMPORT_FIELDS) {
    if (field !== "fullName" && field !== "birthDate" && data[field]) fields[field] = data[field];
  }
  return fields;
}

/** Marks an open row as decided. False when someone else decided it first. */
async function closeRow(rowId: string, decision: ImportRowDecision, staff: StaffProfile, patientId: string | null) {
  const updated = await db.importRow.updateMany({
    where: { id: rowId, status: { in: OPEN_ROW_STATUSES } },
    data: {
      status: decision === "DISCARDED" ? "DISCARDED" : "CONFIRMED",
      decision,
      patientId,
      decidedBy: staff.id,
      decidedAt: new Date(),
    },
  });
  return updated.count > 0;
}

/** Batch DONE when no NEW or POSSIBLE_MATCH rows remain. */
async function refreshBatchStatus(batchId: string) {
  const open = await db.importRow.count({ where: { batchId, status: { in: OPEN_ROW_STATUSES } } });
  const pending = await db.importBatch.count({ where: { id: batchId, pendingRows: { not: null } } });
  await db.importBatch.update({ where: { id: batchId }, data: { status: open === 0 && pending === 0 ? "DONE" : "OPEN" } });
}

async function loadOpenRow(batchId: string, rowId: string) {
  const row = await db.importRow.findFirst({ where: { id: rowId, batchId } });
  if (!row) throw new ImportError("No encontramos este renglón.", 404);
  if (row.status === "INVALID") return row; // can only be discarded
  if (!OPEN_ROW_STATUSES.includes(row.status as ImportRowStatus)) {
    throw new ImportError("Este renglón ya se revisó.", 409);
  }
  return row;
}

type OpenRow = Awaited<ReturnType<typeof loadOpenRow>>;

/** "Registrar": a new patient through the single write path (CREATE_PATIENT). */
async function registerRow(row: OpenRow, ctx: DecisionContext): Promise<void> {
  if (row.status === "INVALID") throw new ImportError("Este renglón tiene datos por corregir. Corrígelo en el archivo o descártalo.");
  const data = parseJson<ImportRowData>(row.data, {});
  const candidates = parseJson<StoredCandidates>(row.candidates, { patients: [], rows: [] });
  const rejected = (candidates.patients ?? []).map((c) => c.patient.id);
  const patientId = randomUUID();
  const op: SyncOp = {
    kind: "CREATE_PATIENT",
    // The row id is the op id: a row can create at most one patient, even on a double click.
    opId: row.id,
    deviceId: ctx.deviceId ?? "import",
    at: new Date().toISOString(),
    patientId,
    fields: patientFieldsFrom(data),
    decision: rejected.length > 0 || (candidates.rows ?? []).length > 0 ? "REJECTED_MATCH" : "NO_MATCH",
    rejectedCandidateIds: rejected,
  };
  const result = await applySyncOp(op, ctx.staff);
  if (result.status === "DUPLICATE") throw new ImportError("Este renglón ya se está guardando. Actualiza la pantalla.", 409);
  if (result.status !== "APPLIED") throw new ImportError(result.message ?? "No se pudo registrar este renglón.");
  await closeRow(row.id, "REGISTERED", ctx.staff, patientId);
  await writeAudit({
    actorId: ctx.staff.id,
    action: "IMPORT_ROW_REGISTERED",
    deviceId: ctx.deviceId,
    entity: "ImportRow",
    entityId: row.id,
    detail: `batch=${row.batchId} patient=${patientId}`,
  });
}

/**
 * "Es ella": links the row to an existing record. Only empty fields of the record are filled
 * (UPDATE_PATIENT through the single write path); nothing already saved is overwritten.
 */
async function isHerRow(row: OpenRow, patientId: string, ctx: DecisionContext): Promise<void> {
  if (row.status === "INVALID") throw new ImportError("Este renglón tiene datos por corregir. Corrígelo en el archivo o descártalo.");
  const candidates = parseJson<StoredCandidates>(row.candidates, { patients: [], rows: [] });
  const allowed = new Set((candidates.patients ?? []).map((c) => c.patient.id));
  // An earlier row of the same file that was already registered also counts.
  const sameRowNumbers = (candidates.rows ?? []).map((r) => r.rowNumber);
  if (sameRowNumbers.length > 0) {
    const registered = await db.importRow.findMany({
      where: { batchId: row.batchId, rowNumber: { in: sameRowNumbers }, patientId: { not: null } },
      select: { patientId: true },
    });
    for (const r of registered) if (r.patientId) allowed.add(r.patientId);
  }
  if (!allowed.has(patientId)) throw new ImportError("Elige una de las pacientes que se muestran para este renglón.");

  const patient = await db.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new ImportError("No encontramos ese expediente.", 404);

  const data = parseJson<ImportRowData>(row.data, {});
  const changes: Partial<PatientFields> = {};
  for (const field of IMPORT_FIELDS) {
    if (field === "fullName" || field === "birthDate") continue;
    const current = patient[field];
    if (data[field] && (current === null || current === "")) changes[field] = data[field];
  }
  const filled = Object.keys(changes);
  if (filled.length > 0) {
    const result = await applySyncOp(
      {
        kind: "UPDATE_PATIENT",
        opId: row.id,
        deviceId: ctx.deviceId ?? "import",
        at: new Date().toISOString(),
        patientId,
        baseVersion: patient.version,
        changes,
      },
      ctx.staff,
    );
    if (result.status === "DUPLICATE") throw new ImportError("Este renglón ya se está guardando. Actualiza la pantalla.", 409);
    // CONFLICT keeps the saved value and leaves a review for administration: still a decision.
    if (result.status !== "APPLIED" && result.status !== "CONFLICT") {
      throw new ImportError(result.message ?? "No se pudo agregar a su expediente.");
    }
  }
  if (!(await closeRow(row.id, "IS_HER", ctx.staff, patientId))) {
    throw new ImportError("Este renglón ya se revisó.", 409);
  }
  await writeAudit({
    actorId: ctx.staff.id,
    action: "IMPORT_ROW_IS_HER",
    deviceId: ctx.deviceId,
    entity: "ImportRow",
    entityId: row.id,
    detail: `batch=${row.batchId} patient=${patientId} filled=${filled.join(",")}`,
  });
}

async function discardRow(row: OpenRow, ctx: DecisionContext): Promise<void> {
  const updated = await db.importRow.updateMany({
    where: { id: row.id, status: { in: [...OPEN_ROW_STATUSES, "INVALID"] } },
    data: { status: "DISCARDED", decision: "DISCARDED", decidedBy: ctx.staff.id, decidedAt: new Date() },
  });
  if (updated.count === 0) throw new ImportError("Este renglón ya se revisó.", 409);
  await writeAudit({
    actorId: ctx.staff.id,
    action: "IMPORT_ROW_DISCARDED",
    deviceId: ctx.deviceId,
    entity: "ImportRow",
    entityId: row.id,
    detail: `batch=${row.batchId}`,
  });
}

/** Tells other tablets that patients changed (same as POST /api/sync/push). */
async function announceChange() {
  await publishChange(await currentCursor()).catch(() => undefined);
}

export async function decideRow(
  batchId: string,
  rowId: string,
  input: ImportRowDecisionInput,
  ctx: DecisionContext,
): Promise<ImportBatchView> {
  const row = await loadOpenRow(batchId, rowId);
  if (input.action === "register") await registerRow(row, ctx);
  else if (input.action === "isHer") await isHerRow(row, input.patientId, ctx);
  else await discardRow(row, ctx);
  await refreshBatchStatus(batchId);
  if (input.action !== "discard") await announceChange();
  return getBatchView(batchId);
}

/** "Registrar todas las nuevas": every NEW row (never POSSIBLE_MATCH), after the person confirmed. */
export async function registerAllNew(batchId: string, ctx: DecisionContext) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { id: true } });
  if (!batch) throw new ImportError("No encontramos este archivo.", 404);
  const rows = await db.importRow.findMany({ where: { batchId, status: "NEW" }, orderBy: { rowNumber: "asc" } });
  let registered = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await registerRow(row, ctx);
      registered++;
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      failed++;
    }
  }
  await refreshBatchStatus(batchId);
  if (registered > 0) await announceChange();
  return { registered, failed, batch: await getBatchView(batchId) };
}
