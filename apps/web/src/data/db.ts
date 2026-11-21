import Dexie, { type EntityTable } from "dexie";
import type {
  CampaignView,
  OpResultStatus,
  PackagePatient,
  PackageVisit,
  StaffProfile,
  SyncOp,
} from "@er/shared";

// Local-first storage (SPEC 6.8, 9.1). Every capture screen reads and writes here; the sync engine
// moves the outbox to the server and pulls changes back. Never store a PIN or clinical data here.

/** Package patient plus fields only known on this device (typed by intake, not yet synced back). */
export interface LocalPatient extends PackagePatient {
  residence?: string | null;
  affiliation?: string | null;
}

export type OutboxStatus = "pending" | "sent" | "failed";

export interface OutboxEntry {
  /** Auto-increment: push order. */
  seq?: number;
  opId: string;
  kind: SyncOp["kind"];
  op: SyncOp;
  status: OutboxStatus;
  /** Server verdict once pushed. */
  resultStatus?: OpResultStatus;
  /** Plain Spanish message for CONFLICT / REJECTED, shown to the user. */
  message?: string;
  createdAt: string;
  updatedAt: string;
}

/** Saved after an online login so the same person can unlock offline (no PIN stored). */
export interface Credential {
  username: string;
  profile: StaffProfile;
  salt: string;
  pinHash: string;
  /** Last successful online login; offline unlock is allowed for 4 days after it. */
  sessionSavedAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
}

export interface PackageMeta {
  campaignId: string;
  campaign: CampaignView;
  campaigns: CampaignView[];
  generatedAt: string;
  expiresAt: string;
}

export interface SyncMeta {
  cursor: string | null;
  lastSyncAt: string | null;
}

export interface MetaRow {
  key: "package" | "sync";
  value: PackageMeta | SyncMeta;
}

export const db = new Dexie("expediente-rosa") as Dexie & {
  patients: EntityTable<LocalPatient, "id">;
  visits: EntityTable<PackageVisit, "id">;
  outbox: EntityTable<OutboxEntry, "seq">;
  credentials: EntityTable<Credential, "username">;
  meta: EntityTable<MetaRow, "key">;
};

db.version(1).stores({
  patients: "id, birthDate, formId, linkedToId",
  visits: "id, patientId",
  outbox: "++seq, &opId, status",
  credentials: "&username",
  meta: "&key",
});

export async function getPackageMeta(): Promise<PackageMeta | null> {
  return ((await db.meta.get("package"))?.value as PackageMeta | undefined) ?? null;
}

export async function getSyncMeta(): Promise<SyncMeta> {
  return ((await db.meta.get("sync"))?.value as SyncMeta | undefined) ?? { cursor: null, lastSyncAt: null };
}

export async function setSyncMeta(patch: Partial<SyncMeta>): Promise<void> {
  const current = await getSyncMeta();
  await db.meta.put({ key: "sync", value: { ...current, ...patch } });
}

export function isPackageExpired(meta: PackageMeta, now = new Date()): boolean {
  return new Date(meta.expiresAt).getTime() <= now.getTime();
}

let persistRequested = false;
/** Ask the browser not to evict our data under storage pressure (SPEC 9.1). Once per app run. */
export function requestPersistentStorage(): void {
  if (persistRequested) return;
  persistRequested = true;
  void navigator.storage?.persist?.().catch(() => false);
}
