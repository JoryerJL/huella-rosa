import { Hono } from "hono";
import type { LocalityView } from "@er/shared";
import { db } from "../db";
import { requireRole, type SessionEnv } from "../session";

// Localities to pick from when creating a campaign (SPEC 6.0). New ones are created from the campaign form.
export const localityRoutes = new Hono<SessionEnv>().get("/", requireRole("admin"), async (c) => {
  const localities: LocalityView[] = await db.locality.findMany({
    select: { id: true, name: true, municipality: true, hasSignal: true },
    orderBy: [{ municipality: "asc" }, { name: "asc" }],
  });
  return c.json({ localities });
});
