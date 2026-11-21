import { db } from "./db";

export interface AuditEntry {
  actorId: string;
  action: string;
  deviceId?: string | null;
  entity?: string | null;
  entityId?: string | null;
  /** Short text. Never put clinical values here. */
  detail?: string | null;
}

/** Records who did what, when, from which device and on which entity (rule 6 in CLAUDE.md). */
export function writeAudit(entry: AuditEntry) {
  return db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      deviceId: entry.deviceId ?? null,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? null,
    },
  });
}
