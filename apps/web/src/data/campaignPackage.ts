import type { CampaignPackage, CampaignView } from "@er/shared";
import { db, mergeVisit, setSyncMeta, type PackageMeta } from "./db";
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
    // Keep every CampaignView field (e.g. endDate) except the package-only locality list.
    campaign: (({ localityIds: _localities, ...view }) => view)(pkg.campaign),
    campaigns: pkg.campaigns,
    generatedAt: pkg.generatedAt,
    expiresAt: pkg.expiresAt,
  };

  await db.transaction("rw", db.patients, db.visits, db.outbox, db.meta, async () => {
    // Keep rows that still have unsynced ops on this device; replace everything else.
    const keep = new Set<string>();
    const open = await db.outbox.where("status").anyOf("pending", "failed").toArray();
    for (const entry of open) if ("patientId" in entry.op) keep.add(entry.op.patientId);
    const previousVisits = new Map((await db.visits.toArray()).map((v) => [v.id, v]));
    await db.patients.filter((p) => !keep.has(p.id)).delete();
    await db.visits.filter((v) => !keep.has(v.patientId)).delete();
    await db.patients.bulkPut(pkg.patients);
    // Keep the step state this tablet knows for visits that come back in the package.
    await db.visits.bulkPut(pkg.visits.map((v) => mergeVisit(v, previousVisits.get(v.id))));
    await db.meta.put({ key: "package", value: meta });
  });
  await setSyncMeta({ cursor: pkg.cursor, lastSyncAt: new Date().toISOString() });
  return meta;
}
