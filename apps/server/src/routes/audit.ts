import { Hono } from "hono";
import { db } from "../db";
import { AdminError, patientAudit } from "../admin";
import { requireRole, type SessionEnv } from "../session";

export const auditRoutes = new Hono<SessionEnv>().get("/", requireRole("admin"), async (c) => {
  const patientId = c.req.query("patientId");
  if (patientId) {
    // Everything for one patient (visits, steps, scans, imports), with names, never values.
    try {
      return c.json({ entries: await patientAudit(patientId) });
    } catch (error) {
      if (error instanceof AdminError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  }
  const entityId = c.req.query("entityId");
  const entries = await db.auditLog.findMany({
    where: entityId ? { entityId } : undefined,
    orderBy: { at: "desc" },
    take: 100,
  });
  return c.json({ entries });
});
