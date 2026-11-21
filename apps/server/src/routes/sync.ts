import { Hono } from "hono";
import { syncPushSchema, type OpResult, type SyncPushResponse } from "@er/shared";
import { applySyncOp } from "../sync";
import { requireRole, type SessionEnv } from "../session";

export const syncRoutes = new Hono<SessionEnv>().post("/push", requireRole("intake"), async (c) => {
  const parsed = syncPushSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Los datos enviados no tienen el formato esperado." }, 400);
  }
  const staff = c.get("staff");
  // Sequential on purpose: ops from one device depend on each other (create patient, then visit).
  const results: OpResult[] = [];
  for (const op of parsed.data.ops) {
    results.push(await applySyncOp(op, staff));
  }
  const response: SyncPushResponse = { results };
  return c.json(response);
});
