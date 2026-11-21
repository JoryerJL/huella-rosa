import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  agentImportSchema,
  IMPORT_FIELDS,
  MAX_AGENT_IMPORT_ROWS,
  type AgentIdentityView,
  type AgentImportStatus,
  type AgentImportTemplate,
  type ImportBatchSummary,
  type ImportField,
} from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { agentRateLimit, requireAgent, type AgentEnv } from "../agentGrants";
import { TEMPLATE_HEADERS } from "../imports/columns";
import { AFFILIATION_OPTIONS, FORM_ID_PROBLEM } from "../imports/rows";
import { createBatchFromAgentRows, getBatchSummary, ImportError } from "../imports/service";

// API for AI agents (SPEC 6.7), reached through the MCP server with an OAuth access token bound
// to a staff account. The agent acts as that person with that person's role: it can read the
// template, propose a batch (intake only) and read the counts of batches it proposed. It never
// confirms, links, merges, deletes, searches patients or reads clinical data, and never sees rows
// or candidates. Every call is audited as "agente de <name>" with the client name and counts only.

const FIELD_RULES: Record<ImportField, string> = {
  fullName: "Required. Full name as written; at least 3 characters with letters. Never used alone to match people.",
  birthDate: "Required. YYYY-MM-DD (DD/MM/YYYY is also read). Must be a real date between 1900 and today.",
  birthState: "Optional. Mexican state of birth as text.",
  formId: `Optional. ${FORM_ID_PROBLEM} Spaces and dashes are removed.`,
  phone: "Optional. Landline with 10 digits; separators and a +52 prefix are fine.",
  mobile: "Optional. Mobile phone with 10 digits; separators and a +52 prefix are fine.",
  residence: "Optional. Usual residence (town or community).",
  affiliation: `Optional. One of: ${AFFILIATION_OPTIONS.join(", ")}.`,
};

const TEMPLATE: AgentImportTemplate = {
  maxRows: MAX_AGENT_IMPORT_ROWS,
  columns: IMPORT_FIELDS.map((field) => ({
    field,
    label: TEMPLATE_HEADERS[field],
    required: field === "fullName" || field === "birthDate",
    rule: FIELD_RULES[field],
  })),
  rules: [
    "Send identification fields only. Never send clinical data (symptoms, results, notes).",
    "Do not invent values: leave a field out when the source does not have it.",
    "Each row is validated and matched against existing patients on the server.",
    "Nothing is saved as a patient until an intake person reviews and confirms each row.",
    "Agents cannot confirm, link, merge, delete or search patients.",
  ],
};

function toStatus(batch: ImportBatchSummary): AgentImportStatus {
  const { new: fresh, possibleMatch, invalid, confirmed, discarded } = batch.counts;
  return { batchId: batch.id, status: batch.status, counts: { new: fresh, possibleMatch, invalid, confirmed, discarded } };
}

const countsDetail = (s: AgentImportStatus) =>
  `new=${s.counts.new} possible=${s.counts.possibleMatch} invalid=${s.counts.invalid} confirmed=${s.counts.confirmed} discarded=${s.counts.discarded}`;

const ROLE_LABEL: Record<AgentIdentityView["role"], string> = {
  intake: "Captura",
  nutritionist: "Nutrición",
  doctor: "Médico",
  pathologist: "Patología",
  admin: "Administración",
};

export const ONLY_INTAKE_MESSAGE = (role: AgentIdentityView["role"]) =>
  `Solo una cuenta de Captura puede proponer pacientes. Esta cuenta es de ${ROLE_LABEL[role]}: pide a alguien de Captura que conecte el agente con su cuenta.`;

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
  .post(
    "/imports",
    bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Body too large: at most 1 MB." }, 413) }),
    async (c) => {
      const agent = c.get("agent");
      if (agent.role !== "intake") {
        await writeAudit({
          actorId: agent.actorId,
          action: "AGENT_IMPORT_REFUSED",
          entity: "AgentGrant",
          entityId: agent.grantId,
          detail: `client=${agent.clientName} role=${agent.role}`,
        });
        return c.json({ error: ONLY_INTAKE_MESSAGE(agent.role) }, 403);
      }
      const parsed = agentImportSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        // Paths and messages only: never echo row values back.
        const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
        return c.json({ error: `Invalid batch (1 to ${MAX_AGENT_IMPORT_ROWS} rows). ${issues.join("; ")}` }, 400);
      }
      const batch = await createBatchFromAgentRows({
        rows: parsed.data.rows,
        note: parsed.data.note?.trim().slice(0, 200) || null,
        actorId: agent.actorId,
        grantId: agent.grantId,
        clientName: agent.clientName,
      });
      return c.json(toStatus(batch), 201);
    },
  )
  .get("/imports/:id", async (c) => {
    const agent = c.get("agent");
    const id = c.req.param("id");
    // Only batches proposed by an agent connected to this same person.
    const proposed = await db.importBatch.findFirst({ where: { id, source: "MCP" }, select: { agentGrantId: true } });
    const owner = proposed?.agentGrantId
      ? await db.agentGrant.findFirst({ where: { id: proposed.agentGrantId, userId: agent.userId }, select: { id: true } })
      : null;
    const batch = owner ? await getBatchSummary(id) : null;
    if (!batch) return c.json({ error: "Batch not found." }, 404);
    const status = toStatus(batch);
    await writeAudit({
      actorId: agent.actorId,
      action: "AGENT_IMPORT_STATUS_READ",
      entity: "ImportBatch",
      entityId: id,
      detail: `client=${agent.clientName} ${countsDetail(status)}`,
    });
    return c.json(status);
  });
