import { afterAll, describe, expect, it, vi } from "vitest";
import type { AgentImportStatus, AgentImportTemplate, CreatedAgentToken, ImportBatchList } from "@er/shared";

// Agent tokens and the agent-only API (SPEC 6.7) through the whole app, so the real session
// checks run on every other route. Valkey is replaced by an in-memory map (sessions + limits).
const store = new Map<string, string>();
vi.mock("../valkey", () => ({
  valkey: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    incr: async (k: string) => {
      const next = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(next));
      return next;
    },
    expire: async () => 1,
    del: async (...keys: string[]) => keys.filter((k) => store.delete(k)).length,
    ping: async () => "PONG",
    publish: async () => 0,
  },
}));

const { app } = await import("../app");
const { db } = await import("../db");
const { hashAgentToken, generateAgentToken, AGENT_RATE_LIMIT } = await import("../agentTokens");

const session = (name: string, role: string) => {
  store.set(`session:${name}`, JSON.stringify({ id: `usr-${name}`, name, role }));
  return { cookie: `er_session=${name}` };
};
const ADMIN = session("admin-test", "admin");
const INTAKE = session("intake-test", "intake");

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });


async function createToken(name: string) {
  const res = await app.request("/api/agent-tokens", { method: "POST", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify({ name }) });
  expect(res.status).toBe(201);
  return (await res.json()) as CreatedAgentToken;
}

function propose(token: string, rows: unknown[]) {
  const body = JSON.stringify({ rows, note: "prueba" });
  return app.request("/api/agent/imports", {
    method: "POST",
    headers: { ...bearer(token), "content-type": "application/json" },
    body,
  });
}

const batches: string[] = [];
afterAll(async () => {
  await db.importRow.deleteMany({ where: { batchId: { in: batches } } });
  await db.importBatch.deleteMany({ where: { id: { in: batches } } });
  await db.$disconnect();
});

describe("agent tokens", () => {
  it("stores only the SHA-256 and returns the plain token once", async () => {
    const created = await createToken("Agente Prueba Hash");
    expect(created.token).toMatch(/^hr_agent_[A-Za-z0-9_-]{43}$/);
    const row = await db.agentToken.findUniqueOrThrow({ where: { id: created.agentToken.id } });
    expect(row.tokenHash).toBe(hashAgentToken(created.token));
    expect(row.tokenHash).not.toContain(created.token);
    expect(row.role).toBe("intake");

    const list = await app.request("/api/agent-tokens", { headers: ADMIN });
    const text = await list.text();
    expect(text).toContain("Agente Prueba Hash");
    expect(text).not.toContain(created.token);
    expect(text).not.toContain(row.tokenHash);

    const audit = await db.auditLog.findFirst({ where: { entityId: row.id, action: "AGENT_TOKEN_CREATED" } });
    expect(audit?.actorId).toBe("usr-admin-test");
  });

  it("only admin manages tokens", async () => {
    const res = await app.request("/api/agent-tokens", {
      method: "POST",
      headers: { ...INTAKE, "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(403);
    expect((await app.request("/api/agent-tokens")).status).toBe(401);
  });

  it("a revoked token gets 401", async () => {
    const created = await createToken("Agente Prueba Revocado");
    expect((await app.request("/api/agent/import-template", { headers: bearer(created.token) })).status).toBe(200);
    const revoke = await app.request(`/api/agent-tokens/${created.agentToken.id}/revoke`, { method: "POST", headers: ADMIN });
    expect(revoke.status).toBe(200);
    expect(((await revoke.json()) as CreatedAgentToken).agentToken.revokedAt).not.toBeNull();
    expect((await app.request("/api/agent/import-template", { headers: bearer(created.token) })).status).toBe(401);
    const audit = await db.auditLog.findFirst({ where: { entityId: created.agentToken.id, action: "AGENT_TOKEN_REVOKED" } });
    expect(audit).not.toBeNull();
  });

  it("an unknown or malformed token gets 401", async () => {
    expect((await app.request("/api/agent/import-template", { headers: bearer(generateAgentToken()) })).status).toBe(401);
    expect((await app.request("/api/agent/import-template", { headers: bearer("hola") })).status).toBe(401);
    expect((await app.request("/api/agent/import-template")).status).toBe(401);
  });
});

describe("agent API", () => {
  it("allows only the agent routes: every other route refuses an agent token", async () => {
    const { token } = await createToken("Agente Prueba Lista");
    const h = bearer(token);
    const refused = [
      app.request("/api/patients/search?q=Juana", { headers: h }),
      app.request("/api/imports", { headers: h }),
      app.request("/api/agent-tokens", { headers: h }),
      app.request("/api/matches", { headers: h }),
      app.request("/api/audit", { headers: h }),
      app.request("/api/sync/push", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: "{}" }),
    ];
    for (const res of await Promise.all(refused)) expect([401, 403]).toContain(res.status);
  });

  it("returns the template columns and rules", async () => {
    const { token } = await createToken("Agente Prueba Plantilla");
    const res = await app.request("/api/agent/import-template", { headers: bearer(token) });
    const template = (await res.json()) as AgentImportTemplate;
    expect(template.columns.map((c) => c.field)).toEqual([
      "fullName", "birthDate", "birthState", "formId", "phone", "mobile", "residence", "affiliation",
    ]);
    expect(template.columns.filter((c) => c.required).map((c) => c.field)).toEqual(["fullName", "birthDate"]);
    expect(template.maxRows).toBe(500);
  });

  it("proposes a batch with source MCP, creates no patient and shows counts only", async () => {
    const { token } = await createToken("Agente Prueba Lote");
    const before = await db.patient.count();
    const res = await propose(token, [
      { fullName: "Prueba Agente Uno", birthDate: "1991-02-01", mobile: "55-0000-0081" },
      { fullName: "Prueba Agente Dos", birthDate: "1990-02-31" },
      { fullName: "Juana Martinez Garcia", birthDate: "1972-07-30" },
    ]);
    expect(res.status).toBe(201);
    const status = (await res.json()) as AgentImportStatus;
    batches.push(status.batchId);
    expect(status.counts).toEqual({ new: 1, possibleMatch: 1, invalid: 1, confirmed: 0, discarded: 0 });
    expect(Object.keys(status).sort()).toEqual(["batchId", "counts", "status"]);
    expect(await db.patient.count()).toBe(before);

    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: status.batchId } });
    expect(batch.source).toBe("MCP");
    expect(batch.createdBy).toBe("agent:Agente Prueba Lote");
    const audit = await db.auditLog.findFirst({ where: { entityId: batch.id, action: "IMPORT_PROPOSED_BY_AGENT" } });
    expect(audit?.actorId).toBe("agent:Agente Prueba Lote");
    expect(audit?.detail).toBe("rows=3 new=1 possible=1 invalid=1");

    const read = await app.request(`/api/agent/imports/${status.batchId}`, { headers: bearer(token) });
    expect(await read.json()).toEqual(status);

    // Intake sees the batch with the agent's name.
    const list = (await (await app.request("/api/imports", { headers: INTAKE })).json()) as ImportBatchList;
    const listed = list.batches.find((b) => b.id === status.batchId);
    expect(listed?.source).toBe("MCP");
    expect(listed?.agentName).toBe("Agente Prueba Lote");
  });

  it("an agent cannot read another agent's batch", async () => {
    const a = await createToken("Agente Prueba A");
    const b = await createToken("Agente Prueba B");
    const res = await propose(a.token, [{ fullName: "Prueba Agente Tres", birthDate: "1980-01-01" }]);
    const { batchId } = (await res.json()) as AgentImportStatus;
    batches.push(batchId);
    expect((await app.request(`/api/agent/imports/${batchId}`, { headers: bearer(b.token) })).status).toBe(404);
  });

  it("refuses empty, oversized or non-identification batches", async () => {
    const { token } = await createToken("Agente Prueba Limites");
    expect((await propose(token, [])).status).toBe(400);
    const many = Array.from({ length: 501 }, () => ({ fullName: "Prueba", birthDate: "1980-01-01" }));
    expect((await propose(token, many)).status).toBe(400);
    const bad = await propose(token, [{ birthDate: "1980-01-01" }]);
    expect(bad.status).toBe(400);
  });

  it("limits each token to 60 requests per minute", async () => {
    const { token, agentToken } = await createToken("Agente Prueba Limite");
    store.set(`ratelimit:agent:${agentToken.id}`, String(AGENT_RATE_LIMIT));
    expect((await app.request("/api/agent/import-template", { headers: bearer(token) })).status).toBe(429);
  });
});
