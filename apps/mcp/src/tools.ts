import { UserError } from "fastmcp";
import {
  analyzePhotoSchema,
  analyzeSpreadsheetSchema,
  applyImportSchema,
  type AgentPreview,
  type AnalyzePhotoInput,
  type AnalyzeSpreadsheetInput,
  type ApplyImportInput,
  type Role,
} from "@er/shared";
import { ApiError, type HuellaApi } from "./api";

// MCP tools for AI agents (SPEC 6.7). The agent acts AS the Huella Rosa person who signed in when
// connecting it, with that person's role (intake only for imports). Two steps:
// analyze (our parser or OCR + validation + matching, nothing saved) -> the agent shows the plan
// and the person confirms -> apply_import runs only the confirmed decisions.
// Identification data only: clinical values are never returned or accepted.

/** What `authenticate` keeps in the MCP session: the access token and who it acts as. */
export interface AgentSession {
  token: string;
  userName: string;
  role: Role;
  clientName: string;
  [key: string]: unknown;
}

export const SIGNED_OUT_MESSAGE =
  "Your Huella Rosa sign-in expired or this agent was disconnected. Reconnect the MCP server to sign in again.";

const CONFIRM_RULE =
  "ALWAYS show this plan to the person in plain words (who is new, who may already exist and why, which rows have " +
  "problems) and ask for explicit confirmation before calling apply_import. Never decide a match yourself: for a " +
  "possible match, ask the person whether it is the same woman and which candidate.";

export const NEXT_STEP =
  "Nothing was saved. Show the plan to the person and ask them to confirm each decision: register (new patient), " +
  "isHer (same person as the candidate THEY choose) or skip. Then call apply_import with only the confirmed decisions.";

export const TOOL_DESCRIPTIONS = {
  get_import_template:
    "Returns the identification columns Huella Rosa reads from a spreadsheet, which ones are required and their format " +
    "rules. Read-only.",
  analyze_spreadsheet:
    "Analyzes an Excel (.xlsx) or CSV file of patients with the Huella Rosa parser, validation and matching, acting as " +
    "the signed-in intake person. NOTHING IS SAVED. Returns a previewId (valid 30 minutes), the column mapping and each " +
    "row as NEW, POSSIBLE_MATCH (with existing candidates and reasons) or INVALID (with a plain reason). " +
    CONFIRM_RULE,
  analyze_form_photo:
    "Reads the identification fields of a photo of the paper breast-review form with the Huella Rosa form reader (not a " +
    "generative model), with confidence per field, and looks for existing patients, acting as the signed-in intake " +
    "person. NOTHING IS SAVED and clinical fields are never returned. Returns a previewId (valid 30 minutes). " +
    "Ask the person to check low-confidence values. " +
    CONFIRM_RULE,
  apply_import:
    "Applies ONLY the decisions the person explicitly confirmed for a previewId: register = create the patient, " +
    "isHer = add the row to the existing record the person chose (fills empty fields only, never overwrites), skip = do " +
    "not import. Rows without a decision stay in the batch for review in the app. Requires confirmedByUser: true and the " +
    "person's own confirmation words. A preview can be applied once. Never call this without showing the plan and " +
    "getting an explicit yes.",
} as const;

export const analyzeSpreadsheetParameters = analyzeSpreadsheetSchema;
export const analyzePhotoParameters = analyzePhotoSchema;
export const applyImportParameters = applyImportSchema;

/** Maps API failures to messages the agent can relay. Server messages are plain Spanish for people. */
function toUserError(error: unknown): never {
  if (error instanceof ApiError) {
    if (error.status === 401) throw new UserError(SIGNED_OUT_MESSAGE);
    throw new UserError(error.message);
  }
  throw error;
}

function tokenOf(session: AgentSession | undefined): string {
  if (!session?.token) throw new UserError(SIGNED_OUT_MESSAGE);
  return session.token;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);
const withNextStep = (preview: AgentPreview) => json({ ...preview, nextStep: NEXT_STEP });

export async function getImportTemplateTool(api: HuellaApi, session: AgentSession | undefined): Promise<string> {
  try {
    return json(await api.getTemplate(tokenOf(session)));
  } catch (error) {
    toUserError(error);
  }
}

export async function analyzeSpreadsheetTool(
  api: HuellaApi,
  session: AgentSession | undefined,
  args: AnalyzeSpreadsheetInput,
): Promise<string> {
  try {
    return withNextStep(await api.analyzeSpreadsheet(tokenOf(session), args));
  } catch (error) {
    toUserError(error);
  }
}

export async function analyzePhotoTool(api: HuellaApi, session: AgentSession | undefined, args: AnalyzePhotoInput): Promise<string> {
  try {
    return withNextStep(await api.analyzePhoto(tokenOf(session), args));
  } catch (error) {
    toUserError(error);
  }
}

export async function applyImportTool(api: HuellaApi, session: AgentSession | undefined, args: ApplyImportInput): Promise<string> {
  try {
    const result = await api.applyImport(tokenOf(session), args);
    return json({
      ...result,
      message:
        `Listo: ${result.registered} registradas, ${result.linked} agregadas a su expediente, ${result.skipped} sin importar.` +
        (result.failed.length > 0 ? ` ${result.failed.length} no se pudieron aplicar.` : "") +
        (result.pending > 0 ? ` ${result.pending} quedan para revisar en la app.` : ""),
    });
  } catch (error) {
    toUserError(error);
  }
}

/** Bearer token from the Authorization header, or null when missing or malformed. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S{10,512})$/.exec(value ?? "");
  return match ? match[1] : null;
}
