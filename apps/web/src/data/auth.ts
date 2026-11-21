import { isRole, loginSchema, type StaffProfile } from "@er/shared";
import { db, requestPersistentStorage } from "./db";
import { ensureFolioPrefix } from "./folioPrefix";
import { ApiError, request } from "../lib/http";
import { createPinVerifier, verifyPin } from "../lib/pinVerifier";
import { es } from "../i18n/es";

// Username + PIN login (SPEC 6.8 item 1). With signal the server decides; without signal only someone
// who already entered with signal on this device in the last 4 days can unlock with their PIN.

export const OFFLINE_SESSION_DAYS = 4;
export const MAX_PIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LoginResult =
  | { ok: true; profile: StaffProfile; /** Last online validation. */ sessionSavedAt: string }
  | { ok: false; error: string };

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Online login; on success stores a PIN verifier (never the PIN) for offline unlock. */
async function loginOnline(username: string, pin: string): Promise<LoginResult> {
  const data = await request<{ profile?: StaffProfile }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, pin }),
  });
  if (!data.profile || !isRole(data.profile.role)) return { ok: false, error: es.login.genericError };

  const verifier = await createPinVerifier(pin);
  const sessionSavedAt = new Date().toISOString();
  await db.credentials.put({
    username,
    profile: data.profile,
    ...verifier,
    sessionSavedAt,
    failedAttempts: 0,
    lockedUntil: null,
  });
  requestPersistentStorage();
  // Once per tablet: the folio prefix intake needs to register visits without signal.
  void ensureFolioPrefix();
  return { ok: true, profile: data.profile, sessionSavedAt };
}

/** Offline unlock against the stored verifier, with a per-device lock after 5 wrong PINs. */
export async function loginOffline(username: string, pin: string, now = new Date()): Promise<LoginResult> {
  const cred = await db.credentials.get(username);
  if (!cred) return { ok: false, error: es.login.offlineUnknown };

  if (now.getTime() - new Date(cred.sessionSavedAt).getTime() > OFFLINE_SESSION_DAYS * DAY_MS) {
    return { ok: false, error: es.login.offlineExpired };
  }

  if (cred.lockedUntil && new Date(cred.lockedUntil).getTime() > now.getTime()) {
    const minutes = Math.ceil((new Date(cred.lockedUntil).getTime() - now.getTime()) / 60_000);
    return { ok: false, error: es.login.locked(minutes) };
  }

  if (await verifyPin(pin, cred)) {
    await db.credentials.update(username, { failedAttempts: 0, lockedUntil: null });
    requestPersistentStorage();
    return { ok: true, profile: cred.profile, sessionSavedAt: cred.sessionSavedAt };
  }

  // A finished lock starts a fresh count.
  const previous = cred.lockedUntil ? 0 : cred.failedAttempts;
  const failedAttempts = previous + 1;
  if (failedAttempts >= MAX_PIN_ATTEMPTS) {
    await db.credentials.update(username, {
      failedAttempts,
      lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString(),
    });
    return { ok: false, error: es.login.locked(LOCK_MINUTES) };
  }
  await db.credentials.update(username, { failedAttempts, lockedUntil: null });
  return { ok: false, error: es.login.wrongPin(MAX_PIN_ATTEMPTS - failedAttempts) };
}

/** Tries the server first; if there is no connection, falls back to the offline unlock. */
export async function login(rawUsername: string, pin: string, online: boolean): Promise<LoginResult> {
  const parsed = loginSchema.safeParse({ username: rawUsername, pin });
  if (!parsed.success) return { ok: false, error: es.login.invalidInput };
  const username = normalizeUsername(parsed.data.username);

  if (online) {
    try {
      return await loginOnline(username, pin);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 0) {
        return { ok: false, error: err instanceof Error ? err.message : es.login.genericError };
      }
      // No connection after all: same rules as offline.
    }
  }
  return loginOffline(username, pin);
}
