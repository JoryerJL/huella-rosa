import type {
  AgentApplyResult,
  AgentIdentityView,
  AgentImportTemplate,
  AgentPreview,
  AnalyzePhotoInput,
  AnalyzeSpreadsheetInput,
  ApplyImportInput,
} from "@er/shared";

// Thin client for the Huella Rosa agent API (/api/agent/*). Every call carries the OAuth access
// token of the MCP session (bound to a staff account); the server checks it, rate-limits it and
// writes the audit log. The token is never logged.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface HuellaApi {
  /** Who the token acts as; ApiError 401 when it is invalid, expired or revoked. */
  me(token: string): Promise<AgentIdentityView>;
  getTemplate(token: string): Promise<AgentImportTemplate>;
  analyzeSpreadsheet(token: string, input: AnalyzeSpreadsheetInput): Promise<AgentPreview>;
  analyzePhoto(token: string, input: AnalyzePhotoInput): Promise<AgentPreview>;
  applyImport(token: string, input: ApplyImportInput): Promise<AgentApplyResult>;
}

export function createHuellaApi(baseUrl: string, fetchImpl: typeof fetch = fetch): HuellaApi {
  const base = baseUrl.replace(/\/+$/, "");

  async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/api/agent${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
      });
    } catch {
      throw new ApiError(503, "The Huella Rosa server is not reachable. Try again later.");
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed with status ${res.status}.`);
    return body as T;
  }

  return {
    me: (token) => call(token, "/me"),
    getTemplate: (token) => call(token, "/import-template"),
    analyzeSpreadsheet: (token, input) => call(token, "/analyze/spreadsheet", { method: "POST", body: JSON.stringify(input) }),
    analyzePhoto: (token, input) => call(token, "/analyze/photo", { method: "POST", body: JSON.stringify(input) }),
    applyImport: (token, input) => call(token, "/apply", { method: "POST", body: JSON.stringify(input) }),
  };
}
