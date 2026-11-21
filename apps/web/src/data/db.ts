import Dexie, { type EntityTable } from "dexie";
import type {
  CampaignView,
  OpResultStatus,
  PackagePatient,
  PackageVisit,
  StaffProfile,
  SyncOp,
  VisitStepView,
} from "@er/shared";

// Local-first storage (SPEC 6.8, 9.1). Every capture screen reads and writes here; the sync engine
// moves the outbox to the server and pulls changes back. Never store a PIN or clinical data here.

/** Package patient plus fields only known on this device (typed by intake, not yet synced back). */
export interface LocalPatient extends PackagePatient {
  residence?: string | null;
  affiliation?: string | null;
}

/**
 * Package/pull visit plus what this device knows about its steps (SPEC 6.3.1). `patientName` and
 * `patientBirthDate` come from GET /api/queue when the patient is not in the local package.
 */
export interface LocalVisit extends PackageVisit {
  steps?: VisitStepView[];
  /** When intake registered the visit (ISO). Orders "Pacientes esperándome". */
  registeredAt?: string;
  patientName?: string;
  patientBirthDate?: string;
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

/** Folio prefix assigned by the server to this tablet, plus the local sequence counter. */
export interface DeviceMeta {
  folioPrefix: string;
  /** Next sequence number to use; never reused on this device. */
  nextSeq: number;
}

/** Block 3a: a compressed form photo waiting for signal (SPEC 6.4 item 3, 6.8 item 4). */
export interface QueuedScan {
  seq?: number;
  blob: Blob;
  /** Original name, kept so the demo reading can match its sample form. */
  name: string;
  visitId: string | null;
  campaignId: string | null;
  folio: string | null;
  createdAt: string;
}

export interface MetaRow {
  key: "package" | "sync" | "device";
  value: PackageMeta | SyncMeta | DeviceMeta;
}

export const db = new Dexie("huella-rosa") as Dexie & {
  patients: EntityTable<LocalPatient, "id">;
  visits: EntityTable<LocalVisit, "id">;
  outbox: EntityTable<OutboxEntry, "seq">;
  credentials: EntityTable<Credential, "username">;
  meta: EntityTable<MetaRow, "key">;
  scanQueue: EntityTable<QueuedScan, "seq">;
};

db.version(1).stores({
  patients: "id, birthDate, formId, linkedToId",
  visits: "id, patientId",
  outbox: "++seq, &opId, status",
  credentials: "&username",
  meta: "&key",
});

// v2: visits looked up by the short folio typed at the specialist stations.
db.version(2).stores({
  visits: "id, patientId, folio",
});

// v3 (block 3a): form photos queued on the device until there is signal.
db.version(3).stores({
  scanQueue: "++seq, visitId, folio",
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

export async function getDeviceMeta(): Promise<DeviceMeta | null> {
  return ((await db.meta.get("device"))?.value as DeviceMeta | undefined) ?? null;
}

/** Keeps local step state when the incoming visit has none (server data may not carry steps yet). */
export function mergeVisit(incoming: LocalVisit, existing: LocalVisit | undefined): LocalVisit {
  if (!existing) return incoming;
  return {
    ...incoming,
    steps: incoming.steps ?? existing.steps,
    registeredAt: incoming.registeredAt ?? existing.registeredAt,
    patientName: incoming.patientName ?? existing.patientName,
    patientBirthDate: incoming.patientBirthDate ?? existing.patientBirthDate,
  };
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
