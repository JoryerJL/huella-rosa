import { useEffect, useState, useSyncExternalStore, type DependencyList } from "react";
import { liveQuery } from "dexie";
import { db, getPackageMeta, getSyncMeta, type OutboxEntry, type PackageMeta, type SyncMeta } from "./db";
import { getSyncState, subscribeSyncState, type SyncState } from "./sync";

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
}

export function useOutboxSummary(): OutboxSummary {
  return useLive<OutboxSummary>(
    async () => {
      const pending = await db.outbox.where("status").equals("pending").sortBy("seq");
      const failed = await db.outbox.where("status").equals("failed").sortBy("seq");
      return { pending: pending.length, oldestPendingAt: pending[0]?.createdAt ?? null, failed };
    },
    [],
    { pending: 0, oldestPendingAt: null, failed: [] },
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
