import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { isRole, type Role, type StaffProfile } from "@er/shared";
import { env } from "./env";
import { valkey } from "./valkey";

// Staff session: random token in an httpOnly cookie; profile stored in Valkey with a TTL.
// 4 days so a device can work through a campaign of up to 3 days without internet (SPEC 6.8).

const COOKIE_NAME = "er_session";
export const SESSION_TTL_SECONDS = 4 * 24 * 60 * 60;

const sessionKey = (token: string) => `session:${token}`;
/** Set of a user's session tokens, so deactivating someone signs them out everywhere (SPEC 6.0). */
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;

export async function createSession(c: Context, profile: StaffProfile) {
  const token = randomBytes(32).toString("base64url");
  await valkey
    .multi()
    .set(sessionKey(token), JSON.stringify(profile), "EX", SESSION_TTL_SECONDS)
    .sadd(userSessionsKey(profile.id), token)
    .expire(userSessionsKey(profile.id), SESSION_TTL_SECONDS)
    .exec();
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProduction,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function readSession(c: Context): Promise<StaffProfile | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  const raw = await valkey.get(sessionKey(token));
  if (!raw) return null;
  try {
    const profile = JSON.parse(raw) as StaffProfile;
    return isRole(profile.role) ? profile : null;
  } catch {
    return null;
  }
}

export async function destroySession(c: Context, userId?: string) {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    await valkey.del(sessionKey(token));
    if (userId) await valkey.srem(userSessionsKey(userId), token);
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/** Deletes every open session of a user (deactivation). Returns how many were still alive. */
export async function destroyUserSessions(userId: string): Promise<number> {
  const tokens = await valkey.smembers(userSessionsKey(userId));
  const removed = tokens.length > 0 ? await valkey.del(...tokens.map(sessionKey)) : 0;
  await valkey.del(userSessionsKey(userId));
  return removed;
}

export type SessionEnv = { Variables: { staff: StaffProfile } };

/** Server-side role check (rule 7 in CLAUDE.md). 401 without session, 403 with the wrong role. */
export const requireRole = (...roles: Role[]) =>
  createMiddleware<SessionEnv>(async (c, next) => {
    const staff = await readSession(c);
    if (!staff) return c.json({ error: "Inicia sesión para continuar." }, 401);
    if (!roles.includes(staff.role)) {
      return c.json({ error: "Tu rol no tiene permiso para esta acción." }, 403);
    }
    c.set("staff", staff);
    await next();
  });
