import { Hono } from "hono";
import { ROLES, type AgentGrantList } from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { requireRole, type SessionEnv } from "../session";
import { toGrantView } from "../agentGrants";

// "Agentes conectados" (SPEC 6.7): each person sees and disconnects the AI agents connected to
// their own account; administration sees and can disconnect any. Checked on the server (rule 7).

const deviceOf = (header: string | undefined) => header?.slice(0, 64) ?? null;

export const agentGrantRoutes = new Hono<SessionEnv>()
  .use(requireRole(...ROLES))
  .get("/", async (c) => {
    const staff = c.get("staff");
    const grants = await db.agentGrant.findMany({
      where: staff.role === "admin" ? {} : { userId: staff.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const users = await db.user.findMany({
      where: { id: { in: [...new Set(grants.map((g) => g.userId))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const response: AgentGrantList = {
      grants: grants.map((g) => toGrantView(g, nameOf.get(g.userId) ?? "", staff.id)),
    };
    return c.json(response);
  })
  .post("/:id/revoke", async (c) => {
    const staff = c.get("staff");
    const id = c.req.param("id");
    const grant = await db.agentGrant.findUnique({ where: { id } });
    // Someone else's agent looks the same as a missing one: nothing is revealed.
    if (!grant || (grant.userId !== staff.id && staff.role !== "admin")) {
      return c.json({ error: "No encontramos ese agente." }, 404);
    }
    const user = await db.user.findUnique({ where: { id: grant.userId }, select: { name: true } });
    if (grant.revokedAt) return c.json({ grant: toGrantView(grant, user?.name ?? "", staff.id) });
    const revoked = await db.$transaction(async (tx) => {
      const row = await tx.agentGrant.update({ where: { id }, data: { revokedAt: new Date() } });
      await writeAudit(
        {
          actorId: staff.id,
          action: "AGENT_GRANT_REVOKED",
          deviceId: deviceOf(c.req.header("x-device-id")),
          entity: "AgentGrant",
          entityId: id,
          detail: `client=${grant.clientName}`,
        },
        tx,
      );
      return row;
    });
    return c.json({ grant: toGrantView(revoked, user?.name ?? "", staff.id) });
  });
