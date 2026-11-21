import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CreatedAgentToken, ImportBatchList } from "@er/shared";

// End-to-end check against running servers (npm run e2e -w @er/mcp):
// HR_API_URL (default http://localhost:3001) and MCP_URL (default http://localhost:3002/mcp),
// demo seed users smendez (admin) and lperez (intake), PIN 1234. Prints counts only, never tokens.

// PATIENT_DB (path to the server's SQLite file) lets the script count patients before and after.
const PATIENT_DB = process.env.PATIENT_DB;
const countPatients = () =>
  PATIENT_DB ? Number(execFileSync("sqlite3", [PATIENT_DB, 'SELECT COUNT(*) FROM "Patient"'], { encoding: "utf8" }).trim()) : null;

const API = process.env.HR_API_URL ?? "http://localhost:3001";
const MCP = new URL(process.env.MCP_URL ?? "http://localhost:3002/mcp");
const example = JSON.parse(readFileSync(new URL("../../../datos-ficticios/excel/agente-ejemplo.json", import.meta.url), "utf8"));

function check(ok: unknown, label: string) {
  if (!ok) throw new Error(`FAIL: ${label}`);
  console.log(`ok - ${label}`);
}

async function login(username: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, pin: "1234" }),
  });
  check(res.ok, `login as ${username}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function connect(token: string) {
  const client = new Client({ name: "huella-rosa-e2e", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(MCP, { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  return client;
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

const admin = await login("smendez");
const created = await fetch(`${API}/api/agent-tokens`, {
  method: "POST",
  headers: { cookie: admin, "content-type": "application/json" },
  body: JSON.stringify({ name: `Agente e2e ${Date.now()}` }),
});
const { agentToken, token } = (await created.json()) as CreatedAgentToken;
check(created.status === 201 && token.startsWith("hr_agent_"), "admin creates an agent token (shown once)");

const client = await connect(token);
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
check(JSON.stringify(tools) === JSON.stringify(["get_import_status", "get_import_template", "propose_import"]), `exactly 3 tools: ${tools.join(", ")}`);

const template = JSON.parse(text(await client.callTool({ name: "get_import_template", arguments: {} })));
check(template.columns.length === 8, "get_import_template returns 8 columns");

const intake = await login("lperez");
const patientsBefore = countPatients();

const proposed = JSON.parse(text(await client.callTool({ name: "propose_import", arguments: example.propose_import })));
console.log("   propose_import ->", JSON.stringify({ counts: proposed.counts, reviewUrl: proposed.reviewUrl.replace(proposed.batchId, "<id>"), message: proposed.message }));
const c = proposed.counts;
check(c.new + c.possibleMatch + c.invalid === 4, "propose_import with 4 rows creates a batch");

const patientsAfter = countPatients();
if (patientsBefore === null) console.log("   (set PATIENT_DB to count patients before and after)");
else check(patientsBefore === patientsAfter, `zero patients created (${patientsBefore} before, ${patientsAfter} after)`);

const status = JSON.parse(text(await client.callTool({ name: "get_import_status", arguments: { batchId: proposed.batchId } })));
check(JSON.stringify(status.counts) === JSON.stringify(c), `get_import_status returns counts ${JSON.stringify(status.counts)}`);

const list = (await (await fetch(`${API}/api/imports`, { headers: { cookie: intake } })).json()) as ImportBatchList;
const listed = list.batches.find((b) => b.id === proposed.batchId);
check(listed?.source === "MCP" && listed.agentName === agentToken.name, "batch listed in /api/imports for intake with source MCP and agent name");

const search = await fetch(`${API}/api/patients/search?q=Juana`, { headers: { authorization: `Bearer ${token}` } });
check(search.status === 401 || search.status === 403, `agent token on /api/patients/search -> ${search.status}`);

const revoke = await fetch(`${API}/api/agent-tokens/${agentToken.id}/revoke`, { method: "POST", headers: { cookie: admin } });
check(revoke.ok, "admin revokes the token");
const afterRevoke = await client.callTool({ name: "get_import_status", arguments: { batchId: proposed.batchId } });
check(afterRevoke.isError && /revoked/.test(text(afterRevoke)), `open session, revoked token -> tool error: ${text(afterRevoke)}`);
await client.close();

let refusedCode: unknown = null;
try {
  await connect(token);
} catch (error) {
  refusedCode = (error as { code?: unknown }).code;
}
check(refusedCode === 401, `new connection with revoked token refused with HTTP ${String(refusedCode)}`);
console.log("e2e passed");
