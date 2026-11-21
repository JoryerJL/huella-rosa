import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { DeviceRegistration, PatientAuditEntry } from "@er/shared";
import { db } from "./db";
import { valkey } from "./valkey";
import { app } from "./app";
import { writeAudit } from "./audit";

// Tablet names (SPEC 6.3.1): the audit timeline shows a friendly name, never the device id.

afterAll(async () => {
  await db.$disconnect();
  valkey.disconnect();
});

async function cookieFor(username: string, deviceId: string): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": deviceId },
    body: JSON.stringify({ username, pin: "1234" }),
  });
  if (res.status !== 200) throw new Error(`login ${username}: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

function call(cookie: string, deviceId: string, path: string, method = "GET", body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json", "x-device-id": deviceId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("tablet names", () => {
  it("intake names its own tablet after registering; registering again returns the name", async () => {
    const deviceId = randomUUID();
    const intake = await cookieFor("lperez", deviceId);
    const first = (await (await call(intake, deviceId, "/api/devices/register", "POST", {})).json()) as DeviceRegistration;
    expect(first.name).toBeNull();

    const named = await call(intake, deviceId, "/api/devices/name", "PUT", { name: "  Tableta de captura 1 " });
    expect(named.status).toBe(200);
    expect(((await named.json()) as DeviceRegistration).name).toBe("Tableta de captura 1");

    const again = (await (await call(intake, deviceId, "/api/devices/register", "POST", {})).json()) as DeviceRegistration;
    expect(again).toEqual({ deviceId, folioPrefix: first.folioPrefix, name: "Tableta de captura 1" });
    expect(await db.auditLog.count({ where: { action: "DEVICE_NAMED", entityId: deviceId } })).toBe(1);
  });

  it("rejects a too-short name in plain Spanish and an unregistered tablet", async () => {
    const deviceId = randomUUID();
    const doctor = await cookieFor("cruiz", deviceId);
    const short = await call(doctor, deviceId, "/api/devices/name", "PUT", { name: "A" });
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toBe("Escribe un nombre de al menos 2 letras para la tableta.");
    expect((await call(doctor, deviceId, "/api/devices/name", "PUT", { name: "Tableta 2" })).status).toBe(404);
  });

  it("shows the tablet's name or folio prefix in the patient timeline, never its id", async () => {
    const named = randomUUID();
    const unnamed = randomUUID();
    const intake = await cookieFor("lperez", named);
    await call(intake, named, "/api/devices/register", "POST", {});
    await call(intake, named, "/api/devices/name", "PUT", { name: "Tableta de captura 1" });
    const reg = (await (await call(intake, unnamed, "/api/devices/register", "POST", {})).json()) as DeviceRegistration;

    const patient = await db.patient.findFirstOrThrow({ select: { id: true } });
    await writeAudit({ actorId: "usr-intake", action: "PATIENT_UPDATED", deviceId: named, entity: "Patient", entityId: patient.id });
    await writeAudit({ actorId: "usr-intake", action: "PATIENT_UPDATED", deviceId: unnamed, entity: "Patient", entityId: patient.id });

    const admin = await cookieFor("smendez", randomUUID());
    const res = await call(admin, "admin-device", `/api/audit?patientId=${patient.id}`);
    const text = await res.text();
    expect(text).not.toContain(named.slice(0, 6));
    const data = JSON.parse(text) as PatientAuditEntry[] | { entries: PatientAuditEntry[] };
    const entries = Array.isArray(data) ? data : data.entries;
    const tail = entries.slice(-2).map((e) => [e.deviceName, e.devicePrefix]);
    expect(tail[0]).toEqual(["Tableta de captura 1", expect.any(String)]);
    expect(tail[1]).toEqual([null, reg.folioPrefix]);
  });
});
