import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignListItem, CampaignStatus } from "@er/shared";
import { db } from "./db";
import {
  campaignChoices,
  defaultCampaignId,
  downloadCampaignPackage,
  getCampaignChoice,
  saveCampaignChoice,
} from "./campaignPackage";

function campaign(id: string, status: CampaignStatus, date: string, localityIds: string[]): CampaignListItem {
  return {
    id,
    name: `Jornada ${id}`,
    date,
    endDate: date,
    municipality: "San Ejemplo",
    state: "Oaxaca",
    localityIds,
    localities: [],
    status,
  };
}

const finished = campaign("old", "FINISHED", "2026-10-01", ["loc-a"]);
const upcoming = campaign("next", "UPCOMING", "2026-12-05", ["loc-c"]);
const sierra = campaign("sierra", "ACTIVE", "2026-11-21", ["loc-a", "loc-b"]);
const valle = campaign("valle", "ACTIVE", "2026-11-20", ["loc-d"]);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("campaign choice on the package page", () => {
  it("offers only campaigns in progress or upcoming, in progress first", () => {
    expect(campaignChoices([upcoming, finished, sierra, valle]).map((c) => c.id)).toEqual(["valle", "sierra", "next"]);
  });

  it("preselects the last choice, else one in progress sharing its localities, else the first in progress", () => {
    const choices = campaignChoices([upcoming, sierra, valle]);
    expect(defaultCampaignId(choices, null)).toBe("valle");
    expect(defaultCampaignId(choices, { campaignId: "next", localityIds: ["loc-c"] })).toBe("next");
    // Last time this tablet went to a finished campaign in loc-a: the one in progress there wins.
    expect(defaultCampaignId(choices, { campaignId: "old", localityIds: ["loc-a"] })).toBe("sierra");
    expect(defaultCampaignId(choices, { campaignId: "old", localityIds: ["loc-z"] })).toBe("valle");
    expect(defaultCampaignId([upcoming], null)).toBe("next");
    expect(defaultCampaignId([], null)).toBeNull();
  });

  it("remembers the choice on this tablet", async () => {
    expect(await getCampaignChoice()).toBeNull();
    await saveCampaignChoice(sierra);
    expect(await getCampaignChoice()).toEqual({ campaignId: "sierra", localityIds: ["loc-a", "loc-b"] });
  });

  it("downloads the chosen campaign's package and remembers it", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const body = url.includes("/package")
          ? {
              campaign: { id: "sierra", name: "Jornada sierra", date: "2026-11-21", endDate: "2026-11-23", localityIds: ["loc-a"] },
              campaigns: [],
              patients: [],
              visits: [],
              generatedAt: "2026-11-21T10:00:00.000Z",
              expiresAt: "2026-11-28T10:00:00.000Z",
              cursor: "0",
            }
          : { ops: [], results: [], patients: [], visits: [], cursor: "0" };
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const meta = await downloadCampaignPackage("sierra");
    expect(meta.campaignId).toBe("sierra");
    expect(urls.some((u) => u.endsWith("/api/campaigns/sierra/package"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/api/campaigns"))).toBe(false);
    expect(await getCampaignChoice()).toEqual({ campaignId: "sierra", localityIds: ["loc-a"] });
  });
});
