import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import {
  analyzePhotoSchema,
  analyzeSpreadsheetSchema,
  applyImportSchema,
  IMPORT_FIELDS,
  type AgentIdentityView,
  type AgentImportTemplate,
  type ImportField,
} from "@er/shared";
import { writeAudit } from "../audit";
import { agentRateLimit, requireAgent, type AgentEnv } from "../agentGrants";
import { TEMPLATE_HEADERS } from "../imports/columns";
import { AFFILIATION_OPTIONS, FORM_ID_PROBLEM } from "../imports/rows";
import { ImportError, MAX_IMPORT_ROWS } from "../imports/service";
import { analyzePhoto, analyzeSpreadsheet, applyPreview } from "../imports/agentPreview";

// API for AI agents (SPEC 6.7), reached through the MCP server with an OAuth access token bound
// to a staff account. The agent acts AS that person with that person's role: it reads the
// template, analyzes a spreadsheet or a form photo (intake only, nothing saved) and applies the
// decisions the person confirmed (intake only). It never searches patients, merges records or
// reads clinical data. Every call is audited with the agent's client name and ids/counts only.

const FIELD_RULES: Record<ImportField, string> = {
  fullName: "Required. Full name as written; at least 3 characters with letters. Never used alone to match people.",
  birthDate: "Required. DD/MM/YYYY or YYYY-MM-DD. Must be a real date between 1900 and today.",
  birthState: "Optional. Mexican state of birth as text.",
  formId: `Optional. ${FORM_ID_PROBLEM} Spaces and dashes are removed.`,
  phone: "Optional. Landline with 10 digits; separators and a +52 prefix are fine.",
  mobile: "Optional. Mobile phone with 10 digits; separators and a +52 prefix are fine.",
  residence: "Optional. Usual residence (town or community).",
  affiliation: `Optional. One of: ${AFFILIATION_OPTIONS.join(", ")}.`,
};

const TEMPLATE: AgentImportTemplate = {
  maxRows: MAX_IMPORT_ROWS,
  columns: IMPORT_FIELDS.map((field) => ({
    field,
    label: TEMPLATE_HEADERS[field],
    required: field === "fullName" || field === "birthDate",
    rule: FIELD_RULES[field],
  })),
  rules: [
    "Identification fields only. Never send or ask for clinical data.",
    "Analyzing saves nothing. Show the plan to the person and ask for explicit confirmation before applying.",
    "Never decide a match yourself: 'isHer' needs the patient the person chose among the candidates.",
    "Only intake (Captura) accounts can analyze and apply imports.",
  ],
};

const ROLE_LABEL: Record<AgentIdentityView["role"], string> = {
  intake: "Captura",
  nutritionist: "Nutrición",
  doctor: "Médico",
  pathologist: "Patología",
  admin: "Administración",
};

export const ONLY_INTAKE_MESSAGE = (role: AgentIdentityView["role"]) =>
  `Solo una cuenta de Captura puede importar pacientes. Esta cuenta es de ${ROLE_LABEL[role]}: pide a alguien de Captura que conecte el agente con su cuenta.`;

/** Intake only; any other role gets a plain error and an audit entry. */
async function refuseIfNotIntake(c: Context<AgentEnv>, what: string) {
  const agent = c.get("agent");
  if (agent.role === "intake") return null;
  await writeAudit({
    actorId: agent.actorId,
    action: "AGENT_REFUSED",
    entity: "AgentGrant",
    entityId: agent.grantId,
    detail: `client=${agent.clientName} role=${agent.role} tool=${what}`,
  });
  return c.json({ error: ONLY_INTAKE_MESSAGE(agent.role) }, 403);
}

/** Paths and messages only: never echo values back. */
function invalidBody(c: Context, error: z.ZodError) {
  const issues = error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
  return c.json({ error: `Datos incompletos o con otro formato. ${issues.join("; ")}` }, 400);
}

const limit = (maxSize: number) =>
  bodyLimit({ maxSize, onError: (c) => c.json({ error: "El archivo es demasiado grande." }, 413) });

export const agentRoutes = new Hono<AgentEnv>()
  .use(requireAgent)
  .onError((error, c) => {
    if (error instanceof ImportError) return c.json({ error: error.message }, error.status);
    throw error;
  })
  // Token check used by the MCP server on every request: not a tool call, so no audit or limit.
  .get("/me", (c) => {
    const agent = c.get("agent");
    const me: AgentIdentityView = { userName: agent.userName, role: agent.role, clientName: agent.clientName };
    return c.json(me);
  })
  .use(agentRateLimit)
  .get("/import-template", async (c) => {
    const agent = c.get("agent");
    await writeAudit({
      actorId: agent.actorId,
      action: "AGENT_TEMPLATE_READ",
      entity: "AgentGrant",
      entityId: agent.grantId,
      detail: `client=${agent.clientName}`,
    });
    return c.json(TEMPLATE);
  })
  .post("/analyze/spreadsheet", limit(3_200_000), async (c) => {
    const refused = await refuseIfNotIntake(c, "analyze_spreadsheet");
    if (refused) return refused;
    const parsed = analyzeSpreadsheetSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalidBody(c, parsed.error);
    return c.json(await analyzeSpreadsheet(parsed.data, c.get("agent")));
  })
  .post("/analyze/photo", limit(15_000_000), async (c) => {
    const refused = await refuseIfNotIntake(c, "analyze_form_photo");
    if (refused) return refused;
    const parsed = analyzePhotoSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalidBody(c, parsed.error);
    return c.json(await analyzePhoto(parsed.data, c.get("agent")));
  })
  .post("/apply", limit(256 * 1024), async (c) => {
    const refused = await refuseIfNotIntake(c, "apply_import");
    if (refused) return refused;
    const parsed = applyImportSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalidBody(c, parsed.error);
    return c.json(await applyPreview(parsed.data, c.get("agent")), 201);
  });
