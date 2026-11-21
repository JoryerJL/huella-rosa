import type { OpResult, PullResponse, SyncPushResponse } from "@er/shared";
import { db, getPackageMeta, getSyncMeta, setSyncMeta, type LocalPatient } from "./db";
import { ApiError, request } from "../lib/http";
import { es } from "../i18n/es";

// Sync engine (SPEC 6.5, 6.8): push the outbox in order, then pull changes since the stored cursor.
// Runs when the app opens, on the `online` event, every 30 s and on an SSE "changed" event.

export const PUSH_BATCH_SIZE = 50;
const INTERVAL_MS = 30_000;

export interface SyncState {
  running: boolean;
  /** Plain Spanish message when the last attempt could not finish (e.g. the session ended). */
  error: string | null;
}

let state: SyncState = { running: false, error: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribeSyncState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncState(): SyncState {
  return state;
}

function settle(result: OpResult | undefined) {
  if (!result) return null; // Not answered: stays pending and goes again next time.
  const now = new Date().toISOString();
  if (result.status === "APPLIED" || result.status === "DUPLICATE") {
    return { status: "sent" as const, resultStatus: result.status, message: undefined, updatedAt: now };
  }
  // CONFLICT and REJECTED are final on the server: keep them visible, never resend.
  return {
    status: "failed" as const,
    resultStatus: result.status,
    message: result.message ?? es.visit.status[result.status],
    updatedAt: now,
  };
}

async function pushOutbox(): Promise<void> {
  for (;;) {
    const batch = await db.outbox.where("status").equals("pending").sortBy("seq");
    const slice = batch.slice(0, PUSH_BATCH_SIZE);
    if (slice.length === 0) return;
    const res = await request<SyncPushResponse>("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ ops: slice.map((e) => e.op) }),
    });
    const byId = new Map(res.results.map((r) => [r.opId, r]));
    let answered = 0;
    await db.transaction("rw", db.outbox, async () => {
      for (const entry of slice) {
        const patch = settle(byId.get(entry.opId));
        if (patch && entry.seq !== undefined) {
          answered++;
          await db.outbox.update(entry.seq, patch);
        }
      }
    });
    if (answered === 0) return; // Avoid looping on a batch the server ignored.
  }
}

async function pull(): Promise<void> {
  const pkg = await getPackageMeta();
  if (!pkg) return; // Devices without a campaign package (clinician) read from the server directly.
  const { cursor } = await getSyncMeta();
  const params = new URLSearchParams({ campaignId: pkg.campaignId });
  if (cursor) params.set("cursor", cursor);
  const res = await request<PullResponse>(`/api/sync/pull?${params.toString()}`);
  await db.transaction("rw", db.patients, db.visits, async () => {
    for (const incoming of res.patients) {
      const existing = await db.patients.get(incoming.id);
      // Server is the source for package fields; keep fields only this device knows.
      const merged: LocalPatient = {
        ...incoming,
        residence: existing?.residence ?? null,
        affiliation: existing?.affiliation ?? null,
      };
      await db.patients.put(merged);
    }
    if (res.visits.length) await db.visits.bulkPut(res.visits);
  });
  await setSyncMeta({ cursor: res.cursor });
}

let inFlight: Promise<void> | null = null;

/** One sync pass; concurrent calls share the same run. Never throws. */
export function syncNow(): Promise<void> {
  if (inFlight) return inFlight;
  if (!navigator.onLine) return Promise.resolve();
  inFlight = (async () => {
    setState({ running: true });
    try {
      await pushOutbox();
      await pull();
      await setSyncMeta({ lastSyncAt: new Date().toISOString() });
      setState({ error: null });
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 401
          ? es.sync.needsLogin
          : err instanceof Error
            ? err.message
            : es.errors.generic;
      setState({ error: message });
    } finally {
      setState({ running: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Fire-and-forget sync after a local write. */
export function requestSync(): void {
  void syncNow();
}

/** Starts the background engine for a signed-in session; returns a stop function. */
export function startSyncEngine(): () => void {
  let events: EventSource | null = null;

  const openEvents = () => {
    if (events || typeof EventSource === "undefined") return;
    events = new EventSource("/api/sync/events", { withCredentials: true });
    events.addEventListener("changed", () => requestSync());
  };
  const closeEvents = () => {
    events?.close();
    events = null;
  };

  const onOnline = () => {
    openEvents();
    requestSync();
  };
  const onOffline = () => closeEvents();

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  const timer = window.setInterval(() => requestSync(), INTERVAL_MS);
  if (navigator.onLine) onOnline();

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.clearInterval(timer);
    closeEvents();
  };
}
