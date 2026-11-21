import type { IncomingMessage } from "node:http";
import { FastMCP } from "fastmcp";
import { ApiError, type HuellaApi } from "./api";
import {
  analyzePhotoParameters,
  analyzePhotoTool,
  analyzeSpreadsheetParameters,
  analyzeSpreadsheetTool,
  applyImportParameters,
  applyImportTool,
  bearerToken,
  getImportTemplateTool,
  TOOL_DESCRIPTIONS,
  type AgentSession,
} from "./tools";

// FastMCP server for AI agents (SPEC 6.7, MCP authorization spec). It is an OAuth protected
// resource: it publishes RFC 9728 metadata pointing at the Huella Rosa server (the authorization
// server) and answers 401 with a WWW-Authenticate challenge until the agent brings an access
// token. The first time, the agent opens the browser so the person signs in with their usuario
// + PIN; from then on the agent acts as that person. Every HTTP request re-checks the token with
// the Huella Rosa server, so a disconnected agent is refused right away.

/** RFC 9728: metadata for http://host/mcp lives at http://host/.well-known/oauth-protected-resource/mcp. */
export function protectedResourceMetadataUrl(resourceUrl: string): string {
  const url = new URL(resourceUrl);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname === "/" ? "" : url.pathname}`;
}

export function createAuthenticator(api: HuellaApi, resourceUrl = "http://localhost:3002/mcp") {
  const metadata = protectedResourceMetadataUrl(resourceUrl);
  // The challenge tells the agent where to sign in (MCP authorization spec).
  const unauthorized = (statusText: string, error?: string) =>
    new Response(null, {
      status: 401,
      statusText,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadata}"${error ? `, error="${error}"` : ""}`,
      },
    });

  return async function authenticate(request: Pick<IncomingMessage, "headers">): Promise<AgentSession> {
    const token = bearerToken(request.headers.authorization);
    if (!token) throw unauthorized("Sign in to Huella Rosa to connect this agent");
    try {
      const me = await api.me(token);
      return { token, userName: me.userName, role: me.role, clientName: me.clientName };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw unauthorized("Invalid, expired or revoked access token", "invalid_token");
      throw new Response(null, { status: 503, statusText: "Huella Rosa server not reachable" });
    }
  };
}

export interface ServerOptions {
  /** Public URL of the MCP endpoint (the OAuth resource), e.g. http://localhost:3002/mcp. */
  resourceUrl: string;
  /** Issuer of the Huella Rosa authorization server, e.g. http://localhost:3001. */
  authorizationServer: string;
}

export function createServer(api: HuellaApi, options: ServerOptions) {
  const server = new FastMCP<AgentSession>({
    name: "huella-rosa",
    version: "0.3.0",
    instructions:
      "Huella Rosa MCP server. You act as the person who signed in when connecting you, with their role. " +
      "Imports work in two steps (intake accounts only): analyze a spreadsheet or a form photo (nothing is saved), " +
      "show the plan to the person and get an explicit yes, then apply_import with only the confirmed decisions. " +
      "Never decide a match yourself and never send or ask for clinical data.",
    oauth: {
      enabled: true,
      protectedResource: {
        resource: options.resourceUrl,
        authorizationServers: [options.authorizationServer],
        scopesSupported: ["imports"],
        bearerMethodsSupported: ["header"],
        resourceName: "Huella Rosa",
      },
    },
    authenticate: createAuthenticator(api, options.resourceUrl),
  });

  server.addTool({
    name: "get_import_template",
    description: TOOL_DESCRIPTIONS.get_import_template,
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: (_args, { session }) => getImportTemplateTool(api, session),
  });

  server.addTool({
    name: "analyze_spreadsheet",
    description: TOOL_DESCRIPTIONS.analyze_spreadsheet,
    parameters: analyzeSpreadsheetParameters,
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: (args, { session }) => analyzeSpreadsheetTool(api, session, args),
  });

  server.addTool({
    name: "analyze_form_photo",
    description: TOOL_DESCRIPTIONS.analyze_form_photo,
    parameters: analyzePhotoParameters,
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: (args, { session }) => analyzePhotoTool(api, session, args),
  });

  server.addTool({
    name: "apply_import",
    description: TOOL_DESCRIPTIONS.apply_import,
    parameters: applyImportParameters,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    execute: (args, { session }) => applyImportTool(api, session, args),
  });

  return server;
}
