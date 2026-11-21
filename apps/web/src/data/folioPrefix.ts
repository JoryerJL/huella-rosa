import type { DeviceRegistration } from "@er/shared";
import { db, getDeviceMeta, type DeviceMeta } from "./db";
import { getDeviceId } from "../lib/device";
import { formatFolio } from "../lib/folio";
import { request } from "../lib/http";

// Each tablet gets a unique folio prefix from the server the first time someone logs in with signal
// (SPEC 6.3.1). With it, two tablets without signal never generate the same folio.

/** Asks the server for this tablet's prefix once; keeps the local counter. Never throws. */
export async function ensureFolioPrefix(): Promise<DeviceMeta | null> {
  const current = await getDeviceMeta();
  if (current) return current;
  try {
    const res = await request<DeviceRegistration>("/api/devices/register", {
      method: "POST",
      body: JSON.stringify({ deviceId: getDeviceId() }),
    });
    if (!res.folioPrefix) return null;
    return await db.transaction("rw", db.meta, async () => {
      // Another tab may have registered meanwhile: keep its counter.
      const again = await getDeviceMeta();
      if (again) return again;
      const meta: DeviceMeta = { folioPrefix: res.folioPrefix, nextSeq: 1 };
      await db.meta.put({ key: "device", value: meta });
      return meta;
    });
  } catch {
    return null; // No signal or endpoint not available yet: the visit form explains it.
  }
}

/**
 * The folio the next saved visit will get, without consuming it. The visit form shows this on
 * render (React may render it twice), and the number is only taken when the visit is saved.
 */
export async function peekFolio(): Promise<string | null> {
  const meta = await getDeviceMeta();
  return meta ? formatFolio(meta.folioPrefix, meta.nextSeq) : null;
}

/**
 * Takes the next folio of this tablet. Called inside the transaction that saves the visit, so a
 * failed save rolls the counter back: numbers are never skipped nor handed out twice.
 */
export async function reserveFolio(): Promise<string | null> {
  return db.transaction("rw", db.meta, async () => {
    const meta = await getDeviceMeta();
    if (!meta) return null;
    await db.meta.put({ key: "device", value: { ...meta, nextSeq: meta.nextSeq + 1 } });
    return formatFolio(meta.folioPrefix, meta.nextSeq);
  });
}
