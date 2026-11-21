import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { withWebStatics } from "./web";

const dist = mkdtempSync(join(tmpdir(), "huella-web-"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "index.html"), "<!doctype html><title>Huella Rosa</title>");
writeFileSync(join(dist, "sw.js"), "self.addEventListener('install', () => {});");
writeFileSync(join(dist, "manifest.webmanifest"), '{"name":"Huella Rosa"}');
writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)");
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const api = new Hono().get("/api/health", (c) => c.json({ db: true, valkey: true }));
const site = withWebStatics(api, `${dist}/`);

describe("withWebStatics", () => {
  it("keeps /api routes first", async () => {
    const res = await site.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ db: true, valkey: true });
  });

  it("answers unknown /api paths with 404 JSON, not the app shell", async () => {
    const res = await site.request("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("serves index.html at / and as SPA fallback for client routes", async () => {
    for (const path of ["/", "/pacientes/maria-lopez"]) {
      const res = await site.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("Huella Rosa");
    }
  });

  it("serves the service worker as JavaScript that is always revalidated", async () => {
    const res = await site.request("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("service-worker-allowed")).toBe("/");
  });

  it("serves the manifest with its media type", async () => {
    const res = await site.request("/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
  });

  it("caches hashed assets for a year", async () => {
    const res = await site.request("/assets/index-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("refuses to start without a built web app", () => {
    expect(() => withWebStatics(api, join(dist, "missing/"))).toThrow(/does not exist/);
  });
});
