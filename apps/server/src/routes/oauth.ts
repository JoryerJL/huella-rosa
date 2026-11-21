import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { loginSchema } from "@er/shared";
import { db } from "../db";
import { env } from "../env";
import { valkey } from "../valkey";
import { writeAudit } from "../audit";
import { checkStaffCredentials } from "./auth";
import { AGENT_SCOPE, cleanClientName, createGrant, refreshGrant, sha256 } from "../agentGrants";

// OAuth 2.1 authorization server for AI agents (SPEC 6.7, MCP authorization spec).
// - Discovery: RFC 8414 metadata at /.well-known/oauth-authorization-server.
// - Dynamic client registration (RFC 7591): public clients only, PKCE S256 required.
// - /oauth/authorize: the person signs in with usuario + PIN (same checks, rate limit and
//   generic error as the app login) and approves what the agent can and cannot do.
// - /oauth/token: authorization_code (+ PKCE) and refresh_token grants. Tokens are stored hashed.
// Authorization codes live 2 minutes in Valkey and can be used once.

const CODE_TTL_SECONDS = 120;
const MAX_REDIRECT_URIS = 5;
const codeKey = (code: string) => `oauth:code:${sha256(code)}`;

interface StoredCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
}

// ---------- Discovery and registration ----------

export function authorizationServerMetadata() {
  const issuer = env.oauthIssuer;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [AGENT_SCOPE],
  };
}

/** Loopback http (native agents such as Claude Code) or https (hosted agents such as Devin). */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

// ---------- Authorization request ----------

type AuthorizeCheck =
  | { ok: true; clientId: string; clientName: string; redirectUri: string; state: string | null; codeChallenge: string }
  /** The client or redirect URI cannot be trusted: show an error page, never redirect. */
  | { ok: false; page: string }
  /** Trusted redirect URI, bad request: send the error back to the agent. */
  | { ok: false; redirect: string };

function redirectWith(redirectUri: string, params: Record<string, string | null>) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  return url.toString();
}

async function checkAuthorizeRequest(q: Record<string, string | undefined>): Promise<AuthorizeCheck> {
  const client = q.client_id ? await db.oAuthClient.findUnique({ where: { id: q.client_id } }) : null;
  if (!client) return { ok: false, page: "No reconocemos este agente. Vuelve a conectarlo desde el agente." };
  const registered = JSON.parse(client.redirectUris) as string[];
  const redirectUri = q.redirect_uri ?? (registered.length === 1 ? registered[0] : undefined);
  if (!redirectUri || !registered.includes(redirectUri)) {
    return { ok: false, page: "La dirección de regreso del agente no coincide. Vuelve a conectarlo desde el agente." };
  }
  const state = q.state ?? null;
  if (q.response_type !== "code") {
    return { ok: false, redirect: redirectWith(redirectUri, { error: "unsupported_response_type", state }) };
  }
  const challenge = q.code_challenge ?? "";
  if (q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return {
      ok: false,
      redirect: redirectWith(redirectUri, { error: "invalid_request", error_description: "PKCE with S256 is required", state }),
    };
  }
  return { ok: true, clientId: client.id, clientName: client.clientName, redirectUri, state, codeChallenge: challenge };
}

// ---------- Sign-in and approval page (plain Spanish) ----------

const PAGE_STYLE = `
  body{margin:0;background:#fff8f5;color:#2e2e2e;font:18px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
  main{max-width:560px;margin:0 auto;padding:32px 16px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;color:#7d3b3b;font-size:20px}
  .logo{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:8px;background:#b7426c;color:#fff}
  h1{font-size:28px;line-height:1.2;margin:24px 0 8px}
  .card{background:#fff;border:2px solid #dddddd;border-radius:16px;padding:20px;margin-top:16px}
  h2{font-size:18px;margin:0 0 6px;color:#7d3b3b}
  ul{margin:0 0 12px;padding-left:22px}
  label{display:block;font-weight:600;margin-top:14px}
  input{box-sizing:border-box;width:100%;min-height:52px;margin-top:6px;padding:10px 14px;font-size:18px;border:2px solid #949090;border-radius:10px}
  .actions{display:flex;flex-direction:column;gap:10px;margin-top:20px}
  button{min-height:52px;border-radius:12px;font-size:18px;font-weight:700;cursor:pointer}
  .primary{background:#b7426c;color:#fff;border:0}
  .secondary{background:#fff;color:#7d3b3b;border:2px solid #dddddd}
  .error{background:#fdecea;color:#b3261e;border-radius:10px;padding:12px;margin-top:16px;font-weight:600}
  .muted{color:#555555;font-size:16px}`;

function page(title: string, body: ReturnType<typeof html>) {
  return html`<!doctype html>
    <html lang="es-MX">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · Huella Rosa</title>
        <style>
          ${PAGE_STYLE}
        </style>
      </head>
      <body>
        <main>
          <div class="brand"><span class="logo">H</span> Huella Rosa</div>
          ${body}
        </main>
      </body>
    </html>`;
}

function errorPage(c: Context, message: string, status: 400 | 404 = 400) {
  return c.html(page("No se pudo conectar", html`<h1>No se pudo conectar el agente</h1><p>${message}</p>`), status);
}

function consentPage(c: Context, req: Extract<AuthorizeCheck, { ok: true }>, opts: { error?: string; username?: string; status?: 200 | 400 | 401 | 429 } = {}) {
  const body = html`
    <h1>Conectar un agente de IA a tu cuenta</h1>
    <p><strong>${req.clientName}</strong> quiere usar Huella Rosa con tu cuenta. Entra con tu usuario y tu PIN para permitirlo.</p>
    <div class="card">
      <h2>Podrá</h2>
      <ul>
        <li>Ver qué columnas lleva un Excel de pacientes.</li>
        <li>Proponer pacientes desde un Excel, solo si tu cuenta es de Captura. Una persona de Captura revisa y confirma cada fila.</li>
        <li>Ver cuántas filas de sus propuestas ya se revisaron.</li>
      </ul>
      <h2>No podrá</h2>
      <ul>
        <li>Guardar ni confirmar pacientes, ni unir expedientes.</li>
        <li>Buscar pacientes ni ver datos clínicos.</li>
      </ul>
      <p class="muted">Lo que haga queda en la bitácora como «agente de» tu nombre. Puedes desconectarlo cuando quieras en «Agentes conectados».</p>
    </div>
    ${opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : ""}
    <form method="post" action="/oauth/authorize" class="card">
      <input type="hidden" name="client_id" value="${req.clientId}" />
      <input type="hidden" name="redirect_uri" value="${req.redirectUri}" />
      <input type="hidden" name="response_type" value="code" />
      <input type="hidden" name="code_challenge" value="${req.codeChallenge}" />
      <input type="hidden" name="code_challenge_method" value="S256" />
      ${req.state !== null ? html`<input type="hidden" name="state" value="${req.state}" />` : ""}
      <label for="username">Usuario</label>
      <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${opts.username ?? ""}" />
      <label for="pin">PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required />
      <div class="actions">
        <button class="primary" type="submit" name="decision" value="approve">Conectar agente</button>
        <button class="secondary" type="submit" name="decision" value="deny" formnovalidate>Cancelar</button>
      </div>
    </form>`;
  return c.html(page("Conectar un agente de IA", body), opts.status ?? 200);
}

const formString = (v: unknown) => (typeof v === "string" ? v : undefined);

// ---------- Token endpoint ----------

function tokenError(c: Context, error: string, description: string, status: 400 | 401 = 400) {
  c.header("Cache-Control", "no-store");
  return c.json({ error, error_description: description }, status);
}

async function readTokenBody(c: Context): Promise<Record<string, string | undefined>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, formString(v)]));
  }
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  return Object.fromEntries(Object.entries(form).map(([k, v]) => [k, formString(v)]));
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const oauthRoutes = new Hono()
  .use(async (c, next) => {
    await next();
    // The sign-in page must never be framed (clickjacking).
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", "frame-ancestors 'none'");
  })
  .get("/.well-known/oauth-authorization-server", (c) => c.json(authorizationServerMetadata()))
  .post("/oauth/register", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const uris = body?.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(isAllowedRedirectUri)) {
      return c.json({ error: "invalid_redirect_uri", error_description: "Use https or http://localhost redirect URIs." }, 400);
    }
    const method = body?.token_endpoint_auth_method;
    if (method !== undefined && method !== "none") {
      return c.json({ error: "invalid_client_metadata", error_description: "Only public clients (token_endpoint_auth_method none)." }, 400);
    }
    const clientName = cleanClientName(body?.client_name);
    const client = await db.oAuthClient.create({ data: { clientName, redirectUris: JSON.stringify(uris) } });
    return c.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: clientName,
        redirect_uris: uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  })
  .get("/oauth/authorize", async (c) => {
    const check = await checkAuthorizeRequest(c.req.query());
    if (!check.ok) return "page" in check ? errorPage(c, check.page) : c.redirect(check.redirect, 302);
    return consentPage(c, check);
  })
  .post("/oauth/authorize", async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const fields = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, formString(v)]));
    const check = await checkAuthorizeRequest(fields);
    if (!check.ok) return "page" in check ? errorPage(c, check.page) : c.redirect(check.redirect, 302);

    if (fields.decision === "deny") {
      return c.redirect(redirectWith(check.redirectUri, { error: "access_denied", state: check.state }), 302);
    }
    const username = (fields.username ?? "").trim().toLowerCase();
    const parsed = loginSchema.safeParse({ username, pin: fields.pin ?? "" });
    if (!parsed.success) {
      return consentPage(c, check, { error: "Escribe tu usuario y tu PIN de 4 a 6 números.", username, status: 400 });
    }
    const result = await checkStaffCredentials(parsed.data.username, parsed.data.pin, null);
    if (!result.ok) return consentPage(c, check, { error: result.error, username, status: result.status });

    const code = randomBytes(32).toString("base64url");
    const stored: StoredCode = {
      clientId: check.clientId,
      redirectUri: check.redirectUri,
      codeChallenge: check.codeChallenge,
      userId: result.profile.id,
    };
    await valkey.set(codeKey(code), JSON.stringify(stored), "EX", CODE_TTL_SECONDS);
    await writeAudit({
      actorId: result.profile.id,
      action: "AGENT_AUTHORIZED",
      entity: "OAuthClient",
      entityId: check.clientId,
      detail: `client=${check.clientName}`,
    });
    return c.redirect(redirectWith(check.redirectUri, { code, state: check.state, iss: env.oauthIssuer }), 302);
  })
  .post("/oauth/token", async (c) => {
    const body = await readTokenBody(c);
    c.header("Cache-Control", "no-store");
    if (!body.client_id) return tokenError(c, "invalid_client", "client_id is required.", 401);

    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier) return tokenError(c, "invalid_request", "code and code_verifier are required.");
      // One use only: the code is removed as it is read.
      const raw = await valkey.getdel(codeKey(body.code));
      const stored = raw ? (JSON.parse(raw) as StoredCode) : null;
      if (
        !stored ||
        stored.clientId !== body.client_id ||
        (body.redirect_uri !== undefined && body.redirect_uri !== stored.redirectUri) ||
        s256(body.code_verifier) !== stored.codeChallenge
      ) {
        return tokenError(c, "invalid_grant", "The authorization code is invalid, expired or already used.");
      }
      const client = await db.oAuthClient.findUnique({ where: { id: stored.clientId } });
      const user = await db.user.findUnique({ where: { id: stored.userId }, select: { active: true } });
      if (!client || !user?.active) return tokenError(c, "invalid_grant", "The authorization is no longer valid.");
      const { grant, tokens } = await createGrant({ userId: stored.userId, clientId: client.id, clientName: client.clientName });
      await writeAudit({
        actorId: stored.userId,
        action: "AGENT_GRANT_CREATED",
        entity: "AgentGrant",
        entityId: grant.id,
        detail: `client=${client.clientName}`,
      });
      return c.json(tokens);
    }

    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) return tokenError(c, "invalid_request", "refresh_token is required.");
      const result = await refreshGrant(body.refresh_token, body.client_id);
      if (!result) return tokenError(c, "invalid_grant", "The refresh token is invalid, expired or revoked.");
      return c.json(result.tokens);
    }

    return tokenError(c, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  });
