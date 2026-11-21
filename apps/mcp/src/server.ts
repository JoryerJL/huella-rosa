import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { FastMCP } from "fastmcp";
import { ApiError, type HuellaApi } from "./api";
import {
  bearerToken,
  getImportStatusTool,
  getImportTemplateTool,
  importStatusParameters,
  proposeImportParameters,
  proposeImportTool,
  REVOKED_MESSAGE,
  TOOL_DESCRIPTIONS,
  type AgentSession,
} from "./tools";

// FastMCP server for AI agents (SPEC 6.7). Each HTTP request is authenticated with the agent
// token, which the Huella Rosa server checks (not revoked); a valid token is remembered for a
// short time so every MCP request does not cost an extra API call. A 401 from the API forgets it.

const unauthorized = (statusText: string) => new Response(null, { status: 401, statusText });

export function createAuthenticator(api: HuellaApi, cacheMs: number) {
  const verified = new Map<string, number>(); // sha256(token) -> verified until (ms)
  const keyOf = (token: string) => createHash("sha256").update(token).digest("hex");

  async function authenticate(request: Pick<IncomingMessage, "headers">): Promise<AgentSession> {
    const token = bearerToken(request.headers.authorization);
    if (!token) throw unauthorized("Missing or malformed agent token");
    const key = keyOf(token);
    if ((verified.get(key) ?? 0) > Date.now()) return { token };
    try {
      await api.getTemplate(token);
    } catch (error) {
      verified.delete(key);
      if (error instanceof ApiError && error.status === 401) throw unauthorized("Invalid or revoked agent token");
      if (error instanceof ApiError && error.status === 429) throw new Response(null, { status: 429, statusText: "Rate limited" });
      throw new Response(null, { status: 503, statusText: "Huella Rosa server not reachable" });
    }
    verified.set(key, Date.now() + cacheMs);
    return { token };
  }

  return { authenticate, forget: (token: string) => verified.delete(keyOf(token)) };
}

export function createServer(api: HuellaApi, options: { authCacheMs?: number } = {}) {
  const auth = createAuthenticator(api, options.authCacheMs ?? 30_000);

  // A 401 on a tool call means the token was revoked meanwhile: re-check it on the next request.
  const guarded = <A>(fn: (session: AgentSession | undefined, args: A) => Promise<string>) =>
    async (args: A, context: { session?: AgentSession }) => {
      try {
        return await fn(context.session, args);
      } catch (error) {
        if (context.session?.token && error instanceof Error && error.message === REVOKED_MESSAGE) {
          auth.forget(context.session.token);
        }
        throw error;
      }
    };

  const server = new FastMCP<AgentSession>({
    name: "huella-rosa",
    version: "0.1.0",
    instructions:
      "Huella Rosa MCP server. You can only PROPOSE patient identification rows for an import batch. " +
      "Nothing is saved until an intake person reviews and confirms every row in the app.",
    authenticate: auth.authenticate,
  });

  server.addTool({
    name: "get_import_template",
    description: TOOL_DESCRIPTIONS.get_import_template,
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: guarded((session) => getImportTemplateTool(api, session)),
  });

  server.addTool({
    name: "propose_import",
    description: TOOL_DESCRIPTIONS.propose_import,
    parameters: proposeImportParameters,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    execute: guarded((session, args) => proposeImportTool(api, session, args)),
  });

  server.addTool({
    name: "get_import_status",
    description: TOOL_DESCRIPTIONS.get_import_status,
    parameters: importStatusParameters,
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: guarded((session, args) => getImportStatusTool(api, session, args)),
  });

  return server;
}
