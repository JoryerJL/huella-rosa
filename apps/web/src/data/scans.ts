import type { ScanView } from "@er/shared";
import { db, type QueuedScan } from "./db";
import { ApiError, request } from "../lib/http";
import { getDeviceId } from "../lib/device";
import { es } from "../i18n/es";

// Form photos (SPEC 6.4). "Identificar con foto" uploads right away (needs signal);
// "Adjuntar foto del formato" queues the compressed photo here and the sync engine uploads it.

export interface ScanLink {
  visitId: string | null;
  campaignId: string | null;
  folio: string | null;
}

/** POST /api/scans as multipart. Throws ApiError (status 0 = no connection). */
export async function uploadScan(blob: Blob, name: string, link: Partial<ScanLink> = {}): Promise<ScanView> {
  const form = new FormData();
  form.append("image", blob, name);
  for (const [key, value] of Object.entries(link)) if (value) form.append(key, value);
  let res: Response;
  try {
    res = await fetch("/api/scans", {
      method: "POST",
      body: form,
      credentials: "include",
      headers: { "x-device-id": getDeviceId() },
    });
  } catch {
    throw new ApiError(es.errors.network, 0);
  }
  if (!res.ok) {
    let message: string = res.status === 401 ? es.errors.sessionExpired : es.scan.uploadError;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as ScanView;
}

/** Saves the photo on this device, linked to the visit; it is sent at the next sync. */
export async function queueScan(blob: Blob, name: string, link: ScanLink): Promise<number> {
  const entry: QueuedScan = { blob, name, ...link, createdAt: new Date().toISOString() };
  return (await db.scanQueue.add(entry)) as number;
}

/**
 * Uploads queued photos in order and deletes each blob once the server has it. Runs after the
 * outbox so the visit usually exists already. Stops at the first failure and keeps the rest.
 */
export async function pushScanQueue(upload: typeof uploadScan = uploadScan): Promise<number> {
  const queued = await db.scanQueue.orderBy("seq").toArray();
  let sent = 0;
  for (const entry of queued) {
    await upload(entry.blob, entry.name, { visitId: entry.visitId, campaignId: entry.campaignId, folio: entry.folio });
    if (entry.seq !== undefined) await db.scanQueue.delete(entry.seq);
    sent++;
  }
  return sent;
}

export function listScans(query: { visitId?: string; campaignId?: string; folio?: string }): Promise<ScanView[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  return request<ScanView[]>(`/api/scans?${params.toString()}`);
}

export function confirmScan(id: string, fields: string[]): Promise<ScanView> {
  return request<ScanView>(`/api/scans/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}
