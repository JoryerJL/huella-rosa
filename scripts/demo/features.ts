// Records one short, focused clip per feature (scripts/demo/features.json) on the production build,
// from a fresh database, with two "tablets" (browser contexts) recording continuously. Each clip is a
// window [start, end] of one or both tablet videos; setup steps between clips are left out of the clips.
// Like record.ts it is also an end-to-end test: every clip asserts the exact Spanish text on screen and
// the script exits non-zero on the first mismatch or on any forbidden system word.
//
// Run: npm run demo:features  (needs Valkey on localhost:6379: `docker compose up -d`).
// Output: demo-videos/features/raw/{tablet-a.webm, tablet-b.webm, clips.json, stills/*.png}
// Then features-media.ts cuts the GIFs (docs/media/gifs) and posters (docs/media/posters).
//
// All data is fictitious (phones 55-0000-00XX, invented names).

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEiraId, defaultCampaignName } from "@er/shared";

// ---------- Configuration ----------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "demo-videos", "features", "raw");
const STILLS = path.join(OUT, "stills");
const SERVER_PORT = 4311;
const PREVIEW_PORT = 4312;
const BASE = `http://localhost:${PREVIEW_PORT}`;
const VIEWPORT = { width: 1280, height: 800 };
const SLOW_MO = 90;
const TYPE_DELAY = 30;
const BRAND = "#b7426c"; // Frambuesa
const FORMATS = path.join(ROOT, "datos-ficticios", "formatos");
const EXCEL = path.join(ROOT, "datos-ficticios", "excel", "plantilla-llena.xlsx");

const ADMIN = { username: "smendez", pin: "1234" };
const NEW_STAFF = { name: "Ana Hernández Ruiz", username: "ahernandez", role: "Captura", pin: "2580" };
const INTAKE_2 = { name: "Laura Pérez Ortiz", username: "lperez", pin: "1234" }; // seeded
const NUTRITION = { name: "Jorge Torres Navarro", username: "jtorres", pin: "1234" }; // seeded
const DOCTOR = { name: "Dra. Carmen Ruiz Delgado", username: "cruiz", pin: "1234" }; // seeded
const NEVER_HERE = { username: "mvega", pin: "1234" }; // seeded, never logs in on tablet A

const MUNICIPALITY = "San Ejemplo de la Sierra";
const STATE = "Estado Ficticio";
const CAMPAIGN_LOCALITIES = ["San Ejemplo de la Sierra", "Rancho Prueba del Monte"];

const LUCIA = { search: "Lucia Ramirez Torres", shown: "Lucía Ramírez Torres", day: "05", month: "01", year: "1990", phone: "55-0000-0003" };
const JUANA = { search: "Juana Martinez Garcia", shown: "Juana Martínez García", day: "30", month: "07", year: "1972", phone: "55-0000-0002" };
const ANA_PAIR = "Ana Cruz Sánchez";
const NEW_PATIENT = {
  search: "Fernanda Ocampo Rios",
  givenNames: "Fernanda",
  paternalSurname: "Ocampo",
  maternalSurname: "Ríos",
  shown: "Fernanda Ocampo Ríos",
  day: "08",
  month: "09",
  year: "1987",
  phone: "55-0000-0071",
  residence: "San Ejemplo de la Sierra",
};

/** Words that must never appear on screen (CLAUDE.md, "Sin lenguaje de sistema"). */
const FORBIDDEN = [/servidor/i, /versión/i, /sincroniz/i, /conflicto/i, /operación/i, /duplicado/i, /ID interno/i, /\b(APPLIED|PENDING|REJECTED|WAITING)\b/];

// ---------- Small utilities ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pad = (n: number) => String(n).padStart(2, "0");
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function run(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) {
  const r = spawnSync(cmd, args, { ...opts, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

async function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

// ---------- Visible cursor (init script, same as record.ts) ----------

const CURSOR_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const dot = document.createElement("div");
    dot.id = "__demo_cursor";
    Object.assign(dot.style, {
      position: "fixed", left: "-40px", top: "-40px", width: "20px", height: "20px", borderRadius: "50%",
      background: "${BRAND}", opacity: "0.85", border: "2px solid #fff", boxShadow: "0 0 0 3px rgba(183,66,108,0.35)",
      pointerEvents: "none", zIndex: "2147483647", transform: "translate(-50%, -50%)",
    });
    document.documentElement.appendChild(dot);
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => {
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "fixed", left: e.clientX + "px", top: e.clientY + "px", width: "16px", height: "16px", borderRadius: "50%",
        border: "3px solid ${BRAND}", transform: "translate(-50%, -50%) scale(1)", opacity: "1", pointerEvents: "none",
        zIndex: "2147483646", transition: "transform 500ms ease-out, opacity 500ms ease-out",
      });
      document.documentElement.appendChild(ring);
      requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.transform = "translate(-50%, -50%) scale(4)"; ring.style.opacity = "0"; }));
      setTimeout(() => ring.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();`;

// ---------- Clip bookkeeping ----------

type TabletId = "A" | "B";
interface ClipRecord {
  n: number;
  slug: string;
  tablets: TabletId[];
  /** Seconds from the start of each tablet's video. */
  windows: Partial<Record<TabletId, [number, number]>>;
  status: "pass" | "fail";
  checks: string[];
  stills: string[];
  error?: string;
}

const clips: ClipRecord[] = [];
const softFailures: string[] = [];
let currentChecks: string[] = [];
let currentClip = "setup";
const tablets: Record<TabletId, { ctx: BrowserContext; page: Page; videoStart: number }> = {} as never;

const videoSecs = (id: TabletId, at: number) => Math.round(((at - tablets[id].videoStart) / 1000) * 100) / 100;

/** Runs one feature clip and records its window on each involved tablet's video. */
async function clip(n: number, slug: string, involved: TabletId[], fn: () => Promise<void>) {
  currentClip = `${pad(n)}-${slug}`;
  currentChecks = [];
  console.log(`\n▶ ${currentClip}`);
  await pause(400); // a calm first frame
  const start = Date.now();
  const stills: string[] = [];
  const windowsOf = (end: number) => Object.fromEntries(involved.map((t) => [t, [videoSecs(t, start), videoSecs(t, end)]]));
  try {
    await fn();
    for (const t of involved) {
      const file = path.join(STILLS, `${currentClip}-tablet-${t.toLowerCase()}.png`);
      await tablets[t].page.screenshot({ path: file });
      stills.push(path.relative(ROOT, file));
    }
    await pause(600); // hold the result for a beat
    clips.push({ n, slug, tablets: involved, windows: windowsOf(Date.now()), status: "pass", checks: currentChecks, stills });
    console.log(`  ✓ ${currentClip} passed (${currentChecks.length} checks)`);
  } catch (err) {
    for (const t of involved) {
      const file = path.join(STILLS, `${currentClip}-FAIL-tablet-${t.toLowerCase()}.png`);
      await tablets[t].page.screenshot({ path: file }).catch(() => undefined);
      stills.push(path.relative(ROOT, file));
    }
    const error = err instanceof Error ? err.message : String(err);
    clips.push({ n, slug, tablets: involved, windows: windowsOf(Date.now()), status: "fail", checks: currentChecks, stills, error });
    console.error(`  ✗ ${currentClip} failed: ${error}`);
    throw err;
  }
}

/** Setup between clips (not part of any clip); failures still stop the run. */
async function setup(name: string, fn: () => Promise<void>) {
  currentClip = `setup: ${name}`;
  currentChecks = [];
  console.log(`  · ${name}`);
  await fn();
}

// ---------- Human-like interaction helpers (same contract as record.ts) ----------

async function see(page: Page, text: string | RegExp, timeout = 15_000) {
  const loc = typeof text === "string" ? page.getByText(text, { exact: true }) : page.getByText(text);
  try {
    await loc.first().waitFor({ state: "visible", timeout });
  } catch {
    throw new Error(`Expected to see ${JSON.stringify(String(text))} on ${page.url()}`);
  }
  currentChecks.push(String(text));
}

async function seeValue(loc: Locator, expected: string, what: string) {
  const actual = await loc.inputValue();
  if (actual !== expected) throw new Error(`${what}: expected value ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  currentChecks.push(`${what} = ${expected}`);
}

async function seeChecked(loc: Locator, what: string) {
  const v = await loc.getAttribute("aria-checked");
  if (v !== "true") throw new Error(`${what}: expected aria-checked=true, got ${v}`);
  currentChecks.push(`${what} ✓`);
}

async function notSee(page: Page, text: string, what: string) {
  if (await page.getByText(text, { exact: true }).first().isVisible().catch(() => false)) {
    throw new Error(`${what}: did not expect ${JSON.stringify(text)} on ${page.url()}`);
  }
  currentChecks.push(`not shown: ${text}`);
}

async function tap(page: Page, loc: Locator) {
  const target = loc.first();
  await target.waitFor({ state: "visible", timeout: 15_000 });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
    await sleep(100);
  }
  await target.click();
}

async function typeInto(page: Page, loc: Locator, text: string) {
  await tap(page, loc);
  await loc.first().fill("");
  await loc.first().pressSequentially(text, { delay: TYPE_DELAY });
}

const pause = (ms = 800) => sleep(ms);

const act = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).or(page.getByRole("link", { name, exact: true }));

async function go(page: Page, to: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await pause(500);
}

/** Taps the menu link when it is visible, otherwise navigates in-app. */
async function navTo(page: Page, linkName: string, to: string) {
  const link = page.getByRole("link", { name: linkName, exact: true });
  if (await link.first().isVisible().catch(() => false)) await tap(page, link);
  else await go(page, to);
}

async function checkForbidden(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  if (text.includes("Tu rol no tiene permiso para esta acción.")) {
    softFailures.push(`${currentClip} · ${where}: unexpected "Tu rol no tiene permiso para esta acción." on screen`);
  }
  for (const re of FORBIDDEN) {
    const m = text.match(re);
    if (m) softFailures.push(`${currentClip} · ${where}: forbidden word on screen "${m[0]}"`);
  }
}

async function enterPin(page: Page, username: string, pin: string) {
  await typeInto(page, page.getByLabel("Usuario", { exact: true }), username);
  for (const digit of pin) {
    await tap(page, page.locator('div[aria-hidden="true"] button', { hasText: new RegExp(`^${digit}$`) }));
  }
  await tap(page, act(page, "Entrar"));
}

async function login(page: Page, username: string, pin: string) {
  await see(page, "Escribe tu usuario y tu PIN.");
  await enterPin(page, username, pin);
}

async function logout(page: Page) {
  await tap(page, act(page, "Salir"));
  await see(page, "Escribe tu usuario y tu PIN.");
}

async function nameTablet(page: Page, name: string) {
  const card = page.getByText("Ponle nombre a esta tableta", { exact: true });
  try {
    await card.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return;
  }
  await typeInto(page, page.getByLabel("Nombre de la tableta", { exact: true }), name);
  await tap(page, act(page, "Guardar nombre"));
  await card.waitFor({ state: "hidden", timeout: 10_000 });
}

async function downloadPackage(page: Page, campaignName: string) {
  const link = page.getByRole("link", { name: "Paquete de jornada", exact: true });
  if (await link.first().isVisible().catch(() => false)) await tap(page, link);
  else await go(page, "/campaigns");
  await see(page, "Descárgalo con señal antes de salir. Con él puedes buscar pacientes sin internet.");
  const chooser = page.getByText("¿Qué jornada vas a descargar?", { exact: true });
  if (await chooser.isVisible().catch(() => false)) {
    currentChecks.push("¿Qué jornada vas a descargar?");
    await pause(500);
    await tap(page, page.getByRole("button", { name: new RegExp(escapeRe(campaignName)) }));
    await see(page, "✓ Elegida");
  }
  await tap(page, page.getByRole("button", { name: /^Descargar paquete/ }));
  await see(page, "Listo. El paquete quedó guardado en esta tableta.", 30_000);
  await see(page, campaignName);
}

async function fillSearch(page: Page, p: { search: string; day: string; month: string; year: string; phone: string }) {
  await typeInto(page, page.getByLabel("Nombre completo", { exact: true }), p.search);
  await typeInto(page, page.getByLabel("Nacimiento: día", { exact: true }), p.day);
  await typeInto(page, page.getByLabel("Mes", { exact: true }), p.month);
  await typeInto(page, page.getByLabel("Año", { exact: true }), p.year);
  await tap(page, act(page, "Teléfono"));
  await typeInto(page, page.getByLabel("Teléfono o celular", { exact: true }), p.phone);
  await pause(300);
  await tap(page, act(page, "Buscar"));
}

async function readFolio(page: Page): Promise<string> {
  const loc = page.locator("p.text-5xl").first();
  await loc.waitFor({ state: "visible", timeout: 15_000 });
  const folio = (await loc.innerText()).trim();
  if (!/^[A-Z0-9]{2}-\d{3}-[A-Z]$/.test(folio)) throw new Error(`Folio has an unexpected shape: ${JSON.stringify(folio)}`);
  currentChecks.push(`Folio ${folio}`);
  return folio;
}

/** Waits for the top bar to report everything sent; taps "Enviar ahora" once if it lingers. */
async function waitAllSent(page: Page, timeout = 45_000) {
  const sent = page.getByText(/^Todo enviado · \d{2}:\d{2}$/);
  try {
    await sent.first().waitFor({ state: "visible", timeout });
  } catch {
    await tap(page, act(page, "Enviar ahora"));
    await sent.first().waitFor({ state: "visible", timeout });
  }
  currentChecks.push("Todo enviado · HH:MM");
}

/** Offline intake of Juana with a corrected mobile number (both tablets do this for the "same field" case). */
async function juanaWithNewMobile(page: Page, mobile: string) {
  await go(page, "/intake");
  await see(page, "Identifica a la paciente");
  await fillSearch(page, JUANA);
  await see(page, JUANA.shown);
  await tap(page, act(page, "Es ella"));
  await see(page, `Visita de hoy · ${JUANA.shown}`);
  const row = page.locator("li").filter({ has: page.getByText("Celular", { exact: true }) });
  await tap(page, row.getByRole("button", { name: "Corregir", exact: true }));
  await typeInto(page, row.locator("input"), mobile);
  await tap(page, row.getByRole("button", { name: "Listo", exact: true }));
  await see(page, "Corregido");
  await tap(page, page.getByRole("checkbox", { name: /Revisión mamaria/ }));
  await tap(page, act(page, "Guardar visita"));
  await see(page, "Guardado ✓");
}

// ---------- Main ----------

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(STILLS, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "huella-features-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${path.join(work, "demo.db")}`,
    UPLOADS_DIR: path.join(work, "uploads") + path.sep,
    PORT: String(SERVER_PORT),
    PREVIEW_PORT: String(PREVIEW_PORT),
    API_PROXY: `http://localhost:${SERVER_PORT}`,
    OCR_MODE: "mock",
    STORAGE_MODE: "local",
  };

  let demo: ChildProcess | null = null;
  let browser: Browser | null = null;
  let exitCode = 0;
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
  const campaignName = defaultCampaignName(MUNICIPALITY, isoLocal(today));

  try {
    console.log("• Fresh database in a throwaway copy:", work);
    const serverDir = path.join(ROOT, "apps/server");
    const sqlFile = path.join(work, "schema.sql");
    writeFileSync(
      sqlFile,
      run("npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { cwd: serverDir, env }),
    );
    run("npx", ["prisma", "db", "execute", "--url", env.DATABASE_URL!, "--file", sqlFile], { cwd: serverDir, env });
    const seedOut = run("npm", ["run", "seed"], { cwd: ROOT, env });
    console.log("  " + (seedOut.split("\n").find((l) => l.startsWith("Seed OK")) ?? "seed done"));

    console.log(`• Production build: server :${SERVER_PORT}, app :${PREVIEW_PORT} (log in demo-videos/features/raw/demo-server.log)`);
    const log = openSync(path.join(OUT, "demo-server.log"), "w");
    demo = spawn("npm", ["run", "demo"], { cwd: ROOT, env, detached: true, stdio: ["ignore", log, log] });
    await waitForHttp(`http://localhost:${SERVER_PORT}/`, 120_000);
    await waitForHttp(`${BASE}/`, 240_000);

    browser = await chromium.launch({ channel: "chrome", headless: true, slowMo: SLOW_MO });
    const videoDir = path.join(work, "video");
    for (const id of ["A", "B"] as const) {
      const ctx = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        locale: "es-MX",
        timezoneId: "America/Mexico_City",
        recordVideo: { dir: videoDir, size: VIEWPORT },
      });
      await ctx.addInitScript(CURSOR_SCRIPT);
      const page = await ctx.newPage();
      // Recording starts with the page; the window offsets are measured from here.
      const videoStart = Date.now();
      page.on("dialog", (d) => void d.accept());
      tablets[id] = { ctx, page, videoStart };
    }
    const A = tablets.A.page;
    const B = tablets.B.page;
    await Promise.all([A.goto(`${BASE}/login`), B.goto(`${BASE}/login`)]);

    let folio = "";

    // ----- Administración -----
    await setup("admin enters", async () => {
      await login(A, ADMIN.username, ADMIN.pin);
      await see(A, "Tablero de la jornada");
      await tap(A, A.getByRole("link", { name: "Personal", exact: true }));
      await see(A, "Quién puede entrar a la app y con qué rol.");
    });

    await clip(2, "personal", ["A"], async () => {
      const form = A.locator("form").filter({ has: A.getByText("PIN inicial", { exact: true }) });
      await typeInto(A, form.getByLabel("Nombre completo", { exact: true }), NEW_STAFF.name);
      await typeInto(A, form.getByLabel("Usuario", { exact: true }), NEW_STAFF.username);
      await tap(A, form.getByRole("button", { name: NEW_STAFF.role, exact: true }));
      await typeInto(A, form.getByLabel("PIN inicial", { exact: true }), NEW_STAFF.pin);
      await tap(A, form.getByRole("button", { name: "Dar de alta", exact: true }));
      await see(A, `Listo: ${NEW_STAFF.name} ya puede entrar.`);
      await see(A, `PIN inicial: ${NEW_STAFF.pin}`);
      await checkForbidden(A, "Personal");
      await pause(1200);
    });

    await clip(3, "crear-jornada", ["A"], async () => {
      await tap(A, A.getByRole("link", { name: "Jornadas", exact: true }));
      await see(A, "Nueva jornada");
      await typeInto(A, A.getByLabel("Municipio", { exact: true }), MUNICIPALITY);
      await typeInto(A, A.getByLabel("Estado", { exact: true }), STATE);
      for (const loc of CAMPAIGN_LOCALITIES) {
        await tap(A, A.getByRole("checkbox", { name: new RegExp(`^${escapeRe(loc)}`) }));
      }
      const start = A.getByRole("group", { name: "Fecha de inicio" });
      await typeInto(A, start.getByLabel("Día", { exact: true }), pad(today.getDate()));
      await typeInto(A, start.getByLabel("Mes", { exact: true }), pad(today.getMonth() + 1));
      await typeInto(A, start.getByLabel("Año", { exact: true }), String(today.getFullYear()));
      const end = A.getByRole("group", { name: "Fecha de fin" });
      await typeInto(A, end.getByLabel("Día", { exact: true }), pad(tomorrow.getDate()));
      await typeInto(A, end.getByLabel("Mes", { exact: true }), pad(tomorrow.getMonth() + 1));
      await typeInto(A, end.getByLabel("Año", { exact: true }), String(tomorrow.getFullYear()));
      await seeValue(A.getByLabel("Nombre de la jornada", { exact: true }), campaignName, "Nombre de la jornada (propuesto)");
      await pause(1000);
      await tap(A, act(A, "Crear jornada"));
      await see(A, "Listo: la jornada ya está creada. Las tabletas pueden descargar su paquete.");
      await see(A, campaignName);
      await checkForbidden(A, "Jornadas");
      await pause(1000);
    });

    // ----- Antes de la jornada -----
    await setup("field staff enter and tablet B downloads its package", async () => {
      await logout(A);
      await login(A, NEW_STAFF.username, NEW_STAFF.pin);
      await see(A, "Identifica a la paciente");
      await nameTablet(A, "Tableta de captura 1");
      await login(B, NUTRITION.username, NUTRITION.pin);
      await see(B, "Pacientes esperándome");
      await nameTablet(B, "Tableta de estaciones 2");
      await downloadPackage(B, campaignName);
    });

    await clip(4, "paquete-de-jornada", ["A"], async () => {
      await downloadPackage(A, campaignName);
      await checkForbidden(A, "paquete");
      await pause(1200);
    });

    await setup("service workers ready", async () => {
      for (const p of [A, B]) await p.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
      await go(A, "/intake");
      await go(B, "/queue");
      await see(A, "Identifica a la paciente");
      await see(B, "Pacientes esperándome");
    });

    await clip(1, "entrar-con-pin", ["A"], async () => {
      await logout(A);
      await pause(600);
      await tablets.A.ctx.setOffline(true);
      await see(A, "○ Sin señal");
      await see(A, "Sin señal: solo puede entrar quien ya entró antes en esta tableta.");
      await pause(1000);
      await enterPin(A, NEVER_HERE.username, NEVER_HERE.pin);
      await see(A, "Sin señal solo puede entrar quien ya entró antes en esta tableta. Busca señal para entrar por primera vez.");
      await pause(1500);
      await enterPin(A, NEW_STAFF.username, NEW_STAFF.pin);
      await see(A, "Identifica a la paciente");
      await checkForbidden(A, "entrar sin señal");
      await pause(1000);
    });

    // ----- Durante la jornada (sin señal) -----
    // An offline login has no session to send changes with, so tablet A enters again with signal first.
    await setup("tablet A enters again with signal, then both tablets lose signal", async () => {
      await tablets.A.ctx.setOffline(false);
      await see(A, "● Con señal");
      await logout(A);
      await login(A, NEW_STAFF.username, NEW_STAFF.pin);
      await see(A, "Identifica a la paciente");
      await tablets.A.ctx.setOffline(true);
      await see(A, "○ Sin señal");
      await tablets.B.ctx.setOffline(true);
      await see(B, "○ Sin señal");
    });

    await clip(5, "identificar-primero", ["A"], async () => {
      await fillSearch(A, LUCIA);
      await see(A, "¿Es alguna de ellas?");
      await see(A, LUCIA.shown);
      await see(A, "Coincidencia fuerte");
      await A.getByRole("list", { name: "Motivos de la coincidencia" }).waitFor({ state: "visible" });
      for (const reason of ["Misma fecha de nacimiento", "Nombre parecido", "Mismo teléfono"]) await see(A, reason);
      await pause(1500);
      await tap(A, act(A, "Es ella"));
      await see(A, `Visita de hoy · ${LUCIA.shown}`);
      await see(A, "Sus datos ya están llenos. Solo confirma o corrige lo que cambió.");
      await checkForbidden(A, "identificar");
      await pause(800);
    });

    await clip(7, "nueva-visita", ["A"], async () => {
      await see(A, "Escribe este folio en el formato:");
      folio = await readFolio(A);
      await A.getByText("Escribe este folio en el formato:", { exact: true }).scrollIntoViewIfNeeded();
      await pause(800);
      await tap(A, A.getByRole("checkbox", { name: /Revisión mamaria/ }));
      await seeChecked(A.getByRole("checkbox", { name: /^Nutrición/ }), "Pasará con Nutrición");
      await seeChecked(A.getByRole("checkbox", { name: /^Médico/ }), "Pasará con Médico");
      await pause(1000);
      await tap(A, act(A, "Guardar visita"));
      await see(A, "Guardado ✓");
      await see(A, `Folio ${folio}: escríbelo en el formato de la paciente.`);
      await checkForbidden(A, "visita");
      await pause(1200);
    });

    await clip(6, "registrar-paciente-nueva", ["A"], async () => {
      await go(A, "/intake");
      await see(A, "Identifica a la paciente");
      await fillSearch(A, NEW_PATIENT);
      await see(A, "No encontramos a nadie con esos datos");
      await pause(600);
      await tap(A, act(A, "No encontramos a nadie — registrar nueva"));
      await see(A, "Registrar paciente nueva");
      await typeInto(A, A.getByLabel("Nombre(s)", { exact: true }), NEW_PATIENT.givenNames);
      await typeInto(A, A.getByLabel("Apellido paterno", { exact: true }), NEW_PATIENT.paternalSurname);
      await typeInto(A, A.getByLabel("Apellido materno", { exact: true }), NEW_PATIENT.maternalSurname);
      const eiraId = buildEiraId({
        givenNames: NEW_PATIENT.givenNames,
        paternalSurname: NEW_PATIENT.paternalSurname,
        maternalSurname: NEW_PATIENT.maternalSurname,
        birthDate: `${NEW_PATIENT.year}-${NEW_PATIENT.month}-${NEW_PATIENT.day}`,
      });
      const idField = A.getByLabel(/^ID EIRA \(4\. ID\)/);
      await seeValue(idField, eiraId, "ID EIRA");
      await idField.scrollIntoViewIfNeeded();
      await see(A, "Lo calculamos con sus iniciales y fecha; corrígelo si el formato dice otro.");
      await pause(1500);
      await typeInto(A, A.getByLabel("Residencia habitual", { exact: true }), NEW_PATIENT.residence);
      await tap(A, act(A, "Registrar y seguir con la visita"));
      await see(A, `Visita de hoy · ${NEW_PATIENT.shown}`);
      await see(A, "Sus datos quedaron registrados. Elige los servicios de hoy.");
      await checkForbidden(A, "registrar");
      await pause(800);
    });

    await clip(9, "cambios-por-enviar", ["A"], async () => {
      await readFolio(A);
      await tap(A, A.getByRole("checkbox", { name: /Revisión mamaria/ }));
      await tap(A, A.getByRole("checkbox", { name: /Papanicolaou/ }));
      await seeChecked(A.getByRole("checkbox", { name: /^Patología/ }), "Pasará con Patología");
      await tap(A, act(A, "Guardar visita"));
      await see(A, "Guardado ✓");
      await see(A, "○ Sin señal");
      await see(A, /^\d+ cambios? por enviar$/);
      await A.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await checkForbidden(A, "cambios por enviar");
      await pause(2000);
    });

    await clip(10, "estacion-por-folio", ["A", "B"], async () => {
      await see(B, "Teclear folio");
      await typeInto(B, B.getByLabel("Folio", { exact: true }), folio);
      await tap(B, act(B, "Abrir visita"));
      await see(B, `Folio ${folio}`);
      await see(B, "Esta visita aún no llega a esta tableta. Puedes registrar tu paso; se unirá al enviar.");
      await see(B, "Tu paso: Nutrición. Llena solo tus campos; lo demás lo llenan las otras estaciones.");
      await typeInto(B, B.getByLabel(/^Nombre que confirma la paciente/), LUCIA.shown);
      await typeInto(B, B.getByLabel("Talla", { exact: true }), "158");
      await typeInto(B, B.getByLabel("Peso", { exact: true }), "62.5");
      await typeInto(B, B.getByLabel("PA", { exact: true }), "118/76");
      await tap(B, act(B, "Guardar y terminar"));
      await see(B, "Pacientes esperándome");
      await see(B, /^\d+ cambios? por enviar$/);
      await checkForbidden(B, "paso sin señal");
      await pause(800);
      // Signal returns: the station's step arrives first and waits for the visit.
      await tablets.B.ctx.setOffline(false);
      await see(B, "● Con señal");
      const WAITING = "1 paso esperando a que llegue la visita";
      await see(B, WAITING, 45_000);
      await pause(1200);
      await tablets.A.ctx.setOffline(false);
      await see(A, "● Con señal");
      await waitAllSent(A);
      const waiting = B.getByText(WAITING);
      try {
        await waiting.waitFor({ state: "hidden", timeout: 20_000 });
      } catch {
        await tap(B, act(B, "Enviar ahora"));
        await waiting.waitFor({ state: "hidden", timeout: 40_000 });
      }
      currentChecks.push("B: waiting step joined its visit");
      await waitAllSent(B, 30_000);
      await checkForbidden(A, "vuelve la señal");
      await checkForbidden(B, "vuelve la señal");
      await pause(1200);
    });

    // ----- Especialistas -----
    await setup("doctor enters on tablet B", async () => {
      await logout(B);
      await login(B, DOCTOR.username, DOCTOR.pin);
      await see(B, "Pacientes esperándome");
    });

    await clip(8, "pacientes-esperandome", ["B"], async () => {
      await see(B, LUCIA.shown, 30_000);
      await see(B, NEW_PATIENT.shown, 30_000);
      await pause(1200);
      const card = B.locator("li").filter({ hasText: LUCIA.shown });
      await tap(B, card.getByRole("link", { name: "Atender", exact: true }));
      await see(B, `Folio ${folio} · ${LUCIA.shown}`);
      await see(B, "Tu paso: Médico. Llena solo tus campos; lo demás lo llenan las otras estaciones.");
      await notSee(B, "Talla", "Doctor step shows nutrition fields");
      await typeInto(B, B.getByLabel(/^Nombre que confirma la paciente/), LUCIA.shown);
      await typeInto(B, B.getByLabel("11. Edad de presentación de la menarca (años)", { exact: true }), "12");
      await tap(B, B.getByRole("radio", { name: "1 · Mama normal", exact: true }));
      await tap(B, B.getByRole("radio", { name: "1 · Detección de rutina en un año", exact: true }));
      await pause(600);
      await tap(B, act(B, "Guardar y terminar"));
      await see(B, "Pacientes esperándome");
      await waitAllSent(B, 30_000);
      await checkForbidden(B, "paso del médico");
      await pause(800);
    });

    await setup("both tablets open the record search", async () => {
      await go(A, "/patients");
      await go(B, "/patients");
      await see(A, "Buscar expediente");
      await see(B, "Buscar expediente");
    });

    await clip(11, "expediente", ["A", "B"], async () => {
      await Promise.all([fillSearch(B, LUCIA), fillSearch(A, LUCIA)]);
      await Promise.all([tap(B, B.getByText("Ver expediente", { exact: true })), tap(A, A.getByText("Ver expediente", { exact: true }))]);
      for (const p of [A, B]) {
        await see(p, "Datos de identificación");
        await see(p, /2 visitas/);
        await see(p, "Historial de visitas");
      }
      // Clinical view (doctor, tablet B): results by station.
      await see(B, "Somatometría");
      await see(B, /BIRADS 1/);
      await see(B, "Conducta a seguir: Detección de rutina en un año");
      // Intake view (tablet A): no clinical results.
      await see(A, "Sin resultados clínicos en esta vista");
      await checkForbidden(A, "expediente captura");
      await checkForbidden(B, "expediente clínico");
      await pause(600);
      await Promise.all([A.mouse.wheel(0, 450), B.mouse.wheel(0, 450)]);
      await pause(2200);
    });

    // ----- Revisión: the same field changed on two tablets without signal (setup) -----
    await setup("two intake tablets change Juana's mobile without signal", async () => {
      await logout(B);
      await login(B, INTAKE_2.username, INTAKE_2.pin);
      await see(B, "Identifica a la paciente");
      await downloadPackage(B, campaignName);
      await B.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
      await go(A, "/intake");
      await go(B, "/intake");
      await tablets.A.ctx.setOffline(true);
      await tablets.B.ctx.setOffline(true);
      await juanaWithNewMobile(A, "55-0000-0092");
      await juanaWithNewMobile(B, "55-0000-0093");
      await tablets.A.ctx.setOffline(false);
      await waitAllSent(A);
      await tablets.B.ctx.setOffline(false);
      await see(B, "● Con señal");
      await pause(8000); // B's correction is held for review; no assertion on where the notice shows
    });

    // ----- Digitalización (tablet B, intake with signal) -----
    await clip(12, "foto-del-formato", ["B"], async () => {
      await go(B, "/intake");
      await see(B, "Identifica a la paciente");
      await tap(B, act(B, "Identificar con foto"));
      await see(B, "Toma la foto del formato completo, derecho y con buena luz.");
      const chooser = B.waitForEvent("filechooser");
      await tap(B, B.getByText("Tomar foto del formato", { exact: true }));
      await (await chooser).setFiles(path.join(FORMATS, "formato-03.svg"));
      await see(B, "Confirma los datos de identificación", 30_000);
      await see(B, "Compáralos con la foto. Nada se guarda sin tu confirmación.");
      await see(B, "1 dato con letra poco clara. Revísalo con la foto.");
      await see(B, "Revisa este dato");
      await B.getByText("Revisa este dato", { exact: true }).first().scrollIntoViewIfNeeded();
      await checkForbidden(B, "foto");
      await pause(2200);
      await tap(B, act(B, "Confirmar y buscar"));
      // The confirmed values go straight into the search.
      await see(B, "No encontramos a nadie con esos datos");
      await see(B, /^Buscaste: Patricia Luna Herrera · 09\/02\/1975/);
      await pause(1500);
    });

    await clip(13, "importar-excel", ["B"], async () => {
      await go(B, "/intake");
      await navTo(B, "Importar desde Excel", "/intake/import");
      await see(B, "Importar desde Excel");
      await see(B, "Sube la lista de pacientes de una brigada. Nada se guarda solo: revisas cada renglón antes de registrarla.");
      const chooser = B.waitForEvent("filechooser");
      await tap(B, B.getByText("Elegir archivo", { exact: true }));
      await (await chooser).setFiles(EXCEL);
      await see(B, "Revisa el archivo plantilla-llena.xlsx", 30_000);
      await see(B, "Nuevas (3)");
      await see(B, "¿Es alguna de ellas? (1)");
      await see(B, "Con datos por corregir (1)");
      await pause(1500);
      await tap(B, act(B, "Registrar todas las nuevas (3)"));
      await tap(B, act(B, "Sí, registrar las 3"));
      await see(B, /3 registradas/);
      await tap(B, B.locator("li").filter({ hasText: "Juana" }).getByRole("button", { name: "Es ella", exact: true }));
      await see(B, "Agregada a su expediente ✓");
      await tap(B, B.locator("li").filter({ hasText: "Carmen Ruelas" }).getByRole("button", { name: "Descartar", exact: true }));
      await see(B, "Revisaste todo el archivo ✓");
      await B.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await checkForbidden(B, "Excel");
      await pause(1800);
    });

    // ----- Revisión y bitácora (tablet A, administración) -----
    await setup("admin enters on tablet A", async () => {
      await logout(A);
      await login(A, ADMIN.username, ADMIN.pin);
      await see(A, "Tablero de la jornada");
    });

    await clip(15, "mismo-dato", ["A"], async () => {
      await navTo(A, "Dos personas cambiaron el mismo dato", "/admin/conflicts");
      await see(A, "Mientras no había señal, dos personas escribieron un valor distinto en el mismo dato. Elige cuál se queda.");
      await see(A, `Paciente: ${JUANA.shown}`);
      await see(A, "Lo que ya estaba guardado");
      await see(A, `Lo que capturó ${INTAKE_2.name} sin señal`);
      await see(A, "55-0000-0092");
      await see(A, "55-0000-0093");
      await checkForbidden(A, "mismo dato");
      await pause(2000);
      await tap(A, act(A, "Usar lo nuevo"));
      await see(A, "No hay datos por revisar. ✓", 20_000);
      await pause(1200);
    });

    await clip(14, "misma-persona", ["A"], async () => {
      await navTo(A, "¿Es la misma persona?", "/admin/matches");
      await see(A, "Dos registros se parecen. Revisa sus datos y decide. Nada se borra: unir conserva los dos registros.");
      const card = A.locator("div").filter({ hasText: ANA_PAIR }).filter({ has: A.getByRole("button", { name: "Es la misma: vincular" }) }).last();
      await see(A, "Por qué se parecen:");
      await see(A, "Los datos resaltados son distintos entre los dos registros.");
      await checkForbidden(A, "misma persona");
      await pause(2200);
      await tap(A, card.getByRole("button", { name: "Es la misma: vincular", exact: true }));
      await see(A, "Listo: quedaron unidos. Su historial ya se ve junto.");
      await pause(1500);
    });

    await clip(16, "bitacora-y-tablero", ["A"], async () => {
      await navTo(A, "Tablero", "/admin");
      await see(A, "Tablero de la jornada");
      await checkForbidden(A, "tablero");
      await pause(2500);
      await tap(A, A.getByRole("link", { name: "Bitácora", exact: true }));
      await see(A, "Busca a la paciente para ver todo lo que pasó con su expediente.");
      await fillSearch(A, LUCIA);
      await tap(A, A.getByRole("button", { name: "Bitácora", exact: true }));
      await see(A, `Bitácora de ${LUCIA.shown}`);
      for (const sentence of [
        `${NEW_STAFF.name} reconoció que ya había venido antes`,
        `${NEW_STAFF.name} registró la visita ${folio}`,
        `${NUTRITION.name} terminó Nutrición en la visita ${folio}`,
        `${DOCTOR.name} terminó Médico en la visita ${folio}`,
      ]) {
        await see(A, new RegExp(`^${escapeRe(sentence)} · \\d{1,2} [a-z]{3} \\d{2}:\\d{2}$`));
      }
      await checkForbidden(A, "bitácora");
      await A.mouse.wheel(0, 400);
      await pause(2200);
    });
  } catch (err) {
    exitCode = 1;
    console.error("\n✗ Recording stopped:", err instanceof Error ? err.message : err);
  } finally {
    const videos: Record<string, string> = {};
    for (const id of ["A", "B"] as const) {
      const t = tablets[id];
      if (!t) continue;
      const video = t.page.video();
      await t.ctx.close().catch(() => undefined);
      if (video) {
        const file = path.join(OUT, `tablet-${id.toLowerCase()}.webm`);
        await video.saveAs(file).catch((e) => console.error("video save failed", e));
        await video.delete().catch(() => undefined);
        videos[id] = path.relative(ROOT, file);
      }
    }
    await browser?.close().catch(() => undefined);
    if (demo?.pid) {
      try {
        process.kill(-demo.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    if (softFailures.length > 0) exitCode = 1;
    writeFileSync(
      path.join(OUT, "clips.json"),
      JSON.stringify({ recordedAt: new Date().toISOString(), viewport: VIEWPORT, videos, clips: clips.sort((a, b) => a.n - b.n), softFailures }, null, 2),
    );
    rmSync(work, { recursive: true, force: true });
    console.log("\n• Clips:");
    for (const c of clips) {
      const w = Object.entries(c.windows).map(([t, [s, e]]) => `${t} ${s}–${e} s`).join(", ");
      console.log(`  ${c.status === "pass" ? "✓" : "✗"} ${pad(c.n)}-${c.slug} [${w}]`);
    }
    for (const f of softFailures) console.log(`  ! ${f}`);
    process.exit(exitCode);
  }
}

void main();
