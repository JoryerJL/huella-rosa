// Turns the per-feature recording (demo-videos/features/raw, made by features.ts) into:
//   docs/media/gifs/NN-slug.gif       960 px wide, 10-12 fps, palettegen/paletteuse, <= 3 MB, loops (committed)
//   docs/media/posters/NN-slug.png    1280x720 branded poster (committed)
//   demo-videos/features/clips/NN-slug.mp4   the sped-up clip for the presentation videos (not committed)
//
// Run: npm run demo:features:media   (needs ffmpeg/ffprobe and the Chrome channel for Playwright)

import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAW = path.join(ROOT, "demo-videos", "features", "raw");
const CLIPS_OUT = path.join(ROOT, "demo-videos", "features", "clips");
const GIFS = path.join(ROOT, "docs", "media", "gifs");
const POSTERS = path.join(ROOT, "docs", "media", "posters");
const FONT = path.join(ROOT, "video", "demo-2min", "assets", "fonts", "atkinson-hyperlegible-next-latin-wght.woff2");
const MARK = path.join(ROOT, "docs", "brand", "logos", "round2", "fingerprint-b-mark.svg");

const MAX_GIF_BYTES = 3 * 1024 * 1024;
const GIF_WIDTH = 960;
/** Longest a clip may play; longer windows are sped up to fit. */
const TARGET_SECONDS = 12;

type TabletId = "A" | "B";
interface Clip {
  n: number;
  slug: string;
  tablets: TabletId[];
  windows: Partial<Record<TabletId, [number, number]>>;
  status: "pass" | "fail";
  stills: string[];
}
interface Feature {
  n: number;
  slug: string;
  group: string;
  title: string;
  sentence: string;
  caption: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function ffmpeg(args: string[]) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed:\n${r.stderr}`);
}

/** Input args and the per-input filter that trims, speeds up and scales one tablet window. */
function inputs(clip: Clip, videos: Record<string, string>, speed: number, width: number) {
  const args: string[] = [];
  const chains: string[] = [];
  clip.tablets.forEach((t, i) => {
    const [s, e] = clip.windows[t]!;
    args.push("-ss", s.toFixed(2), "-t", (e - s).toFixed(2), "-i", path.join(ROOT, videos[t]));
    chains.push(`[${i}:v]setpts=(PTS-STARTPTS)/${speed.toFixed(3)},scale=${width}:-2:flags=lanczos[v${i}]`);
  });
  const stack = clip.tablets.length > 1 ? `${clip.tablets.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${clip.tablets.length}[v]` : `[v0]copy[v]`;
  return { args, filter: `${chains.join(";")};${stack}` };
}

function windowSeconds(clip: Clip) {
  return Math.max(...clip.tablets.map((t) => clip.windows[t]![1] - clip.windows[t]![0]));
}

function makeGif(clip: Clip, videos: Record<string, string>, out: string) {
  const dur = windowSeconds(clip);
  const perTablet = Math.floor(GIF_WIDTH / clip.tablets.length);
  // Escalate until the GIF fits: fewer frames, fewer colors, then a shorter play time.
  const attempts = [
    { fps: 12, colors: 160, target: TARGET_SECONDS },
    { fps: 10, colors: 128, target: TARGET_SECONDS },
    { fps: 10, colors: 96, target: 10 },
    { fps: 10, colors: 64, target: 8 },
  ];
  for (const a of attempts) {
    const speed = Math.max(1, dur / a.target);
    const { args, filter } = inputs(clip, videos, speed, perTablet);
    ffmpeg([
      ...args,
      "-filter_complex",
      `${filter};[v]fps=${a.fps},split[x][y];[x]palettegen=max_colors=${a.colors}:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      "-loop",
      "0",
      out,
    ]);
    const size = statSync(out).size;
    if (size <= MAX_GIF_BYTES) return { size, fps: a.fps, speed, seconds: dur / speed };
  }
  throw new Error(`${path.basename(out)} is still over 3 MB`);
}

/** One MP4 per tablet (NN-slug-a.mp4, NN-slug-b.mp4), same speed, keyframes every 0.5 s so the renderer can seek. */
function makeClipMp4s(clip: Clip, videos: Record<string, string>, base: string) {
  const speed = Math.max(1, windowSeconds(clip) / TARGET_SECONDS);
  for (const t of clip.tablets) {
    const one: Clip = { ...clip, tablets: [t] };
    const { args, filter } = inputs(one, videos, speed, 1280);
    const out = `${base}-${t.toLowerCase()}.mp4`;
    ffmpeg([...args, "-filter_complex", `${filter};[v]fps=30,format=yuv420p[o]`, "-map", "[o]", "-c:v", "libx264", "-crf", "18", "-g", "15", "-an", out]);
  }
  return { speed, seconds: windowSeconds(clip) / speed };
}

function posterHtml(f: Feature, group: string, stills: string[]) {
  // Inline data URIs: a page set with setContent cannot load file:// resources.
  const dataUri = (file: string, type: string) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
  const font = dataUri(FONT, "font/woff2");
  const mark = readFileSync(MARK, "utf8");
  const shots = stills.map((s) => `<img src="${dataUri(path.join(ROOT, s), "image/png")}" alt="">`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @font-face { font-family: "Atkinson"; src: url("${font}") format("woff2"); font-weight: 200 800; }
    * { box-sizing: border-box; margin: 0; }
    body { width: 1280px; height: 720px; background: #FFF8F5; font-family: "Atkinson", system-ui, sans-serif; color: #3a2a2e; display: grid; grid-template-columns: 470px 1fr; overflow: hidden; }
    .text { padding: 64px 24px 56px 64px; display: flex; flex-direction: column; }
    .eyebrow { color: #B7426C; font-weight: 700; font-size: 22px; letter-spacing: .02em; }
    .num { color: #7D3B3B; font-weight: 800; font-size: 22px; opacity: .55; margin-right: 10px; }
    h1 { font-size: 48px; line-height: 1.08; font-weight: 800; color: #7D3B3B; margin-top: 18px; }
    p { font-size: 25px; line-height: 1.35; margin-top: 22px; }
    .brand { margin-top: auto; display: flex; align-items: center; gap: 14px; font-weight: 800; font-size: 26px; color: #7D3B3B; }
    .brand svg { width: 52px; height: 52px; }
    .shots { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 22px; padding: 40px 48px 40px 8px; }
    .shots img { width: 100%; border-radius: 22px; border: 12px solid #2b2124; box-shadow: 0 24px 48px rgba(125,59,59,.22); display: block; }
    .shots.two img { width: 74%; }
    .shots.two img:last-child { align-self: flex-end; margin-top: -120px; }
  </style></head><body>
    <div class="text">
      <div class="eyebrow"><span class="num">${pad(f.n)}</span>${group}</div>
      <h1>${f.title}</h1>
      <p>${f.sentence}</p>
      <div class="brand">${mark}<span>Huella Rosa</span></div>
    </div>
    <div class="shots ${stills.length > 1 ? "two" : ""}">${shots}</div>
  </body></html>`;
}

async function main() {
  const data = JSON.parse(readFileSync(path.join(RAW, "clips.json"), "utf8")) as { videos: Record<string, string>; clips: Clip[] };
  const meta = JSON.parse(readFileSync(path.join(ROOT, "scripts", "demo", "features.json"), "utf8")) as {
    groups: Record<string, string>;
    features: Feature[];
  };
  for (const d of [GIFS, POSTERS, CLIPS_OUT]) mkdirSync(d, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  let total = 0;
  let failed = 0;
  for (const f of meta.features) {
    const name = `${pad(f.n)}-${f.slug}`;
    const clip = data.clips.find((c) => c.n === f.n && c.status === "pass");
    if (!clip || clip.tablets.some((t) => !data.videos[t] || !existsSync(path.join(ROOT, data.videos[t])))) {
      console.log(`  ✗ ${name}: no passing clip in clips.json`);
      failed++;
      continue;
    }
    const gif = makeGif(clip, data.videos, path.join(GIFS, `${name}.gif`));
    const mp4 = makeClipMp4s(clip, data.videos, path.join(CLIPS_OUT, name));
    await page.setContent(posterHtml(f, meta.groups[f.group], clip.stills), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const poster = path.join(POSTERS, `${name}.png`);
    await page.screenshot({ path: poster });
    total += gif.size + statSync(poster).size;
    console.log(
      `  ✓ ${name}: gif ${mb(gif.size)} (${gif.fps} fps, x${gif.speed.toFixed(2)}, ${gif.seconds.toFixed(1)} s), clip ${mp4.seconds.toFixed(1)} s, poster ${mb(statSync(poster).size)}`,
    );
  }
  await browser.close();
  console.log(`• Committed media total: ${mb(total)}`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
