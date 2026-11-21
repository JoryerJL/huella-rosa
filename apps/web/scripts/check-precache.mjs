// Checks that the production service worker precaches the app shell (index.html and the JS/CSS
// bundle), so the installed app reloads without signal. Run after `vite build`; exits 1 if not.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const swPath = join(dist, "sw.js");
if (!existsSync(swPath)) {
  console.error(`precache: ${swPath} not found. Run "npm run build -w @er/web" first.`);
  process.exit(1);
}

// The service worker may import its manifest from a workbox chunk; read every top-level JS in dist.
const sources = readdirSync(dist)
  .filter((f) => f === "sw.js" || /^workbox-.*\.js$/.test(f))
  .map((f) => readFileSync(join(dist, f), "utf8"))
  .join("\n");

const assets = readdirSync(join(dist, "assets"));
const required = [
  "index.html",
  ...assets.filter((f) => /^index-.*\.js$/.test(f)).map((f) => `assets/${f}`),
  ...assets.filter((f) => /^index-.*\.css$/.test(f)).map((f) => `assets/${f}`),
];

const missing = required.filter((url) => !sources.includes(`"${url}"`) && !sources.includes(`'${url}'`));
if (required.length < 2 || missing.length > 0) {
  console.error(`precache: missing from sw.js: ${missing.join(", ") || "(no bundle found)"}`);
  process.exit(1);
}
console.log(`precache OK: sw.js precaches ${required.join(", ")}`);
