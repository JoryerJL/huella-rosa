import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { login, loginOffline } from "./auth";
import { es } from "../i18n/es";

// Fictitious staff only (CLAUDE.md rule 1).
const profile = { id: "u-intake-1", name: "Guadalupe Hernández", role: "intake" as const };

function mockServer(ok: boolean) {
  const fetchMock = vi.fn(async () =>
    ok
      ? new Response(JSON.stringify({ profile }), { status: 200 })
      : new Response(JSON.stringify({ error: "Usuario o PIN incorrectos." }), { status: 401 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  await db.credentials.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("online login", () => {
  it("sends username + PIN and stores a PBKDF2 verifier, never the PIN", async () => {
    const fetchMock = mockServer(true);
    const result = await login("Guadalupe.H", "4821", true);

    expect(result).toMatchObject({ ok: true, profile });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      username: "guadalupe.h",
      pin: "4821",
    });
    const cred = await db.credentials.get("guadalupe.h");
    expect(cred).toBeDefined();
    expect(JSON.stringify(cred)).not.toContain("4821");
    expect(cred!.salt).toMatch(/^[A-Za-z0-9+/=]{24}$/); // 16 random bytes
    expect(cred!.failedAttempts).toBe(0);
  });

  it("shows the server message when the PIN is wrong and stores nothing", async () => {
    mockServer(false);
    const result = await login("guadalupe.h", "0000", true);
    expect(result).toEqual({ ok: false, error: "Usuario o PIN incorrectos." });
    expect(await db.credentials.count()).toBe(0);
  });
});

describe("offline unlock", () => {
  beforeEach(async () => {
    mockServer(true);
    await login("guadalupe.h", "4821", true);
  });

  it("lets someone who entered before on this device in with the right PIN", async () => {
    expect(await loginOffline("guadalupe.h", "4821")).toMatchObject({ ok: true, profile });
  });

  it("falls back to the offline rules when the network fails while marked online", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await login("guadalupe.h", "4821", true)).toMatchObject({ ok: true, profile });
  });

  it("refuses a username that never entered with signal on this device", async () => {
    expect(await loginOffline("alberto.g", "4821")).toEqual({ ok: false, error: es.login.offlineUnknown });
  });

  it("refuses after 4 days without an online login", async () => {
    const later = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000 + 60_000);
    expect(await loginOffline("guadalupe.h", "4821", later)).toEqual({ ok: false, error: es.login.offlineExpired });
  });

  it("locks the username on this device for 15 minutes after 5 wrong PINs", async () => {
    for (let left = 4; left >= 1; left--) {
      expect(await loginOffline("guadalupe.h", "1111")).toEqual({ ok: false, error: es.login.wrongPin(left) });
    }
    expect(await loginOffline("guadalupe.h", "1111")).toEqual({ ok: false, error: es.login.locked(15) });
    // Even the right PIN is refused while locked.
    expect(await loginOffline("guadalupe.h", "4821")).toEqual({ ok: false, error: es.login.locked(15) });
    // After 15 minutes the right PIN works again.
    const after = new Date(Date.now() + 15 * 60_000 + 1000);
    expect(await loginOffline("guadalupe.h", "4821", after)).toMatchObject({ ok: true });
  });
});
