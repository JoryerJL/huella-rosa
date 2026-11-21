import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { defaultCampaignName, type CampaignListItem, type StaffView } from "@er/shared";
import { db } from "./db";
import { valkey } from "./valkey";
import { app } from "./app";

// Staff and campaign administration (SPEC 6.0), through the public HTTP routes.

const GENERIC_LOGIN_ERROR = "El usuario o el PIN no coinciden. Revisa e intenta de nuevo.";

afterAll(async () => {
  await db.$disconnect();
  valkey.disconnect();
});

async function login(username: string, pin = "1234") {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": "test-device" },
    body: JSON.stringify({ username, pin }),
  });
}

async function cookieFor(username: string, pin = "1234"): Promise<string> {
  const res = await login(username, pin);
  if (res.status !== 200) throw new Error(`login ${username}: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

function call(cookie: string, path: string, method = "GET", body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json", "x-device-id": "test-device" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("staff", () => {
  it("admin creates a user who can then log in; the PIN never appears in the response or the log", async () => {
    const admin = await cookieFor("smendez");
    const res = await call(admin, "/api/staff", "POST", { name: "Ana Hernández Ficticia", username: "  AHernandez ", role: "intake", pin: "482913" });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain("482913");
    const { staff } = JSON.parse(text) as { staff: StaffView };
    expect(staff).toMatchObject({ username: "ahernandez", role: "intake", active: true });

    expect((await login("ahernandez", "482913")).status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "STAFF_CREATED", entityId: staff.id } });
    expect(audit.detail).toBe("role=intake");
    expect(JSON.stringify(audit)).not.toContain("482913");
  });

  it("rejects invalid fields with plain Spanish messages", async () => {
    const admin = await cookieFor("smendez");
    const cases: [Record<string, unknown>, string][] = [
      [{ name: "Ana", username: "a b", role: "intake", pin: "1234" }, "username"],
      [{ name: "Ana", username: "ab", role: "intake", pin: "1234" }, "username"],
      [{ name: "Ana", username: "ana.lopez", role: "intake", pin: "12" }, "pin"],
      [{ name: "Ana", username: "ana.lopez", role: "intake", pin: "12ab" }, "pin"],
      [{ name: "Ana", username: "ana.lopez", role: "chief", pin: "1234" }, "role"],
    ];
    for (const [body, field] of cases) {
      const res = await call(admin, "/api/staff", "POST", body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; field: string };
      expect(json.field).toBe(field);
      expect(json.error).toMatch(/^[A-ZÁÉÍÓÚ]/);
    }
    expect(await db.user.count({ where: { username: "ana.lopez" } })).toBe(0);
  });

  it("refuses a username that already exists", async () => {
    const admin = await cookieFor("smendez");
    const res = await call(admin, "/api/staff", "POST", { name: "Otra Persona", username: "LPEREZ", role: "doctor", pin: "1234" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "Ese usuario ya existe. Prueba con otro." });
  });

  it("deactivation closes open sessions, blocks login with the generic message and rejects sync", async () => {
    const admin = await cookieFor("smendez");
    const created = await call(admin, "/api/staff", "POST", { name: "Rosa Gómez Ficticia", username: "rgomez", role: "doctor", pin: "5555" });
    const { staff } = (await created.json()) as { staff: StaffView };
    const doctorCookie = await cookieFor("rgomez", "5555");
    expect((await call(doctorCookie, "/api/auth/me")).status).toBe(200);

    const res = await call(admin, `/api/staff/${staff.id}/deactivate`, "POST");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { staff: StaffView }).staff.active).toBe(false);

    expect((await call(doctorCookie, "/api/auth/me")).status).toBe(401);
    expect((await call(doctorCookie, "/api/sync/push", "POST", { ops: [] })).status).toBe(401);
    const failed = await login("rgomez", "5555");
    expect(failed.status).toBe(401);
    expect(await failed.json()).toMatchObject({ error: GENERIC_LOGIN_ERROR });
    expect(await db.auditLog.count({ where: { action: "STAFF_DEACTIVATED", entityId: staff.id } })).toBe(1);

    const reactivated = await call(admin, `/api/staff/${staff.id}/reactivate`, "POST");
    expect(reactivated.status).toBe(200);
    expect((await login("rgomez", "5555")).status).toBe(200);
  });

  it("a session that outlived the deactivation cannot push changes", async () => {
    const intakeCookie = await cookieFor("lperez");
    await db.user.update({ where: { username: "lperez" }, data: { active: false } });
    try {
      const res = await call(intakeCookie, "/api/sync/push", "POST", { ops: [] });
      expect(res.status).toBe(403);
    } finally {
      await db.user.update({ where: { username: "lperez" }, data: { active: true } });
    }
  });

  it("admin cannot deactivate themselves", async () => {
    const admin = await cookieFor("smendez");
    const res = await call(admin, "/api/staff/usr-admin/deactivate", "POST");
    expect(res.status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: "usr-admin" } })).active).toBe(true);
  });

  it("intake and specialists get 403 on staff and campaign administration", async () => {
    for (const username of ["lperez", "cruiz"]) {
      const cookie = await cookieFor(username);
      expect((await call(cookie, "/api/staff")).status).toBe(403);
      expect((await call(cookie, "/api/staff", "POST", { name: "X Y Z", username: "xyz", role: "admin", pin: "1234" })).status).toBe(403);
      expect((await call(cookie, "/api/staff/usr-doctor/deactivate", "POST")).status).toBe(403);
      expect((await call(cookie, "/api/campaigns", "POST", {})).status).toBe(403);
      expect((await call(cookie, "/api/campaigns/camp-2026-11", "PATCH", { name: "Otra" })).status).toBe(403);
      expect((await call(cookie, "/api/localities")).status).toBe(403);
    }
  });
});

describe("campaigns", () => {
  const base = { municipality: "Valle Ficticio", state: "Estado Demo", localityIds: ["loc-villa-demo"], date: "2099-12-05", endDate: "2099-12-07" };

  it("proposes the default name and creates the new localities in the campaign municipality", async () => {
    const admin = await cookieFor("smendez");
    const res = await call(admin, "/api/campaigns", "POST", { ...base, newLocalities: [{ name: "Loma Ficticia", hasSignal: false }] });
    expect(res.status).toBe(201);
    const { campaign } = (await res.json()) as { campaign: CampaignListItem };
    expect(campaign.name).toBe("Jornada Valle Ficticio · diciembre 2099");
    expect(campaign.status).toBe("UPCOMING");
    expect(campaign.localities.map((l) => l.name)).toEqual(["Villa Demo", "Loma Ficticia"]);
    const created = await db.locality.findFirstOrThrow({ where: { name: "Loma Ficticia" } });
    expect(created).toMatchObject({ municipality: "Valle Ficticio", hasSignal: false });
    expect(await db.auditLog.count({ where: { action: "CAMPAIGN_CREATED", entityId: campaign.id } })).toBe(1);

    const list = (await (await call(admin, "/api/campaigns")).json()) as CampaignListItem[];
    expect(list.find((c) => c.id === campaign.id)).toMatchObject({ endDate: "2099-12-07", state: "Estado Demo" });
  });

  it("keeps a name typed by the admin", async () => {
    const admin = await cookieFor("smendez");
    const res = await call(admin, "/api/campaigns", "POST", { ...base, name: "Jornada especial Valle" });
    expect(((await res.json()) as { campaign: CampaignListItem }).campaign.name).toBe("Jornada especial Valle");
  });

  it("defaultCampaignName uses the month of the first day", () => {
    expect(defaultCampaignName("Valle Ficticio", "2026-12-01")).toBe("Jornada Valle Ficticio · diciembre 2026");
    expect(defaultCampaignName("San Demo", "2027-01-31")).toBe("Jornada San Demo · enero 2027");
  });

  it("rejects an end date before the start date and campaigns without localities", async () => {
    const admin = await cookieFor("smendez");
    const before = await db.campaign.count();
    const backwards = await call(admin, "/api/campaigns", "POST", { ...base, endDate: "2099-12-01" });
    expect(backwards.status).toBe(400);
    expect(await backwards.json()).toMatchObject({ error: "La fecha de fin no puede ser antes de la fecha de inicio." });
    expect((await call(admin, "/api/campaigns", "POST", { ...base, date: "2099-02-30", endDate: "2099-03-01" })).status).toBe(400);
    expect((await call(admin, "/api/campaigns", "POST", { ...base, localityIds: [] })).status).toBe(400);
    expect((await call(admin, "/api/campaigns", "POST", { ...base, localityIds: ["loc-missing"] })).status).toBe(400);
    expect(await db.campaign.count()).toBe(before);
  });

  it("edits a campaign that has not finished and refuses a finished one", async () => {
    const admin = await cookieFor("smendez");
    const res = await call(admin, "/api/campaigns", "POST", base);
    const { campaign } = (await res.json()) as { campaign: CampaignListItem };
    const patched = await call(admin, `/api/campaigns/${campaign.id}`, "PATCH", { endDate: "2099-12-09", newLocalities: [{ name: "Cerro Demo", hasSignal: true }] });
    expect(patched.status).toBe(200);
    const updated = ((await patched.json()) as { campaign: CampaignListItem }).campaign;
    expect(updated.endDate).toBe("2099-12-09");
    expect(updated.localities.map((l) => l.name)).toEqual(["Villa Demo", "Cerro Demo"]);
    expect(await db.auditLog.count({ where: { action: "CAMPAIGN_UPDATED", entityId: campaign.id } })).toBe(1);

    expect((await call(admin, `/api/campaigns/${campaign.id}`, "PATCH", { endDate: "2099-12-01" })).status).toBe(400);
    // camp-2026-05 (May 2026) is seeded and already over.
    const finished = await call(admin, "/api/campaigns/camp-2026-05", "PATCH", { name: "Otro nombre" });
    expect(finished.status).toBe(409);
    expect((await call(admin, `/api/campaigns/${randomUUID()}`, "PATCH", { name: "Otro nombre" })).status).toBe(404);
  });

  it("intake downloads the package of a campaign created by admin", async () => {
    const admin = await cookieFor("smendez");
    const res = await call(admin, "/api/campaigns", "POST", { ...base, municipality: "Paquete Demo" });
    const { campaign } = (await res.json()) as { campaign: CampaignListItem };
    const intake = await cookieFor("lperez");
    const pkg = await call(intake, `/api/campaigns/${campaign.id}/package`);
    expect(pkg.status).toBe(200);
    expect(((await pkg.json()) as { campaign: { id: string } }).campaign.id).toBe(campaign.id);
  });
});
