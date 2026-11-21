import type { CampaignPackage, CampaignView } from "@er/shared";
import { db, setSyncMeta, type PackageMeta } from "./db";
import { syncNow } from "./sync";
import { ApiError, request } from "../lib/http";
import { es } from "../i18n/es";

// Campaign package (SPEC 6.1, 6.8 item 2): minimal index of the campaign's patients, valid 7 days.

async function newestCampaign(): Promise<CampaignView> {
  const data = await request<CampaignView[] | { campaigns: CampaignView[] }>("/api/campaigns");
  const list = Array.isArray(data) ? data : data.campaigns;
  const newest = [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!newest) throw new ApiError(es.package.noCampaign, 404);
  return newest;
}

/** Downloads the package of the newest campaign and replaces the local index with it. */
export async function downloadCampaignPackage(): Promise<PackageMeta> {
  // Send what is pending first so nothing typed here is replaced by older server data.
  await syncNow();
  const campaign = await newestCampaign();
  const pkg = await request<CampaignPackage>(`/api/campaigns/${encodeURIComponent(campaign.id)}/package`);

  const meta: PackageMeta = {
    campaignId: pkg.campaign.id,
    campaign: { id: pkg.campaign.id, name: pkg.campaign.name, date: pkg.campaign.date },
    campaigns: pkg.campaigns,
    generatedAt: pkg.generatedAt,
    expiresAt: pkg.expiresAt,
  };

  await db.transaction("rw", db.patients, db.visits, db.outbox, db.meta, async () => {
    // Keep rows that still have unsynced ops on this device; replace everything else.
    const keep = new Set<string>();
    const open = await db.outbox.where("status").anyOf("pending", "failed").toArray();
    for (const entry of open) keep.add(entry.op.patientId);
    await db.patients.filter((p) => !keep.has(p.id)).delete();
    await db.visits.filter((v) => !keep.has(v.patientId)).delete();
    await db.patients.bulkPut(pkg.patients);
    await db.visits.bulkPut(pkg.visits);
    await db.meta.put({ key: "package", value: meta });
  });
  await setSyncMeta({ cursor: pkg.cursor, lastSyncAt: new Date().toISOString() });
  return meta;
}
