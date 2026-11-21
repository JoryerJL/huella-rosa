import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { ROLES, deviceNameSchema, type DeviceRegistration } from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { valkey } from "../valkey";
import { requireRole, type SessionEnv } from "../session";

// Each tablet gets a unique folio prefix the first time it is online (SPEC 6.3.1), so two
// tablets without signal never generate the same short folio.

const PREFIX_COUNTER_KEY = "device:prefix:counter";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** A1..A9, B1..B9, ... Z9. */
const MAX_PREFIXES = LETTERS.length * 9;
const MAX_ATTEMPTS = 20;

function prefixFromCounter(n: number): string | null {
  const index = n - 1;
  if (index < 0 || index >= MAX_PREFIXES) return null;
  return `${LETTERS[Math.floor(index / 9)]}${(index % 9) + 1}`;
}

/** Next counter value; falls back to the database when Valkey is unreachable. */
async function nextCounter(attempt: number): Promise<number> {
  try {
    return await valkey.incr(PREFIX_COUNTER_KEY);
  } catch {
    return (await db.device.count()) + 1 + attempt;
  }
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}

const MISSING_DEVICE = "Falta el identificador de la tableta. Recarga la aplicación.";

function deviceIdOf(header: string | undefined): string | null {
  const id = header?.trim();
  return id && id.length <= 128 ? id : null;
}

export const deviceRoutes = new Hono<SessionEnv>()
  // Names the tablet the request comes from, e.g. "Tableta de captura 1" (any role, own tablet only).
  .put("/name", requireRole(...ROLES), async (c) => {
    const staff = c.get("staff");
    const deviceId = deviceIdOf(c.req.header("x-device-id"));
    if (!deviceId) return c.json({ error: MISSING_DEVICE }, 400);
    const parsed = deviceNameSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Escribe un nombre para la tableta." }, 400);
    }
    const existing = await db.device.findUnique({ where: { id: deviceId } });
    if (!existing) return c.json({ error: "Esta tableta todavía no está registrada. Entra con señal e intenta de nuevo." }, 404);
    const device = await db.device.update({ where: { id: deviceId }, data: { name: parsed.data.name } });
    await writeAudit({ actorId: staff.id, action: "DEVICE_NAMED", deviceId, entity: "Device", entityId: deviceId, detail: null });
    return c.json({ deviceId, folioPrefix: device.folioPrefix, name: device.name } satisfies DeviceRegistration);
  })
  .post("/register", requireRole(...ROLES), async (c) => {
  const staff = c.get("staff");
  const deviceId = deviceIdOf(c.req.header("x-device-id"));
  if (!deviceId) return c.json({ error: MISSING_DEVICE }, 400);

  const existing = await db.device.findUnique({ where: { id: deviceId } });
  if (existing) {
    const body: DeviceRegistration = { deviceId, folioPrefix: existing.folioPrefix, name: existing.name };
    return c.json(body);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const prefix = prefixFromCounter(await nextCounter(attempt));
    if (!prefix) break;
    try {
      const device = await db.device.create({ data: { id: deviceId, folioPrefix: prefix } });
      await writeAudit({
        actorId: staff.id,
        action: "DEVICE_REGISTERED",
        deviceId,
        entity: "Device",
        entityId: deviceId,
        detail: `prefix=${device.folioPrefix}`,
      });
      const body: DeviceRegistration = { deviceId, folioPrefix: device.folioPrefix, name: device.name };
      return c.json(body);
    } catch (error) {
      // Same tablet registered concurrently: answer with the prefix it already got.
      if (isUniqueViolation(error, "id")) {
        const winner = await db.device.findUnique({ where: { id: deviceId } });
        if (winner) return c.json({ deviceId, folioPrefix: winner.folioPrefix, name: winner.name } satisfies DeviceRegistration);
      }
      // Prefix taken (e.g. the Valkey counter was reset): try the next one.
      if (isUniqueViolation(error, "folioPrefix")) continue;
      throw error;
    }
  }
  return c.json({ error: "No quedan prefijos de folio disponibles. Avisa a administración." }, 503);
});
