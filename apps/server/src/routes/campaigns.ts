import { Hono } from "hono";
import type { CampaignView } from "@er/shared";
import { db } from "../db";
import { requireRole, type SessionEnv } from "../session";

export const campaignRoutes = new Hono<SessionEnv>().get(
  "/",
  requireRole("intake", "clinician", "admin"),
  async (c) => {
    const rows = await db.campaign.findMany({
      select: { id: true, name: true, date: true },
      orderBy: [{ date: "desc" }, { name: "asc" }],
    });
    const campaigns: CampaignView[] = rows;
    return c.json(campaigns);
  },
);
