import { describe, expect, it, vi } from "vitest";
import { UserError } from "fastmcp";
import type { AgentApplyResult, AgentImportTemplate, AgentPreview } from "@er/shared";
import { ApiError, type HuellaApi } from "./api";
import { createAuthenticator } from "./server";
import {
  analyzePhotoParameters,
  analyzePhotoTool,
  analyzeSpreadsheetTool,
  applyImportParameters,
  applyImportTool,
  bearerToken,
  getImportTemplateTool,
  NEXT_STEP,
  SIGNED_OUT_MESSAGE,
  TOOL_DESCRIPTIONS,
  type AgentSession,
} from "./tools";

const TOKEN = `hr_at_${"a".repeat(43)}`;
const session: AgentSession = { token: TOKEN, userName: "Laura Pérez Ortiz", role: "intake", clientName: "Claude Code" };
const PREVIEW_ID = "7f1d6c2e-3b0a-4c1e-9a55-2f7b1e0c9d11";

const PREVIEW: AgentPreview = {
  previewId: PREVIEW_ID,
  kind: "SPREADSHEET",
  fileName: "plantilla-llena.xlsx",
  expiresAt: "2026-11-21T20:00:00.000Z",
  counts: { new: 1, possibleMatch: 0, invalid: 0 },
  rows: [{ row: 2, status: "NEW", fields: { fullName: "Prueba", birthDate: "1980-01-01" }, reason: null, candidates: [], sameAsRows: [] }],
};
const APPLIED: AgentApplyResult = { batchId: "b1", registered: 1, linked: 0, skipped: 0, failed: [], pending: 0, reviewUrl: "/intake/import/b1" };
const TEMPLATE: AgentImportTemplate = { maxRows: 1000, columns: [], rules: ["rule"] };

function mockApi(overrides: Partial<HuellaApi> = {}): HuellaApi {
  return {
    me: vi.fn(async () => ({ userName: "Laura Pérez Ortiz", role: "intake" as const, clientName: "Claude Code" })),
    getTemplate: vi.fn(async () => TEMPLATE),
    analyzeSpreadsheet: vi.fn(async () => PREVIEW),
    analyzePhoto: vi.fn(async () => ({ ...PREVIEW, kind: "PHOTO" as const })),
    applyImport: vi.fn(async () => APPLIED),
    ...overrides,
  };
}

const CONFIRMED = {
  previewId: PREVIEW_ID,
  decisions: [{ row: 2, action: "register" as const }],
  confirmedByUser: true as const,
  confirmationText: "Sí, regístrala.",
};

describe("analyze tools", () => {
  it("analyze_spreadsheet returns the preview plus the confirm-first next step", async () => {
    const api = mockApi();
    const out = JSON.parse(await analyzeSpreadsheetTool(api, session, { fileBase64: "AAAA", fileName: "a.xlsx" }));
    expect(api.analyzeSpreadsheet).toHaveBeenCalledWith(TOKEN, { fileBase64: "AAAA", fileName: "a.xlsx" });
    expect(out).toEqual({ ...PREVIEW, nextStep: NEXT_STEP });
  });

  it("analyze_form_photo accepts only image types", async () => {
    expect(analyzePhotoParameters.safeParse({ imageBase64: "AAAA", mimeType: "image/png" }).success).toBe(true);
    expect(analyzePhotoParameters.safeParse({ imageBase64: "AAAA", mimeType: "application/pdf" }).success).toBe(false);
    const out = JSON.parse(await analyzePhotoTool(mockApi(), session, { imageBase64: "AAAA", mimeType: "image/png" }));
    expect(out.kind).toBe("PHOTO");
  });

  it("relays the server's plain error for accounts that are not intake", async () => {
    const plain = "Solo una cuenta de Captura puede importar pacientes. Esta cuenta es de Médico.";
    const api = mockApi({ analyzeSpreadsheet: vi.fn(async () => Promise.reject(new ApiError(403, plain))) });
    await expect(analyzeSpreadsheetTool(api, { ...session, role: "doctor" }, { fileBase64: "AAAA", fileName: "a.xlsx" })).rejects.toThrow(plain);
  });

  it("descriptions tell the agent to show the plan, ask for confirmation and never infer a match", () => {
    for (const d of [TOOL_DESCRIPTIONS.analyze_spreadsheet, TOOL_DESCRIPTIONS.analyze_form_photo]) {
      expect(d).toMatch(/NOTHING IS SAVED/);
      expect(d).toMatch(/ask for explicit confirmation before calling apply_import/);
      expect(d).toMatch(/Never decide a match yourself/);
    }
    expect(TOOL_DESCRIPTIONS.apply_import).toMatch(/ONLY the decisions the person explicitly confirmed/);
  });
});

describe("apply_import", () => {
  it("requires the person's explicit confirmation and a patient for isHer is passed through as chosen", () => {
    expect(applyImportParameters.safeParse(CONFIRMED).success).toBe(true);
    expect(applyImportParameters.safeParse({ ...CONFIRMED, confirmedByUser: false }).success).toBe(false);
    const { confirmationText: _omit, ...noWords } = CONFIRMED;
    expect(applyImportParameters.safeParse(noWords).success).toBe(false);
    expect(applyImportParameters.safeParse({ ...CONFIRMED, decisions: [{ row: 2, action: "merge" }] }).success).toBe(false);
  });

  it("returns the result with a plain summary", async () => {
    const api = mockApi();
    const out = JSON.parse(await applyImportTool(api, session, CONFIRMED));
    expect(api.applyImport).toHaveBeenCalledWith(TOKEN, CONFIRMED);
    expect(out.message).toBe("Listo: 1 registradas, 0 agregadas a su expediente, 0 sin importar.");
  });

  it("asks to sign in again when the token was revoked or expired", async () => {
    const api = mockApi({ applyImport: vi.fn(async () => Promise.reject(new ApiError(401, "nope"))) });
    await expect(applyImportTool(api, session, CONFIRMED)).rejects.toBeInstanceOf(UserError);
    await expect(applyImportTool(api, session, CONFIRMED)).rejects.toThrow(SIGNED_OUT_MESSAGE);
  });

  it("never calls the API without a session token", async () => {
    const api = mockApi();
    await expect(applyImportTool(api, undefined, CONFIRMED)).rejects.toBeInstanceOf(UserError);
    expect(api.applyImport).not.toHaveBeenCalled();
  });
});

describe("get_import_template", () => {
  it("returns the template", async () => {
    expect(JSON.parse(await getImportTemplateTool(mockApi(), session))).toEqual(TEMPLATE);
  });
});

describe("authenticate", () => {
  const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} });

  it("reads Bearer tokens only", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it("checks the token with Huella Rosa on every request and keeps who it acts as", async () => {
    const api = mockApi();
    const auth = createAuthenticator(api);
    expect(await auth(req(`Bearer ${TOKEN}`))).toEqual(session);
    await auth(req(`Bearer ${TOKEN}`));
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it("answers 401 for a missing, expired or revoked token, so the agent asks the person to sign in", async () => {
    const api = mockApi({ me: vi.fn(async () => Promise.reject(new ApiError(401, "revoked"))) });
    const auth = createAuthenticator(api);
    await expect(auth(req())).rejects.toMatchObject({ status: 401 });
    const rejection = (await auth(req(`Bearer ${TOKEN}`)).catch((e: unknown) => e)) as Response;
    expect(rejection.status).toBe(401);
    expect(rejection.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3002/.well-known/oauth-protected-resource/mcp", error="invalid_token"',
    );
  });
});
