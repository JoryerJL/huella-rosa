import type { CampaignListItem, CampaignPackage, CampaignStatus, CampaignView } from "@er/shared";
import { db, mergeVisit, setSyncMeta, type CampaignChoice, type PackageMeta } from "./db";
import { syncNow } from "./sync";
import { ApiError, request } from "../lib/http";
import { es } from "../i18n/es";

// Campaign package (SPEC 6.1, 6.8 item 2): minimal index of the campaign's patients, valid 7 days.

async function fetchCampaigns(): Promise<CampaignListItem[]> {
  const data = await request<CampaignListItem[] | { campaigns: CampaignListItem[] }>("/api/campaigns");
  return Array.isArray(data) ? data : data.campaigns;
}

const STATUS_ORDER: Record<CampaignStatus, number> = { ACTIVE: 0, UPCOMING: 1, FINISHED: 2 };

/** Campaigns a tablet can download for: in progress first, then upcoming, each by start date. */
export function campaignChoices(list: CampaignListItem[]): CampaignListItem[] {
  return list
    .filter((c) => c.status === "ACTIVE" || c.status === "UPCOMING")
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.date.localeCompare(b.date));
}

/**
 * Which choice to preselect: the one this tablet chose last if it is still offered, else one in
 * progress that shares localities with the last choice, else the first in progress, else the first.
 */
export function defaultCampaignId(choices: CampaignListItem[], last: CampaignChoice | null): string | null {
  if (last) {
    if (choices.some((c) => c.id === last.campaignId)) return last.campaignId;
    const same = choices.find((c) => c.status === "ACTIVE" && c.localityIds.some((id) => last.localityIds.includes(id)));
    if (same) return same.id;
  }
  return (choices.find((c) => c.status === "ACTIVE") ?? choices[0])?.id ?? null;
}

/** Campaigns offered on the package page (needs signal). */
export async function fetchCampaignChoices(): Promise<CampaignListItem[]> {
  return campaignChoices(await fetchCampaigns());
}

/** The campaign this tablet chose last, remembered on the device. */
export async function getCampaignChoice(): Promise<CampaignChoice | null> {
  return ((await db.meta.get("campaignChoice"))?.value as CampaignChoice | undefined) ?? null;
}

export async function saveCampaignChoice(campaign: Pick<CampaignListItem, "id" | "localityIds">): Promise<void> {
  const value: CampaignChoice = { campaignId: campaign.id, localityIds: campaign.localityIds };
  await db.meta.put({ key: "campaignChoice", value });
}

async function newestCampaign(): Promise<CampaignView> {
  const newest = [...(await fetchCampaigns())].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!newest) throw new ApiError(es.package.noCampaign, 404);
  return newest;
}

/**
 * Downloads the package of the chosen campaign (the newest one when none is given) and replaces
 * the local index with it. The choice is remembered on this tablet.
 */
export async function downloadCampaignPackage(campaignId?: string): Promise<PackageMeta> {
  // Send what is pending first so nothing typed here is replaced by older server data.
  await syncNow();
  const id = campaignId ?? (await newestCampaign()).id;
  const pkg = await request<CampaignPackage>(`/api/campaigns/${encodeURIComponent(id)}/package`);

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
    await saveCampaignChoice({ id: pkg.campaign.id, localityIds: pkg.campaign.localityIds });
  });
  await setSyncMeta({ cursor: pkg.cursor, lastSyncAt: new Date().toISOString() });
  return meta;
}
