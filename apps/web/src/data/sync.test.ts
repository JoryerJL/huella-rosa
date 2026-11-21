import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOp } from "@er/shared";
import { db, type PackageMeta } from "./db";
import { enqueue, opMeta } from "./patients";
import { canSync, getSyncState, setSyncUser, startSyncEngine, syncNow } from "./sync";

// Bug: on a tablet that an intake user had used, the admin's top bar showed
// "Tu rol no tiene permiso para esta acción." because the engine pulled the campaign package as admin.

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const op = () =>
  ({ ...opMeta(), kind: "COMPLETE_STEP", campaignId: "c-1", folio: "B3-001-B", confirmedName: "Lucía", role: "doctor", status: "DONE" }) as SyncOp;

beforeEach(async () => {
  await db.delete();
  await db.open();
  setSyncUser(null);
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
  setSyncUser(null);
  vi.unstubAllGlobals();
});

describe("sync permission by role", () => {
  it("only intake and clinical roles sync", () => {
    expect(canSync("intake")).toBe(true);
    expect(canSync("nutritionist")).toBe(true);
    expect(canSync("doctor")).toBe(true);
    expect(canSync("pathologist")).toBe(true);
    expect(canSync("admin")).toBe(false);
    expect(canSync(null)).toBe(false);
  });

  it("never pushes, pulls or opens the change stream for admin, even with a package and pending ops", async () => {
    const campaign = { id: "c-1", name: "Jornada Ficticia", date: "2026-11-21", endDate: "2026-11-22" } as PackageMeta["campaign"];
    const meta: PackageMeta = { campaignId: "c-1", campaign, campaigns: [campaign], generatedAt: "2026-11-21T08:00:00.000Z", expiresAt: "2026-11-25T08:00:00.000Z" };
    await db.meta.put({ key: "package", value: meta });
    await enqueue(op());
    const fetchMock = vi.fn(async () => jsonResponse({ error: "Tu rol no tiene permiso para esta acción." }, 403));
    const eventSource = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", eventSource);
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), setInterval: vi.fn(() => 1), clearInterval: vi.fn() });

    const stop = startSyncEngine({ id: "usr-admin", role: "admin" });
    await syncNow();
    stop();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(eventSource).not.toHaveBeenCalled();
    expect(getSyncState().error).toBeNull();
    // The previous person's change is kept for the next person who can send it.
    expect((await db.outbox.toArray()).map((e) => e.status)).toEqual(["pending"]);
  });

  it("clears the previous person's error when someone else signs in on the tablet", async () => {
    setSyncUser({ id: "usr-intake", role: "intake" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Tu rol no tiene permiso para esta acción." }, 403)));
    await enqueue(op());
    await syncNow();
    expect(getSyncState().error).toBe("Tu rol no tiene permiso para esta acción.");

    setSyncUser({ id: "usr-admin", role: "admin" });
    expect(getSyncState().error).toBeNull();
  });

  it("keeps the error while the same person stays signed in", async () => {
    setSyncUser({ id: "usr-intake", role: "intake" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Algo no salió bien." }, 500)));
    await enqueue(op());
    await syncNow();
    const error = getSyncState().error;
    expect(error).not.toBeNull();

    setSyncUser({ id: "usr-intake", role: "intake" });
    expect(getSyncState().error).toBe(error);
  });
});
