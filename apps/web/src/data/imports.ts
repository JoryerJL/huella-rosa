import type {
  ImportBatchList,
  ImportBatchView,
  ImportField,
  ImportRegisterNewResponse,
  ImportRowDecisionInput,
} from "@er/shared";
import { ApiError, request } from "../lib/http";
import { es } from "../i18n/es";

// Excel import (SPEC 6.7) is online only: these calls go straight to /api/imports.
// Patients created here reach the tablets through the usual pull (the server announces the change).

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_TEMPLATE_URL = "/api/imports/template";

export function listImportBatches() {
  return request<ImportBatchList>("/api/imports");
}

export function getImportBatch(id: string) {
  return request<ImportBatchView>(`/api/imports/${encodeURIComponent(id)}`);
}

export function uploadImportFile(file: File) {
  if (file.size > IMPORT_MAX_BYTES) return Promise.reject(new ApiError(es.imports.tooBig, 413));
  const body = new FormData();
  body.set("file", file);
  return request<ImportBatchView>("/api/imports", { method: "POST", body });
}

export function confirmImportMapping(id: string, columns: { index: number; field: ImportField | null }[]) {
  return request<ImportBatchView>(`/api/imports/${encodeURIComponent(id)}/mapping`, {
    method: "POST",
    body: JSON.stringify({ columns }),
  });
}

export function decideImportRow(batchId: string, rowId: string, decision: ImportRowDecisionInput) {
  return request<ImportBatchView>(`/api/imports/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}`, {
    method: "POST",
    body: JSON.stringify(decision),
  });
}

export function registerAllNewRows(batchId: string) {
  return request<ImportRegisterNewResponse>(`/api/imports/${encodeURIComponent(batchId)}/register-new`, {
    method: "POST",
  });
}
