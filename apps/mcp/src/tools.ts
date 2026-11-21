import { UserError } from "fastmcp";
import { z } from "zod";
import { AGENT_TOKEN_PREFIX, agentImportSchema, type AgentImportCounts, type AgentImportInput } from "@er/shared";
import { ApiError, type HuellaApi } from "./api";

// MCP tools for AI agents (SPEC 6.7). They only PROPOSE: nothing becomes a patient until an
// intake person reviews and confirms each row in Huella Rosa. No tool confirms, links, merges,
// deletes, searches patients or reads clinical data.

/** What `authenticate` keeps in the MCP session: the agent's own token. */
export interface AgentSession {
  token: string;
  [key: string]: unknown;
}

export const REVOKED_MESSAGE =
  "The agent token is not valid or was revoked. Ask a Huella Rosa administrator for a new token.";

export const REVIEW_MESSAGE = "Una persona de captura debe revisar y confirmar cada fila.";

export const TOOL_DESCRIPTIONS = {
  get_import_template:
    "Returns the identification columns Huella Rosa accepts for a patient import batch, which ones are required, " +
    "their format rules and the maximum rows per batch. Call this before normalizing a spreadsheet. Read-only.",
  propose_import:
    "Proposes a batch of patient identification rows (already normalized by you) for human review. " +
    "NOTHING IS SAVED as a patient: the server validates each row, looks for possible existing records, and an " +
    "intake person must review and confirm every row in the app. Send identification fields only (never clinical data) " +
    "and do not invent values. Returns the batch id, counts per status and the review page path.",
  get_import_status:
    "Returns the status and counts of a batch you proposed (new, possible match, invalid, confirmed, discarded). " +
    "Counts only: it never returns patient data. Rows stay unsaved until a person confirms them.",
} as const;

export const proposeImportParameters = agentImportSchema;
export const importStatusParameters = z.object({ batchId: z.string().min(1).max(64).describe("Batch id returned by propose_import.") });

/** Maps API failures to messages the agent can act on. Never includes the token. */
function toUserError(error: unknown): never {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      throw new UserError(REVOKED_MESSAGE);
    }
    throw new UserError(error.message);
  }
  throw error;
}

function tokenOf(session: AgentSession | undefined): string {
  if (!session?.token) throw new UserError("Missing agent token. Connect with an Authorization: Bearer header.");
  return session.token;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export async function getImportTemplateTool(api: HuellaApi, session: AgentSession | undefined): Promise<string> {
  try {
    return json(await api.getTemplate(tokenOf(session)));
  } catch (error) {
    toUserError(error);
  }
}

export interface ProposeImportResult {
  batchId: string;
  counts: AgentImportCounts;
  reviewUrl: string;
  message: string;
}

export async function proposeImportTool(
  api: HuellaApi,
  session: AgentSession | undefined,
  args: AgentImportInput,
): Promise<string> {
  try {
    const status = await api.proposeImport(tokenOf(session), args);
    const result: ProposeImportResult = {
      batchId: status.batchId,
      counts: status.counts,
      reviewUrl: `/intake/import/${status.batchId}`,
      message: REVIEW_MESSAGE,
    };
    return json(result);
  } catch (error) {
    toUserError(error);
  }
}

export async function getImportStatusTool(
  api: HuellaApi,
  session: AgentSession | undefined,
  args: { batchId: string },
): Promise<string> {
  try {
    const status = await api.getImportStatus(tokenOf(session), args.batchId);
    return json({ ...status, message: REVIEW_MESSAGE });
  } catch (error) {
    toUserError(error);
  }
}

/** Bearer agent token from the Authorization header, or null when missing or malformed. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/.exec(value ?? "");
  return match && match[1].startsWith(AGENT_TOKEN_PREFIX) ? match[1] : null;
}
