import { createHash, randomBytes } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AgentGrantList, AgentImportStatus, AgentImportTemplate, ImportBatchList } from "@er/shared";

// AI agents connected through OAuth 2.1 + PKCE (SPEC 6.7), through the whole app so the real
// session checks run on every other route. Valkey is replaced by an in-memory map.
const store = new Map<string, string>();
vi.mock("../valkey", () => ({
  valkey: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    getdel: async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    },
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
const { AGENT_RATE_LIMIT, sha256 } = await import("../agentGrants");

const REDIRECT = "http://localhost:4999/callback";
const session = (name: string, id: string, role: string) => {
  store.set(`session:${name}`, JSON.stringify({ id, name, role }));
  return { cookie: `er_session=${name}` };
};
const ADMIN = session("admin-test", "usr-admin", "admin");
const INTAKE = session("intake-test", "usr-intake", "intake");
const DOCTOR = session("doctor-test", "usr-doctor", "doctor");

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

async function register(redirectUris: string[] = [REDIRECT], name = "Claude Code de prueba") {
  return app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: redirectUris, token_endpoint_auth_method: "none" }),
  });
}

function authorizeQuery(clientId: string, challenge: string) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
  });
}

function signIn(clientId: string, challenge: string, username: string, pin = "1234", decision = "approve") {
  const form = authorizeQuery(clientId, challenge);
  form.set("username", username);
  form.set("pin", pin);
  form.set("decision", decision);
  return app.request("/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

function token(params: Record<string, string>) {
  return app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

/** Full flow: register, sign in as `username`, exchange the code. */
async function connect(username: string) {
  const client = (await (await register()).json()) as { client_id: string };
  const { verifier, challenge } = pkce();
  const res = await signIn(client.client_id, challenge, username);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location")!);
  expect(location.searchParams.get("state")).toBe("xyz");
  const code = location.searchParams.get("code")!;
  const tokens = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT });
  expect(tokens.status).toBe(200);
  const body = (await tokens.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { clientId: client.client_id, ...body };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

function propose(accessToken: string, rows: unknown[]) {
  return app.request("/api/agent/imports", {
    method: "POST",
    headers: { ...bearer(accessToken), "content-type": "application/json" },
    body: JSON.stringify({ rows, note: "prueba" }),
  });
}

const batches: string[] = [];
afterAll(async () => {
  await db.importRow.deleteMany({ where: { batchId: { in: batches } } });
  await db.importBatch.deleteMany({ where: { id: { in: batches } } });
  await db.$disconnect();
});

describe("authorization server", () => {
  it("publishes RFC 8414 metadata with PKCE S256 and dynamic registration", async () => {
    const meta = (await (await app.request("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(meta.issuer).toBe("http://localhost:3001");
    expect(meta.registration_endpoint).toBe("http://localhost:3001/oauth/register");
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("registers only loopback http or https redirect URIs", async () => {
    expect((await register(["http://evil.example/cb"])).status).toBe(400);
    expect((await register(["javascript:alert(1)"])).status).toBe(400);
    expect((await register(["https://app.devin.ai/cb"])).status).toBe(201);
  });

  it("shows the plain-Spanish sign-in page, escaping the agent name", async () => {
    const client = (await (await register([REDIRECT], "<script>x</script> Agente")).json()) as { client_id: string };
    const res = await app.request(`/oauth/authorize?${authorizeQuery(client.client_id, pkce().challenge)}`);
    const page = await res.text();
    expect(res.status).toBe(200);
    expect(page).toContain("Conectar un agente de IA a tu cuenta");
    expect(page).toContain("No podrá");
    expect(page).not.toContain("<script>x");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("never redirects to an unregistered redirect URI", async () => {
    const client = (await (await register()).json()) as { client_id: string };
    const q = authorizeQuery(client.client_id, pkce().challenge);
    q.set("redirect_uri", "http://localhost:5000/other");
    const res = await app.request(`/oauth/authorize?${q}`);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("answers a wrong PIN with the same generic error as the app login and no code", async () => {
    const client = (await (await register()).json()) as { client_id: string };
    const res = await signIn(client.client_id, pkce().challenge, "lperez", "9999");
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("El usuario o el PIN no coinciden. Revisa e intenta de nuevo.");
    store.delete("ratelimit:login:lperez");
  });

  it("cancel sends access_denied back to the agent", async () => {
    const client = (await (await register()).json()) as { client_id: string };
    const res = await signIn(client.client_id, pkce().challenge, "", "", "deny");
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("issues 1-hour tokens bound to the person, stored as SHA-256 only; codes work once and need the PKCE verifier", async () => {
    const client = (await (await register()).json()) as { client_id: string };
    const { verifier, challenge } = pkce();
    const code = new URL((await signIn(client.client_id, challenge, "lperez")).headers.get("location")!).searchParams.get("code")!;
    const bad = await token({ grant_type: "authorization_code", code, code_verifier: pkce().verifier, client_id: client.client_id });
    expect(bad.status).toBe(400);
    // The failed attempt used the code up.
    const reused = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id });
    expect(((await reused.json()) as { error: string }).error).toBe("invalid_grant");

    const t = await connect("lperez");
    expect(t.expires_in).toBe(3600);
    const grant = await db.agentGrant.findUniqueOrThrow({ where: { accessTokenHash: sha256(t.access_token) } });
    expect(grant.userId).toBe("usr-intake");
    expect(grant.refreshTokenHash).toBe(sha256(t.refresh_token));
    expect(JSON.stringify(grant)).not.toContain(t.access_token);
    const me = await app.request("/api/agent/me", { headers: bearer(t.access_token) });
    expect(await me.json()).toEqual({ userName: "Laura Pérez Ortiz", role: "intake", clientName: "Claude Code de prueba" });
  });

  it("rotates tokens on refresh; the old refresh token stops working", async () => {
    const t = await connect("lperez");
    const res = await token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId });
    const next = (await res.json()) as { access_token: string; refresh_token: string };
    expect(res.status).toBe(200);
    expect(next.refresh_token).not.toBe(t.refresh_token);
    expect((await app.request("/api/agent/me", { headers: bearer(t.access_token) })).status).toBe(401);
    expect((await app.request("/api/agent/me", { headers: bearer(next.access_token) })).status).toBe(200);
    const again = await token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId });
    expect(again.status).toBe(400);
  });
});

describe("agent API acting as the person", () => {
  it("an access token only opens the agent routes", async () => {
    const t = await connect("lperez");
    const h = bearer(t.access_token);
    const refused = await Promise.all([
      app.request("/api/patients/search?fullName=Juana&birthDate=1972-07-30", { headers: h }),
      app.request("/api/imports", { headers: h }),
      app.request("/api/agent-grants", { headers: h }),
      app.request("/api/matches", { headers: h }),
      app.request("/api/audit", { headers: h }),
      app.request("/api/sync/push", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: "{}" }),
    ]);
    for (const res of refused) expect([401, 403]).toContain(res.status);
  });

  it("returns the template", async () => {
    const t = await connect("lperez");
    const template = (await (await app.request("/api/agent/import-template", { headers: bearer(t.access_token) })).json()) as AgentImportTemplate;
    expect(template.columns.filter((c) => c.required).map((c) => c.field)).toEqual(["fullName", "birthDate"]);
  });

  it("intake proposes a batch attributed to 'agente de Laura Pérez Ortiz', creating no patient", async () => {
    const t = await connect("lperez");
    const before = await db.patient.count();
    const res = await propose(t.access_token, [
      { fullName: "Prueba Agente Uno", birthDate: "1991-02-01", mobile: "55-0000-0081" },
      { fullName: "Prueba Agente Dos", birthDate: "1990-02-31" },
      { fullName: "Juana Martinez Garcia", birthDate: "1972-07-30" },
    ]);
    expect(res.status).toBe(201);
    const status = (await res.json()) as AgentImportStatus;
    batches.push(status.batchId);
    expect(status.counts).toEqual({ new: 1, possibleMatch: 1, invalid: 1, confirmed: 0, discarded: 0 });
    expect(await db.patient.count()).toBe(before);

    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: status.batchId } });
    expect(batch.source).toBe("MCP");
    expect(batch.createdBy).toBe("agente de Laura Pérez Ortiz");
    const audit = await db.auditLog.findFirst({ where: { entityId: batch.id, action: "IMPORT_PROPOSED_BY_AGENT" } });
    expect(audit?.actorId).toBe("agente de Laura Pérez Ortiz");
    expect(audit?.detail).toBe("client=Claude Code de prueba rows=3 new=1 possible=1 invalid=1");

    const read = await app.request(`/api/agent/imports/${status.batchId}`, { headers: bearer(t.access_token) });
    expect(await read.json()).toEqual(status);
    const list = (await (await app.request("/api/imports", { headers: INTAKE })).json()) as ImportBatchList;
    expect(list.batches.find((b) => b.id === status.batchId)?.agentName).toBe("agente de Laura Pérez Ortiz");
  });

  it("a doctor's agent gets a plain error on propose and creates nothing", async () => {
    const t = await connect("cruiz");
    const res = await propose(t.access_token, [{ fullName: "Prueba Agente Tres", birthDate: "1980-01-01" }]);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/^Solo una cuenta de Captura puede proponer pacientes\. Esta cuenta es de Médico/);
  });

  it("an agent of another person cannot read the batch", async () => {
    const mine = await connect("lperez");
    const res = await propose(mine.access_token, [{ fullName: "Prueba Agente Cuatro", birthDate: "1980-01-01" }]);
    const { batchId } = (await res.json()) as AgentImportStatus;
    batches.push(batchId);
    const other = await connect("cruiz");
    expect((await app.request(`/api/agent/imports/${batchId}`, { headers: bearer(other.access_token) })).status).toBe(404);
  });

  it("refuses empty or oversized batches", async () => {
    const t = await connect("lperez");
    expect((await propose(t.access_token, [])).status).toBe(400);
    const many = Array.from({ length: 501 }, () => ({ fullName: "Prueba", birthDate: "1980-01-01" }));
    expect((await propose(t.access_token, many)).status).toBe(400);
  });

  it("limits each connected agent to 60 requests per minute", async () => {
    const t = await connect("lperez");
    const grant = await db.agentGrant.findUniqueOrThrow({ where: { accessTokenHash: sha256(t.access_token) } });
    store.set(`ratelimit:agent:${grant.id}`, String(AGENT_RATE_LIMIT));
    expect((await app.request("/api/agent/import-template", { headers: bearer(t.access_token) })).status).toBe(429);
  });
});

describe("Agentes conectados", () => {
  it("each person sees and revokes their own agents; a revoked grant gets 401", async () => {
    const t = await connect("lperez");
    const list = (await (await app.request("/api/agent-grants", { headers: INTAKE })).json()) as AgentGrantList;
    const grant = list.grants.find((g) => g.isMine && g.revokedAt === null)!;
    expect(list.grants.every((g) => g.userName === "Laura Pérez Ortiz")).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/hr_at_|hr_rt_/);

    // Another non-admin person cannot see or revoke it.
    const doctorList = (await (await app.request("/api/agent-grants", { headers: DOCTOR })).json()) as AgentGrantList;
    expect(doctorList.grants.some((g) => g.userName === "Laura Pérez Ortiz")).toBe(false);
    expect((await app.request(`/api/agent-grants/${grant.id}/revoke`, { method: "POST", headers: DOCTOR })).status).toBe(404);

    for (const g of list.grants.filter((x) => x.revokedAt === null)) {
      expect((await app.request(`/api/agent-grants/${g.id}/revoke`, { method: "POST", headers: INTAKE })).status).toBe(200);
    }
    expect((await app.request("/api/agent/me", { headers: bearer(t.access_token) })).status).toBe(401);
    const refreshed = await token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.clientId });
    expect(refreshed.status).toBe(400);
    const audit = await db.auditLog.findFirst({ where: { entityId: grant.id, action: "AGENT_GRANT_REVOKED" } });
    expect(audit?.actorId).toBe("usr-intake");
  });

  it("administration sees every agent and can revoke any", async () => {
    const t = await connect("cruiz");
    const { id } = await db.agentGrant.findUniqueOrThrow({ where: { accessTokenHash: sha256(t.access_token) } });
    const list = (await (await app.request("/api/agent-grants", { headers: ADMIN })).json()) as AgentGrantList;
    const grant = list.grants.find((g) => g.id === id)!;
    expect(grant.userName).toBe("Dra. Carmen Ruiz Delgado");
    expect(grant.isMine).toBe(false);
    expect((await app.request(`/api/agent-grants/${id}/revoke`, { method: "POST", headers: ADMIN })).status).toBe(200);
    expect((await app.request("/api/agent/me", { headers: bearer(t.access_token) })).status).toBe(401);
  });
});
