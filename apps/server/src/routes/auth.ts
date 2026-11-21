import { Hono } from "hono";
import { isRole, loginSchema, type StaffProfile } from "@er/shared";
import { db } from "../db";
import { valkey } from "../valkey";
import { writeAudit } from "../audit";
import { verifyPin } from "../pin";
import { createSession, destroySession, readSession, SESSION_TTL_SECONDS } from "../session";

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

export const authRoutes = new Hono()
  // Demo users for the login screen: names and roles only.
  .get("/demo-users", async (c) => {
    const users = await db.user.findMany({
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    return c.json({ users });
  })
  .post("/login", async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Elige tu usuario y escribe tu PIN de 4 a 6 números." }, 400);
    }
    const { userId, pin } = parsed.data;
    const deviceId = c.req.header("x-device-id") ?? null;

    // Valkey rate limit per user.
    const attemptsKey = `ratelimit:login:${userId}`;
    const attempts = await valkey.incr(attemptsKey);
    if (attempts === 1) await valkey.expire(attemptsKey, LOGIN_WINDOW_SECONDS);
    if (attempts > MAX_LOGIN_ATTEMPTS) {
      return c.json({ error: "Demasiados intentos. Espera 15 minutos o pide ayuda." }, 429);
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || !isRole(user.role) || !verifyPin(pin, user.pinHash)) {
      await writeAudit({ actorId: userId, action: "LOGIN_FAILED", deviceId });
      return c.json({ error: "El PIN no coincide. Revisa e intenta de nuevo." }, 401);
    }

    await valkey.del(attemptsKey);
    const profile: StaffProfile = { id: user.id, name: user.name, role: user.role };
    await createSession(c, profile);
    await writeAudit({ actorId: user.id, action: "LOGIN", deviceId });
    return c.json({ profile, sessionTtlSeconds: SESSION_TTL_SECONDS });
  })
  .post("/logout", async (c) => {
    const staff = await readSession(c);
    await destroySession(c);
    if (staff) {
      await writeAudit({
        actorId: staff.id,
        action: "LOGOUT",
        deviceId: c.req.header("x-device-id") ?? null,
      });
    }
    return c.json({ ok: true });
  })
  .get("/me", async (c) => {
    const staff = await readSession(c);
    if (!staff) return c.json({ error: "Inicia sesión para continuar." }, 401);
    return c.json({ profile: staff });
  });
