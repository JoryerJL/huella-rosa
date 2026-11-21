import { useEffect, useState, useSyncExternalStore, type DependencyList } from "react";
import { liveQuery } from "dexie";
import { db, getPackageMeta, getSyncMeta, type OutboxEntry, type PackageMeta, type SyncMeta } from "./db";
import { getSyncState, subscribeSyncState, type SyncState } from "./sync";
import { groupStepEntries } from "./steps";

/** Re-renders whenever the IndexedDB data read by `query` changes. */
export function useLive<T>(query: () => Promise<T>, deps: DependencyList, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: () => undefined });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export interface OutboxSummary {
  pending: number;
  /** createdAt of the oldest pending op. */
  oldestPendingAt: string | null;
  failed: OutboxEntry[];
  /** Pending ops whose visit has not reached the server yet (WAITING): still counted in `pending`. */
  waiting: OutboxEntry[];
  /** Station steps among `waiting`: one step saved offline is several changes but counts once. */
  waitingSteps: number;
  /** Block 3a: form photos saved on this device and not sent yet (also counted in `pending`). */
  photos: number;
}

export function useOutboxSummary(): OutboxSummary {
  return useLive<OutboxSummary>(
    async () => {
      const pending = await db.outbox.where("status").equals("pending").sortBy("seq");
      const failed = await db.outbox.where("status").equals("failed").sortBy("seq");
      const waiting = pending.filter((e) => e.resultStatus === "WAITING");
      const photos = await db.scanQueue.count();
      const firstPhoto = await db.scanQueue.orderBy("seq").first();
      const oldest = [pending[0]?.createdAt, firstPhoto?.createdAt].filter((x): x is string => !!x).sort()[0] ?? null;
      return { pending: pending.length + photos, oldestPendingAt: oldest, failed, waiting, waitingSteps: groupStepEntries(waiting).length, photos };
    },
    [],
    { pending: 0, oldestPendingAt: null, failed: [], waiting: [], waitingSteps: 0, photos: 0 },
  );
}

export interface PackageStatus {
  loaded: boolean;
  meta: PackageMeta | null;
  patientCount: number;
  sync: SyncMeta;
}

export function usePackageStatus(): PackageStatus {
  return useLive<PackageStatus>(
    async () => ({
      loaded: true,
      meta: await getPackageMeta(),
      patientCount: await db.patients.count(),
      sync: await getSyncMeta(),
    }),
    [],
    { loaded: false, meta: null, patientCount: 0, sync: { cursor: null, lastSyncAt: null } },
  );
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState);
}
