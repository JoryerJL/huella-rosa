import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AgentApplyResult, AgentGrantList, AgentPreview, ImportBatchList } from "@er/shared";

// End-to-end check against running servers (npm run e2e -w @er/mcp), using the official MCP SDK
// client with its OAuth support: discovery from the 401, dynamic registration, PKCE, and the
// sign-in page filled in like a person would in the browser. Demo seed users lperez (intake) and
// cruiz (doctor), PIN 1234. Prints names of fictitious demo patients and counts, never tokens.
// HR_API_URL (default http://localhost:3001), MCP_URL (default http://localhost:3002/mcp),
// PATIENT_DB (optional path to the server's SQLite file, to count patients before and after).
// Run it on a freshly seeded database: the demo Excel's new rows are registered by this script.

const API = (process.env.HR_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const MCP = new URL(process.env.MCP_URL ?? "http://localhost:3002/mcp");
const PATIENT_DB = process.env.PATIENT_DB;
const REDIRECT = "http://localhost:4999/callback";
const demo = (path: string) => readFileSync(new URL(`../../../datos-ficticios/${path}`, import.meta.url)).toString("base64");

function check(ok: unknown, label: string) {
  if (!ok) throw new Error(`FAIL: ${label}`);
  console.log(`ok - ${label}`);
}

const countPatients = () =>
  PATIENT_DB ? Number(execFileSync("sqlite3", [PATIENT_DB, 'SELECT COUNT(*) FROM "Patient"'], { encoding: "utf8" }).trim()) : null;

/** In-memory OAuth client provider; "opening the browser" signs in as `username` on the real page. */
class ScriptedProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = "";
  code: string | null = null;
  constructor(readonly username: string) {}
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Claude Code (e2e)",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
  async redirectToAuthorization(url: URL) {
    // What the browser shows: the plain-Spanish sign-in page.
    const pageRes = await fetch(url);
    const page = await pageRes.text();
    check(pageRes.status === 200 && page.includes("Conectar un agente de IA a tu cuenta"), `sign-in page opens for ${this.username}`);
    // What the person submits: usuario + PIN + "Conectar agente".
    const form = new URLSearchParams(url.searchParams);
    form.set("username", this.username);
    form.set("pin", "1234");
    form.set("decision", "approve");
    const res = await fetch(new URL("/oauth/authorize", url), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
    });
    this.code = new URL(res.headers.get("location") ?? "").searchParams.get("code");
  }
}

/** First use: 401 -> OAuth sign-in -> finishAuth -> connect again with the token. */
async function connectWithOAuth(username: string) {
  const provider = new ScriptedProvider(username);
  const first = new Client({ name: "huella-rosa-e2e", version: "0.3.0" });
  try {
    await first.connect(new StreamableHTTPClientTransport(MCP, { authProvider: provider }));
    throw new Error("expected the first connection to require sign-in");
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
  check(provider.info?.client_id && provider.code, `${username}: client registered and authorization code received`);
  await new StreamableHTTPClientTransport(MCP, { authProvider: provider }).finishAuth(provider.code!);
  check(provider.saved?.access_token && provider.saved.refresh_token, `${username}: access + refresh tokens issued`);
  const client = new Client({ name: "huella-rosa-e2e", version: "0.3.0" });
  await client.connect(new StreamableHTTPClientTransport(MCP, { authProvider: provider }));
  return { client, provider };
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

async function login(username: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, pin: "1234" }),
  });
  check(res.ok, `staff login as ${username}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

// 0. Discovery: the MCP server is an OAuth protected resource.
const anon = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
check(anon.status === 401 && /resource_metadata=/.test(anon.headers.get("www-authenticate") ?? ""), "no token -> 401 with resource_metadata challenge");
const prm = (await (await fetch(new URL("/.well-known/oauth-protected-resource/mcp", MCP))).json()) as { authorization_servers: string[] };
check(prm.authorization_servers?.[0] === API, `protected resource metadata points to ${API}`);

// 1. Laura (intake) connects her agent and lists the tools.
const laura = await connectWithOAuth("lperez");
const tools = (await laura.client.listTools()).tools.map((t) => t.name).sort();
check(
  JSON.stringify(tools) === JSON.stringify(["analyze_form_photo", "analyze_spreadsheet", "apply_import", "get_import_template"]),
  `tools: ${tools.join(", ")}`,
);

// 2. Analyze the demo Excel: nothing saved.
const before = countPatients();
const preview = JSON.parse(
  text(await laura.client.callTool({ name: "analyze_spreadsheet", arguments: { fileBase64: demo("excel/plantilla-llena.xlsx"), fileName: "plantilla-llena.xlsx" } })),
) as AgentPreview;
check(JSON.stringify(preview.counts) === JSON.stringify({ new: 3, possibleMatch: 1, invalid: 1 }), `analyze_spreadsheet counts ${JSON.stringify(preview.counts)}`);
const juana = preview.rows.find((r) => r.status === "POSSIBLE_MATCH")!;
check(juana.candidates[0]?.fullName === "Juana Martínez García", `possible match: row ${juana.row} may be ${juana.candidates[0]?.fullName} (${juana.candidates[0]?.strength})`);
const invalid = preview.rows.find((r) => r.status === "INVALID")!;
console.log(`   invalid row ${invalid.row}: ${invalid.reason}`);
check(countPatients() === before, "analysis saved no patient");

// 3. The person confirms: register the 3 new ones, Juana "es ella".
const fresh = preview.rows.filter((r) => r.status === "NEW").map((r) => r.row);
const applied = JSON.parse(
  text(
    await laura.client.callTool({
      name: "apply_import",
      arguments: {
        previewId: preview.previewId,
        decisions: [...fresh.map((row) => ({ row, action: "register" })), { row: juana.row, action: "isHer", patientId: juana.candidates[0].patientId }],
        confirmedByUser: true,
        confirmationText: "Sí, registra las tres nuevas y la fila de Juana es ella.",
      },
    }),
  ),
) as AgentApplyResult & { message: string };
console.log(`   apply_import -> ${applied.message}`);
check(applied.registered === 3 && applied.linked === 1 && applied.failed.length === 0, "apply_import: 3 registered, 1 added to Juana's record");
const after = countPatients();
if (before === null) console.log("   (set PATIENT_DB to count patients before and after)");
else check(after === before + 3, `patients ${before} -> ${after}`);

const again = await laura.client.callTool({
  name: "apply_import",
  arguments: { previewId: preview.previewId, decisions: [{ row: fresh[0], action: "register" }], confirmedByUser: true, confirmationText: "otra vez" },
});
check(again.isError, `same preview again -> refused: ${text(again)}`);

const lauraCookie = await login("lperez");
const list = (await (await fetch(`${API}/api/imports`, { headers: { cookie: lauraCookie } })).json()) as ImportBatchList;
const listed = list.batches.find((b) => b.id === applied.batchId);
check(listed?.source === "MCP" && listed.agentName === "agente de Laura Pérez Ortiz", `batch in /intake/import history: source ${listed?.source}, by "${listed?.agentName}"`);

const auditDetail = (action: string) =>
  PATIENT_DB
    ? execFileSync("sqlite3", [PATIENT_DB, `SELECT actorId || ' | ' || detail FROM "AuditLog" WHERE action = '${action}' ORDER BY rowid DESC LIMIT 1`], { encoding: "utf8" }).trim()
    : null;
const analysisAudit = auditDetail("AGENT_ANALYSIS");
const confirmAudit = auditDetail("AGENT_IMPORT_CONFIRMED");
if (analysisAudit === null) console.log("   (set PATIENT_DB to read the audit log)");
else {
  check(/Análisis por agente de Laura Pérez Ortiz \(Claude Code \(e2e\)\)/.test(analysisAudit), `audit: ${analysisAudit}`);
  check(/^usr-intake \| Importación confirmada por Laura Pérez Ortiz vía agente \(Claude Code \(e2e\)\)/.test(confirmAudit ?? ""), `audit: ${confirmAudit}`);
}

// 4. Form photo (mock OCR reads the fictitious sample by name): Lucía, STRONG.
const photo = JSON.parse(
  text(await laura.client.callTool({ name: "analyze_form_photo", arguments: { imageBase64: demo("formatos/formato-01.svg"), mimeType: "image/svg+xml", fileName: "formato-01.svg" } })),
) as AgentPreview;
const [photoRow] = photo.rows;
check(photoRow.fields.fullName === "Lucía Ramírez Torres" && photoRow.candidates[0]?.strength === "STRONG", `analyze_form_photo -> ${photoRow.fields.fullName}, candidate ${photoRow.candidates[0]?.fullName} ${photoRow.candidates[0]?.strength}`);
check(!/bloodPressure|weight|118\/76/.test(JSON.stringify(photo)), "no clinical values in the photo analysis");

const search = await fetch(`${API}/api/patients/search?fullName=Juana&birthDate=1972-07-30`, { headers: { authorization: `Bearer ${laura.provider.saved!.access_token}` } });
check(search.status === 401 || search.status === 403, `agent token on /api/patients/search -> ${search.status}`);

// 5. A doctor's agent gets a plain error.
const carmen = await connectWithOAuth("cruiz");
const refused = await carmen.client.callTool({ name: "analyze_spreadsheet", arguments: { fileBase64: demo("excel/plantilla-llena.xlsx"), fileName: "plantilla-llena.xlsx" } });
check(refused.isError && /^Solo una cuenta de Captura puede importar pacientes/.test(text(refused)), `doctor -> plain error: ${text(refused)}`);
await carmen.client.close();

// 6. Laura disconnects her agent in "Agentes conectados": 401.
const grants = (await (await fetch(`${API}/api/agent-grants`, { headers: { cookie: lauraCookie } })).json()) as AgentGrantList;
for (const g of grants.grants.filter((x) => x.isMine && x.revokedAt === null)) {
  const res = await fetch(`${API}/api/agent-grants/${g.id}/revoke`, { method: "POST", headers: { cookie: lauraCookie } });
  check(res.ok, `Laura disconnects "${g.clientName}"`);
}
const revoked = await fetch(MCP, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${laura.provider.saved!.access_token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
check(revoked.status === 401, `revoked grant on the MCP server -> HTTP ${revoked.status}`);
console.log("e2e passed");
process.exit(0);
