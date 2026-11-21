import { Hono } from "hono";
import type { CampaignPackage } from "@er/shared";
import { writeAudit } from "../audit";
import { requireRole, type SessionEnv } from "../session";
import {
  buildPackageData,
  currentCursor,
  listCampaigns,
  loadCampaignScope,
  PACKAGE_VALID_DAYS,
} from "../campaignPackage";

export const campaignRoutes = new Hono<SessionEnv>()
  .get("/", requireRole("intake", "clinician", "admin"), async (c) => {
    return c.json(await listCampaigns());
  })
  // Offline campaign package (SPEC 6.1, 6.8): what an intake device needs to work without signal.
  .get("/:id/package", requireRole("intake"), async (c) => {
    const staff = c.get("staff");
    const scope = await loadCampaignScope(c.req.param("id"));
    if (!scope) return c.json({ error: "No encontramos esta jornada." }, 404);

    // Read the cursor first: anything written while the package is built comes back on pull.
    const cursor = await currentCursor();
    const [data, campaigns] = await Promise.all([buildPackageData(scope), listCampaigns()]);
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + PACKAGE_VALID_DAYS * 24 * 60 * 60 * 1000);

    const body: CampaignPackage = {
      campaign: scope.campaign,
      campaigns,
      patients: data.patients,
      visits: data.visits,
      generatedAt: generatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      cursor,
    };
    await writeAudit({
      actorId: staff.id,
      action: "PACKAGE_DOWNLOAD",
      deviceId: c.req.header("x-device-id") ?? null,
      entity: "Campaign",
      entityId: scope.campaign.id,
      detail: `patients=${data.patients.length} visits=${data.visits.length}`,
    });
    return c.json(body);
  });
