import { Hono } from "hono";
import { db } from "../db";
import { requireRole, type SessionEnv } from "../session";

export const auditRoutes = new Hono<SessionEnv>().get("/", requireRole("admin"), async (c) => {
  const entityId = c.req.query("entityId");
  const entries = await db.auditLog.findMany({
    where: entityId ? { entityId } : undefined,
    orderBy: { at: "desc" },
    take: 100,
  });
  return c.json({ entries });
});
