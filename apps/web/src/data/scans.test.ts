import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { pushScanQueue, queueScan, uploadScan } from "./scans";
import { fitWithin, jpegName, MAX_SIDE } from "../lib/imageCompress";
import { draftFromScan } from "../pages/ScanIdentifyPage";

describe("photo compression sizing", () => {
  it("scales the longest side down to 1600 px keeping the aspect ratio", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(4032, 1000).width).toBe(MAX_SIDE);
  });

  it("never upscales small photos", () => {
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("keeps the sample name and switches the extension to jpg", () => {
    expect(jpegName("formato-01.svg")).toBe("formato-01.jpg");
    expect(jpegName("IMG_2041.HEIC")).toBe("IMG_2041.jpg");
  });
});

describe("scan queue sync", () => {
  const link = { visitId: "v-1", campaignId: "c-1", folio: "B3-017-K" };

  beforeEach(async () => {
    await db.scanQueue.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads queued photos in order with their visit link, then deletes the blobs", async () => {
    await queueScan(new Blob(["a"], { type: "image/jpeg" }), "formato-01.jpg", link);
    await queueScan(new Blob(["b"], { type: "image/jpeg" }), "formato-02.jpg", { ...link, folio: "B3-018-L" });
    const calls: { name: string; folio: string | null }[] = [];
    const upload = vi.fn(async (_blob: Blob, name: string, l: { folio?: string | null } = {}) => {
      calls.push({ name, folio: l.folio ?? null });
      return {} as Awaited<ReturnType<typeof uploadScan>>;
    });
    expect(await pushScanQueue(upload)).toBe(2);
    expect(calls).toEqual([
      { name: "formato-01.jpg", folio: "B3-017-K" },
      { name: "formato-02.jpg", folio: "B3-018-L" },
    ]);
    expect(await db.scanQueue.count()).toBe(0);
  });

  it("keeps the photo when the upload fails (no signal) and retries next time", async () => {
    await queueScan(new Blob(["a"], { type: "image/jpeg" }), "formato-01.jpg", link);
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(pushScanQueue(failing)).rejects.toThrow("offline");
    expect(await db.scanQueue.count()).toBe(1);
  });

  it("sends the photo as multipart with visit id, campaign and folio", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "s-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { getItem: () => "dev-1", setItem: () => undefined });
    await queueScan(new Blob(["a"], { type: "image/jpeg" }), "formato-01.jpg", link);
    await pushScanQueue();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/scans");
    const form = init.body as FormData;
    expect((form.get("image") as File).name).toBe("formato-01.jpg");
    expect(form.get("visitId")).toBe("v-1");
    expect(form.get("folio")).toBe("B3-017-K");
    expect(form.get("campaignId")).toBe("c-1");
    expect(await db.scanQueue.count()).toBe(0);
  });
});

describe("identify with photo", () => {
  it("turns confirmed identification fields into the search form", () => {
    expect(draftFromScan({ fullName: "Lucía Ramírez Torres", birthDate: "05/01/1990", mobile: "55-0000-0003", formId: "RATL900105" })).toEqual({
      fullName: "Lucía Ramírez Torres",
      day: "05",
      month: "01",
      year: "1990",
      extraKind: "phone",
      extra: "55-0000-0003",
    });
    expect(draftFromScan({ fullName: "Ana", birthDate: "", formId: "ORRC880614" }).extraKind).toBe("formId");
  });
});
