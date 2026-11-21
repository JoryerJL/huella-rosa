import { Hono } from "hono";
import { createAgentTokenSchema, type AgentTokenView, type CreatedAgentToken } from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { requireRole, type SessionEnv } from "../session";
import { generateAgentToken, hashAgentToken, toAgentTokenView } from "../agentTokens";

// Agent token administration (SPEC 5, 6.7). Admin only, checked on the server (rule 7).
// The plain token is returned once by POST and never stored, logged or audited.

const deviceOf = (header: string | undefined) => header?.slice(0, 64) ?? null;

export const agentTokenRoutes = new Hono<SessionEnv>()
  .use(requireRole("admin"))
  .get("/", async (c) => {
    const rows = await db.agentToken.findMany({ orderBy: { createdAt: "desc" } });
    return c.json({ agentTokens: rows.map(toAgentTokenView) satisfies AgentTokenView[] });
  })
  .post("/", async (c) => {
    const parsed = createAgentTokenSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Escribe un nombre de 2 a 60 letras para el agente." }, 400);
    const name = parsed.data.name;
    const taken = await db.agentToken.findFirst({ where: { name, revokedAt: null }, select: { id: true } });
    if (taken) return c.json({ error: "Ya hay un agente activo con ese nombre. Usa otro nombre." }, 409);

    const staff = c.get("staff");
    const token = generateAgentToken();
    const row = await db.$transaction(async (tx) => {
      const created = await tx.agentToken.create({
        data: { name, tokenHash: hashAgentToken(token), role: "intake", createdBy: staff.id },
      });
      await writeAudit(
        {
          actorId: staff.id,
          action: "AGENT_TOKEN_CREATED",
          deviceId: deviceOf(c.req.header("x-device-id")),
          entity: "AgentToken",
          entityId: created.id,
        },
        tx,
      );
      return created;
    });
    const response: CreatedAgentToken = { agentToken: toAgentTokenView(row), token };
    return c.json(response, 201);
  })
  .post("/:id/revoke", async (c) => {
    const id = c.req.param("id");
    const staff = c.get("staff");
    const existing = await db.agentToken.findUnique({ where: { id } });
    if (!existing) return c.json({ error: "No encontramos ese agente." }, 404);
    if (existing.revokedAt) return c.json({ agentToken: toAgentTokenView(existing) });
    const row = await db.$transaction(async (tx) => {
      const revoked = await tx.agentToken.update({ where: { id }, data: { revokedAt: new Date() } });
      await writeAudit(
        {
          actorId: staff.id,
          action: "AGENT_TOKEN_REVOKED",
          deviceId: deviceOf(c.req.header("x-device-id")),
          entity: "AgentToken",
          entityId: id,
        },
        tx,
      );
      return revoked;
    });
    return c.json({ agentToken: toAgentTokenView(row) });
  });
