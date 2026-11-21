import { describe, expect, it, vi } from "vitest";
import { UserError } from "fastmcp";
import type { AgentImportStatus, AgentImportTemplate } from "@er/shared";
import { ApiError, type HuellaApi } from "./api";
import { createAuthenticator } from "./server";
import {
  bearerToken,
  getImportStatusTool,
  getImportTemplateTool,
  proposeImportParameters,
  proposeImportTool,
  REVIEW_MESSAGE,
  REVOKED_MESSAGE,
  TOOL_DESCRIPTIONS,
} from "./tools";

const TOKEN = `hr_agent_${"a".repeat(43)}`;
const session = { token: TOKEN };

const STATUS: AgentImportStatus = {
  batchId: "batch-1",
  status: "OPEN",
  counts: { new: 2, possibleMatch: 1, invalid: 1, confirmed: 0, discarded: 0 },
};
const TEMPLATE: AgentImportTemplate = { maxRows: 500, columns: [], rules: ["rule"] };

function mockApi(overrides: Partial<HuellaApi> = {}): HuellaApi {
  return {
    getTemplate: vi.fn(async () => TEMPLATE),
    proposeImport: vi.fn(async () => STATUS),
    getImportStatus: vi.fn(async () => STATUS),
    ...overrides,
  };
}

const ROWS = [{ fullName: "Prueba Agente", birthDate: "1980-01-01" }];

describe("propose_import", () => {
  it("passes the session token and returns batch id, counts, review path and the human-review message", async () => {
    const api = mockApi();
    const out = JSON.parse(await proposeImportTool(api, session, { rows: ROWS, note: "hoja 1" }));
    expect(api.proposeImport).toHaveBeenCalledWith(TOKEN, { rows: ROWS, note: "hoja 1" });
    expect(out).toEqual({
      batchId: "batch-1",
      counts: STATUS.counts,
      reviewUrl: "/intake/import/batch-1",
      message: "Una persona de captura debe revisar y confirmar cada fila.",
    });
  });

  it("validates rows: identification fields only, 1 to 500 rows", () => {
    expect(proposeImportParameters.safeParse({ rows: ROWS }).success).toBe(true);
    expect(proposeImportParameters.safeParse({ rows: [] }).success).toBe(false);
    expect(proposeImportParameters.safeParse({ rows: Array(501).fill(ROWS[0]) }).success).toBe(false);
    expect(proposeImportParameters.safeParse({ rows: [{ birthDate: "1980-01-01" }] }).success).toBe(false);
    // Unknown keys (e.g. clinical notes) are dropped, never forwarded.
    const parsed = proposeImportParameters.parse({ rows: [{ ...ROWS[0], diagnosis: "x" }] });
    expect(parsed.rows[0]).not.toHaveProperty("diagnosis");
  });

  it("turns a revoked token into an auth error the agent can read", async () => {
    const api = mockApi({ proposeImport: vi.fn(async () => Promise.reject(new ApiError(401, "nope"))) });
    const call = proposeImportTool(api, session, { rows: ROWS });
    await expect(call).rejects.toBeInstanceOf(UserError);
    await expect(proposeImportTool(api, session, { rows: ROWS })).rejects.toThrow(REVOKED_MESSAGE);
  });

  it("refuses to call the API without a session token", async () => {
    const api = mockApi();
    await expect(proposeImportTool(api, undefined, { rows: ROWS })).rejects.toBeInstanceOf(UserError);
    expect(api.proposeImport).not.toHaveBeenCalled();
  });
});

describe("get_import_status and get_import_template", () => {
  it("returns counts only", async () => {
    const api = mockApi();
    const out = JSON.parse(await getImportStatusTool(api, session, { batchId: "batch-1" }));
    expect(api.getImportStatus).toHaveBeenCalledWith(TOKEN, "batch-1");
    expect(out).toEqual({ ...STATUS, message: REVIEW_MESSAGE });
  });

  it("forwards server errors as user errors", async () => {
    const api = mockApi({ getImportStatus: vi.fn(async () => Promise.reject(new ApiError(404, "Batch not found."))) });
    await expect(getImportStatusTool(api, session, { batchId: "x" })).rejects.toThrow("Batch not found.");
  });

  it("returns the template", async () => {
    expect(JSON.parse(await getImportTemplateTool(mockApi(), session))).toEqual(TEMPLATE);
  });

  it("tells agents that nothing is saved until a human confirms", () => {
    expect(TOOL_DESCRIPTIONS.propose_import).toMatch(/NOTHING IS SAVED/);
    expect(TOOL_DESCRIPTIONS.propose_import).toMatch(/intake person must review and confirm/);
  });
});

describe("authenticate", () => {
  const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} });

  it("reads only Bearer hr_agent_ tokens", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken("Bearer other")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it("keeps the verified token in the session and caches the check", async () => {
    const api = mockApi();
    const auth = createAuthenticator(api, 60_000);
    expect(await auth.authenticate(req(`Bearer ${TOKEN}`))).toEqual({ token: TOKEN });
    await auth.authenticate(req(`Bearer ${TOKEN}`));
    expect(api.getTemplate).toHaveBeenCalledTimes(1);
    auth.forget(TOKEN);
    await auth.authenticate(req(`Bearer ${TOKEN}`));
    expect(api.getTemplate).toHaveBeenCalledTimes(2);
  });

  it("answers 401 for a missing or revoked token", async () => {
    const api = mockApi({ getTemplate: vi.fn(async () => Promise.reject(new ApiError(401, "revoked"))) });
    const auth = createAuthenticator(api, 60_000);
    await expect(auth.authenticate(req())).rejects.toMatchObject({ status: 401 });
    await expect(auth.authenticate(req(`Bearer ${TOKEN}`))).rejects.toMatchObject({ status: 401 });
  });
});
