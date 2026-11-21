import { Hono } from "hono";
import { isRole, loginSchema, type StaffProfile } from "@er/shared";
import { db } from "../db";
import { valkey } from "../valkey";
import { writeAudit } from "../audit";
import { hashPin, verifyPin } from "../pin";
import { createSession, destroySession, readSession, SESSION_TTL_SECONDS } from "../session";

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;
// Same message for an unknown username and a wrong PIN: never reveal which usernames exist.
const LOGIN_FAILED_MESSAGE = "El usuario o el PIN no coinciden. Revisa e intenta de nuevo.";
// Compared against when the username does not exist, so both failures take about the same time.
const DUMMY_PIN_HASH = hashPin("000000");

// Staff log in with username + PIN; the server never lists staff (SPEC 6.8 item 1).
export const authRoutes = new Hono()
  .post("/login", async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Escribe tu usuario y tu PIN de 4 a 6 números." }, 400);
    }
    const { username, pin } = parsed.data;
    const deviceId = c.req.header("x-device-id") ?? null;

    // Valkey rate limit per username (known or not, so the limit reveals nothing either).
    const attemptsKey = `ratelimit:login:${username}`;
    const attempts = await valkey.incr(attemptsKey);
    if (attempts === 1) await valkey.expire(attemptsKey, LOGIN_WINDOW_SECONDS);
    if (attempts > MAX_LOGIN_ATTEMPTS) {
      return c.json({ error: "Demasiados intentos. Espera 15 minutos o pide ayuda." }, 429);
    }

    const user = await db.user.findUnique({ where: { username } });
    const pinOk = verifyPin(pin, user?.pinHash ?? DUMMY_PIN_HASH);
    if (!user || !isRole(user.role) || !pinOk) {
      // Attempted usernames that do not exist are not stored: they may be personal data.
      await writeAudit({ actorId: user?.id ?? "unknown", action: "LOGIN_FAILED", deviceId });
      return c.json({ error: LOGIN_FAILED_MESSAGE }, 401);
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
