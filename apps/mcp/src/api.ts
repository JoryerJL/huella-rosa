import type { AgentImportInput, AgentImportStatus, AgentImportTemplate } from "@er/shared";

// Thin client for the Huella Rosa agent API (/api/agent/*). Every call carries the agent token
// of the MCP session; the server checks it, rate-limits it and writes the audit log.
// The token is never logged.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface HuellaApi {
  getTemplate(token: string): Promise<AgentImportTemplate>;
  proposeImport(token: string, input: AgentImportInput): Promise<AgentImportStatus>;
  getImportStatus(token: string, batchId: string): Promise<AgentImportStatus>;
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
    getTemplate: (token) => call(token, "/import-template"),
    proposeImport: (token, input) => call(token, "/imports", { method: "POST", body: JSON.stringify(input) }),
    getImportStatus: (token, batchId) => call(token, `/imports/${encodeURIComponent(batchId)}`),
  };
}
