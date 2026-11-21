import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

/** Built web app (apps/web/dist). Override with WEB_DIST_DIR. */
export const webDistDir = process.env.WEB_DIST_DIR ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));

/**
 * Wraps the API with the built web app on the same origin (production, SERVE_WEB=1).
 * The /api routes go first; unknown /api paths stay 404 instead of falling back to the SPA.
 */
export function withWebStatics(api: Hono<any, any, any>, distDir: string = webDistDir): Hono {
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error(`SERVE_WEB=1 but ${distDir}index.html does not exist. Run "npm run build -w @er/web".`);
  }
  // serveStatic resolves `root` against the process working directory.
  const root = relative(process.cwd(), distDir) || ".";
  const site = new Hono();
  site.route("/", api);
  site.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  // Cache headers go on the finished response (serveStatic builds it before its onFound hook runs).
  site.use("*", async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    const path = c.req.path;
    if (path === "/" || /^\/(sw\.js|registerSW\.js|workbox-[^/]+\.js|index\.html|manifest\.webmanifest)$/.test(path)) {
      // The service worker and app shell must be revalidated so updates reach installed apps.
      c.res.headers.set("Cache-Control", "no-cache");
      if (path === "/sw.js") c.res.headers.set("Service-Worker-Allowed", "/");
    } else if (path.startsWith("/assets/")) {
      c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
  });
  // Hono's MIME table already maps .webmanifest to application/manifest+json.
  site.use("*", serveStatic({ root }));
  // SPA fallback: client-side routes (e.g. /pacientes/...) get index.html.
  const indexPath = join(distDir, "index.html");
  site.get("*", async (c) => {
    c.header("Cache-Control", "no-cache");
    return c.html(await readFile(indexPath, "utf8"));
  });
  return site;
}
