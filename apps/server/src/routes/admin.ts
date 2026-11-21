import { Hono, type Context } from "hono";
import { CLINICAL_ROLES, linkMatchSchema, resolveConflictSchema } from "@er/shared";
import { AdminError, campaignDashboard, dismissMatch, linkMatch, listConflicts, listMatches, resolveConflict } from "../admin";
import { publishChange } from "../changes";
import { requireRole, type SessionEnv } from "../session";

// Administration routes (SPEC 6.5, 6.6). Role checks live here, on the server (rule 7).

function fail(c: Context, error: unknown) {
  if (error instanceof AdminError) return c.json({ error: error.message }, error.status);
  throw error;
}

const deviceOf = (c: Context) => c.req.header("x-device-id") ?? null;
/** Wakes the tablets so they pull the decision (only a cursor travels). */
const notify = () => publishChange(new Date().toISOString());

export const matchRoutes = new Hono<SessionEnv>()
  .get("/", requireRole("admin"), async (c) => {
    const status = c.req.query("status") ?? "OPEN";
    return c.json({ matches: await listMatches(status) });
  })
  .post("/:id/link", requireRole("admin"), async (c) => {
    const parsed = linkMatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Elige cuál registro queda como principal." }, 400);
    try {
      const result = await linkMatch(c.req.param("id"), parsed.data.mainId, c.get("staff"), deviceOf(c));
      await notify();
      return c.json(result);
    } catch (error) {
      return fail(c, error);
    }
  })
  .post("/:id/dismiss", requireRole("admin"), async (c) => {
    try {
      await dismissMatch(c.req.param("id"), c.get("staff"), deviceOf(c));
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

export const conflictRoutes = new Hono<SessionEnv>()
  .get("/", requireRole("admin", ...CLINICAL_ROLES), async (c) => {
    const status = c.req.query("status") ?? "OPEN";
    return c.json({ conflicts: await listConflicts(c.get("staff"), status) });
  })
  .post("/:id/resolve", requireRole("admin", ...CLINICAL_ROLES), async (c) => {
    const parsed = resolveConflictSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Elige cuál dato se queda." }, 400);
    try {
      await resolveConflict(c.req.param("id"), parsed.data.choice, c.get("staff"), deviceOf(c));
      await notify();
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

export const dashboardRoutes = new Hono<SessionEnv>().get("/", requireRole("admin", ...CLINICAL_ROLES), async (c) => {
  const campaignId = c.req.query("campaignId");
  if (!campaignId) return c.json({ error: "Falta la jornada." }, 400);
  try {
    return c.json(await campaignDashboard(campaignId));
  } catch (error) {
    return fail(c, error);
  }
});
