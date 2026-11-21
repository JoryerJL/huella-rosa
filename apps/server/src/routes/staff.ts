import { Hono, type Context } from "hono";
import { Prisma } from "@prisma/client";
import { createStaffSchema, isRole, type StaffView } from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { hashPin } from "../pin";
import { destroyUserSessions, requireRole, type SessionEnv } from "../session";

// Staff administration (SPEC 6.0). Admin only, checked on the server (rule 7).
// PINs are never returned, logged or written to the audit log.

const FIELD_ERRORS: Record<string, string> = {
  name: "Escribe el nombre completo.",
  username: "El usuario lleva de 3 a 40 letras minúsculas, números o puntos, sin espacios ni acentos.",
  role: "Elige un rol.",
  pin: "El PIN lleva de 4 a 6 números.",
};
const DUPLICATE_USERNAME = "Ese usuario ya existe. Prueba con otro.";
const NOT_FOUND = "No encontramos a esa persona.";

const deviceOf = (c: Context) => c.req.header("x-device-id") ?? null;

const staffSelect = { id: true, name: true, username: true, role: true, active: true, createdAt: true } as const;

function toStaffView(row: Prisma.UserGetPayload<{ select: typeof staffSelect }>): StaffView {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: isRole(row.role) ? row.role : "intake",
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

async function setActive(c: Context<SessionEnv>, active: boolean) {
  const staff = c.get("staff");
  const id = c.req.param("id")!;
  if (!active && id === staff.id) {
    return c.json({ error: "No puedes desactivar tu propio usuario." }, 400);
  }
  const user = await db.user.findUnique({ where: { id }, select: staffSelect });
  if (!user) return c.json({ error: NOT_FOUND }, 404);
  if (user.active === active) return c.json({ staff: toStaffView(user) });

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.user.update({ where: { id }, data: { active }, select: staffSelect });
    await writeAudit(
      {
        actorId: staff.id,
        action: active ? "STAFF_REACTIVATED" : "STAFF_DEACTIVATED",
        deviceId: deviceOf(c),
        entity: "User",
        entityId: id,
        detail: `role=${row.role}`,
      },
      tx,
    );
    return row;
  });
  // Signed out everywhere: their next request gets 401 and their PIN no longer opens a session.
  if (!active) await destroyUserSessions(id);
  return c.json({ staff: toStaffView(updated) });
}

export const staffRoutes = new Hono<SessionEnv>()
  .get("/", requireRole("admin"), async (c) => {
    const rows = await db.user.findMany({ select: staffSelect, orderBy: [{ role: "asc" }, { name: "asc" }] });
    return c.json({ staff: rows.map(toStaffView) });
  })
  .post("/", requireRole("admin"), async (c) => {
    const parsed = createStaffSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "");
      return c.json({ error: FIELD_ERRORS[field] ?? "Revisa los datos e intenta de nuevo.", field }, 400);
    }
    const { name, username, role, pin } = parsed.data;
    const staff = c.get("staff");
    if (await db.user.findUnique({ where: { username }, select: { id: true } })) {
      return c.json({ error: DUPLICATE_USERNAME, field: "username" }, 409);
    }
    try {
      const created = await db.$transaction(async (tx) => {
        const row = await tx.user.create({
          data: { id: `usr-${crypto.randomUUID()}`, name, username, role, pinHash: hashPin(pin) },
          select: staffSelect,
        });
        await writeAudit(
          { actorId: staff.id, action: "STAFF_CREATED", deviceId: deviceOf(c), entity: "User", entityId: row.id, detail: `role=${role}` },
          tx,
        );
        return row;
      });
      return c.json({ staff: toStaffView(created) }, 201);
    } catch (error) {
      // Two admins creating the same username at once: the unique index decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return c.json({ error: DUPLICATE_USERNAME, field: "username" }, 409);
      }
      throw error;
    }
  })
  .post("/:id/deactivate", requireRole("admin"), (c) => setActive(c, false))
  .post("/:id/reactivate", requireRole("admin"), (c) => setActive(c, true));
