import { describe, expect, it } from "vitest";
import { isoFromDateParts, partsFromIso } from "./DateFields";
import { campaignDatesError } from "../pages/AdminCampaigns";
import { es } from "../i18n/es";

const t = es.admin.campaigns;
const parts = (day: string, month: string, year: string) => ({ day, month, year });

describe("DD / MM / AAAA date boxes", () => {
  it("round-trips a stored AAAA-MM-DD date and leaves bad input empty", () => {
    expect(partsFromIso("2026-11-21")).toEqual(parts("21", "11", "2026"));
    expect(isoFromDateParts(parts("21", "11", "2026"))).toBe("2026-11-21");
    expect(isoFromDateParts(parts("1", "2", "2026"))).toBe("2026-02-01");
    expect(isoFromDateParts(parts("31", "02", "2026"))).toBeNull();
    expect(partsFromIso(undefined)).toEqual(parts("", "", ""));
  });

  it("explains campaign date problems in plain Spanish", () => {
    expect(campaignDatesError(parts("", "", ""), parts("22", "11", "2026"))).toBe(t.errorDate);
    expect(campaignDatesError(parts("21", "11", "2026"), parts("22", "13", "2026"))).toBe(t.errorEndDate);
    expect(campaignDatesError(parts("22", "11", "2026"), parts("21", "11", "2026"))).toBe(t.errorEndBeforeStart);
    expect(campaignDatesError(parts("21", "11", "2026"), parts("21", "11", "2026"))).toBeNull();
  });
});
