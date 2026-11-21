// Records the full Huella Rosa flow on the production build with two "tablets" (browser contexts).
// It is both raw demo footage and an end-to-end test: every scene asserts the exact Spanish text
// on screen and the script exits non-zero on the first mismatch.
//
// Run: npm run demo:record  (needs Valkey on localhost:6379: `docker compose up -d`).
// Output: demo-videos/raw/{tablet-a.webm, tablet-b.webm, timeline.json, stills/*.png}
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
const OUT = path.join(ROOT, "demo-videos", "raw");
const STILLS = path.join(OUT, "stills");
const SERVER_PORT = 4301;
const PREVIEW_PORT = 4302;
const BASE = `http://localhost:${PREVIEW_PORT}`;
const VIEWPORT = { width: 1280, height: 800 };
const SLOW_MO = 120;
const TYPE_DELAY = 40;
const STAFF_PIN = "2580";
const BRAND = "#b7426c"; // Frambuesa

const ADMIN = { username: "smendez", pin: "1234" };
const STAFF = [
  { name: "Ana Hernández Ruiz", username: "ahernandez", role: "Captura" },
  { name: "Martha Campos Lara", username: "mcampos", role: "Nutrición" },
  { name: "Dr. Ricardo Gómez Peña", username: "rgomez", role: "Médico" },
  { name: "Dra. Elena Ríos Vidal", username: "erios", role: "Patología" },
] as const;
const [INTAKE, NUTRITION, DOCTOR] = STAFF;

const MUNICIPALITY = "San Ejemplo de la Sierra";
const STATE = "Estado Ficticio";
const CAMPAIGN_LOCALITIES = ["San Ejemplo de la Sierra", "Rancho Prueba del Monte"];

const LUCIA = { search: "Lucia Ramirez Torres", shown: "Lucía Ramírez Torres", day: "05", month: "01", year: "1990", phone: "55-0000-0003" };
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

/** Duration of a webm in seconds (ffprobe first; ffmpeg decode as fallback when the header has none). */
function videoDuration(file: string): number | null {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const d = Number.parseFloat(probe.stdout?.trim() ?? "");
  if (Number.isFinite(d)) return Math.round(d * 10) / 10;
  const dec = spawnSync("ffmpeg", ["-i", file, "-f", "null", "-"], { encoding: "utf8" });
  const times = [...(dec.stderr ?? "").matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  const last = times.at(-1);
  if (!last) return null;
  return Math.round((Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])) * 10) / 10;
}

// ---------- Visible cursor (init script) ----------

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

// ---------- Scene bookkeeping ----------

type TabletId = "A" | "B";
interface SceneRecord {
  scene: string;
  title: string;
  tablet: string;
  startMs: number;
  endMs: number;
  status: "pass" | "fail";
  checks: string[];
  stills: string[];
  error?: string;
}

const timeline: SceneRecord[] = [];
const softFailures: string[] = [];
let t0 = 0;
let currentChecks: string[] = [];
let currentScene = "setup";

const tablets: Record<TabletId, { ctx: BrowserContext; page: Page }> = {} as never;

async function scene(id: string, title: string, involved: TabletId[], fn: () => Promise<void>) {
  currentScene = id;
  currentChecks = [];
  const startMs = Date.now() - t0;
  console.log(`\n▶ ${id} · ${title}`);
  const stills: string[] = [];
  try {
    await fn();
    for (const t of involved) {
      const file = path.join(STILLS, `${id}-tablet-${t.toLowerCase()}.png`);
      await tablets[t].page.screenshot({ path: file });
      stills.push(path.relative(ROOT, file));
    }
    timeline.push({ scene: id, title, tablet: involved.join("+"), startMs, endMs: Date.now() - t0, status: "pass", checks: currentChecks, stills });
    console.log(`  ✓ ${id} passed (${currentChecks.length} checks)`);
  } catch (err) {
    for (const t of involved) {
      const file = path.join(STILLS, `${id}-FAIL-tablet-${t.toLowerCase()}.png`);
      await tablets[t].page.screenshot({ path: file }).catch(() => undefined);
      stills.push(path.relative(ROOT, file));
    }
    const error = err instanceof Error ? err.message : String(err);
    timeline.push({ scene: id, title, tablet: involved.join("+"), startMs, endMs: Date.now() - t0, status: "fail", checks: currentChecks, stills, error });
    console.error(`  ✗ ${id} failed: ${error}`);
    throw err;
  }
}

// ---------- Human-like interaction helpers ----------

/** Waits until the exact text is visible, and records it as an asserted check of the current scene. */
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

/** Moves the mouse to the element in small steps (visible in the video), then clicks it. */
async function tap(page: Page, loc: Locator) {
  const target = loc.first();
  await target.waitFor({ state: "visible", timeout: 15_000 });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await sleep(120);
  }
  await target.click();
}

/** Clicks the field and types visibly, replacing what was there. */
async function typeInto(page: Page, loc: Locator, text: string) {
  await tap(page, loc);
  await loc.first().fill("");
  await loc.first().pressSequentially(text, { delay: TYPE_DELAY });
}

const pause = (ms = 900) => sleep(ms);

/** A control by its visible name, whether the app renders it as a button or as a link styled as one. */
const act = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).or(page.getByRole("link", { name, exact: true }));

/** In-app navigation without reloading (works the same with or without signal). */
async function go(page: Page, to: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await pause(500);
}

async function checkForbidden(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  if (text.includes("Tu rol no tiene permiso para esta acción.")) {
    softFailures.push(`${currentScene} · ${where}: unexpected "Tu rol no tiene permiso para esta acción." on screen`);
  }
  for (const re of FORBIDDEN) {
    const m = text.match(re);
    if (m) softFailures.push(`${currentScene} · ${where}: forbidden word on screen "${m[0]}"`);
  }
}

async function login(page: Page, username: string, pin: string) {
  await see(page, "Escribe tu usuario y tu PIN.");
  await typeInto(page, page.getByLabel("Usuario", { exact: true }), username);
  for (const digit of pin) {
    await tap(page, page.locator('div[aria-hidden="true"] button', { hasText: new RegExp(`^${digit}$`) }));
  }
  await tap(page, act(page, "Entrar"));
}

async function logout(page: Page) {
  await tap(page, act(page, "Salir"));
  await see(page, "Escribe tu usuario y tu PIN.");
}

/** Names the tablet when the app asks (shown once per device for field staff). */
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
  currentChecks.push(`Tablet named "${name}"`);
}

async function downloadPackage(page: Page, campaignName: string) {
  const link = page.getByRole("link", { name: "Paquete de jornada", exact: true });
  if (await link.first().isVisible().catch(() => false)) await tap(page, link);
  else await go(page, "/campaigns");
  await see(page, "Descárgalo con señal antes de salir. Con él puedes buscar pacientes sin internet.");
  const chooser = page.getByText("¿Qué jornada vas a descargar?", { exact: true });
  if (await chooser.isVisible().catch(() => false)) {
    currentChecks.push("¿Qué jornada vas a descargar?");
    await tap(page, page.getByRole("button", { name: new RegExp(escapeRe(campaignName)) }));
    await see(page, "✓ Elegida");
  }
  await tap(page, page.getByRole("button", { name: /^Descargar paquete/ }));
  await see(page, "Listo. El paquete quedó guardado en esta tableta.", 30_000);
  await see(page, campaignName);
  await pause();
}

async function fillSearch(page: Page, p: { search: string; day: string; month: string; year: string; phone: string }) {
  await typeInto(page, page.getByLabel("Nombre completo", { exact: true }), p.search);
  await typeInto(page, page.getByLabel("Nacimiento: día", { exact: true }), p.day);
  await typeInto(page, page.getByLabel("Mes", { exact: true }), p.month);
  await typeInto(page, page.getByLabel("Año", { exact: true }), p.year);
  await tap(page, act(page, "Teléfono"));
  await typeInto(page, page.getByLabel("Teléfono o celular", { exact: true }), p.phone);
  await pause(500);
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

// ---------- Main ----------

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(STILLS, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "huella-demo-"));
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
    // schema.prisma hardcodes file:./dev.db, so `migrate deploy` would touch the developer's database.
    // Build the schema SQL and run it against the throwaway file instead.
    const serverDir = path.join(ROOT, "apps/server");
    const sqlFile = path.join(work, "schema.sql");
    writeFileSync(
      sqlFile,
      run("npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { cwd: serverDir, env }),
    );
    run("npx", ["prisma", "db", "execute", "--url", env.DATABASE_URL!, "--file", sqlFile], { cwd: serverDir, env });
    const seedOut = run("npm", ["run", "seed"], { cwd: ROOT, env });
    console.log("  " + (seedOut.split("\n").find((l) => l.startsWith("Seed OK")) ?? "seed done"));

    console.log(`• Production build: server :${SERVER_PORT}, app :${PREVIEW_PORT} (log in demo-videos/raw/demo-server.log)`);
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
      page.on("dialog", (d) => void d.accept());
      tablets[id] = { ctx, page };
    }
    t0 = Date.now();
    const A = tablets.A.page;
    const B = tablets.B.page;
    await Promise.all([A.goto(`${BASE}/login`), B.goto(`${BASE}/login`)]);

    let folio = "";
    let newFolio = "";

    await scene("S1", "Administración: personal y jornada", ["A"], async () => {
      await login(A, ADMIN.username, ADMIN.pin);
      await see(A, "Tablero de la jornada");
      await pause(2500);
      await checkForbidden(A, "tablero");
      await pause();
      await tap(A, A.getByRole("link", { name: "Personal", exact: true }));
      await see(A, "Quién puede entrar a la app y con qué rol.");
      const form = A.locator("form").filter({ has: A.getByText("PIN inicial", { exact: true }) });
      for (const person of STAFF) {
        await typeInto(A, form.getByLabel("Nombre completo", { exact: true }), person.name);
        await typeInto(A, form.getByLabel("Usuario", { exact: true }), person.username);
        await tap(A, form.getByRole("button", { name: person.role, exact: true }));
        await typeInto(A, form.getByLabel("PIN inicial", { exact: true }), STAFF_PIN);
        await tap(A, form.getByRole("button", { name: "Dar de alta", exact: true }));
        await see(A, `Listo: ${person.name} ya puede entrar.`);
        await see(A, `PIN inicial: ${STAFF_PIN}`);
        await pause(700);
      }
      await checkForbidden(A, "Personal");

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
      await pause(1200);
      await tap(A, act(A, "Crear jornada"));
      await see(A, "Listo: la jornada ya está creada. Las tabletas pueden descargar su paquete.");
      await see(A, campaignName);
      await checkForbidden(A, "Jornadas");
      await pause(1500);
      await logout(A);
    });

    await scene("S2", "Antes de la jornada: entrar y descargar el paquete", ["A", "B"], async () => {
      await login(A, INTAKE.username, STAFF_PIN);
      await see(A, "Identifica a la paciente");
      await nameTablet(A, "Tableta de captura 1");
      await downloadPackage(A, campaignName);

      await login(B, NUTRITION.username, STAFF_PIN);
      await see(B, "Pacientes esperándome");
      await nameTablet(B, "Tableta de estaciones 2");
      await downloadPackage(B, campaignName);

      // The service worker must control both pages before the signal goes away.
      for (const p of [A, B]) await p.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
      await go(A, "/intake");
      await go(B, "/queue");
      await see(A, "Identifica a la paciente");
      await see(B, "Pacientes esperándome");
      await pause();
    });

    await scene("S3", "Sin señal: paciente recurrente y paciente nueva", ["A", "B"], async () => {
      await tablets.A.ctx.setOffline(true);
      await tablets.B.ctx.setOffline(true);
      await see(A, "○ Sin señal");
      await see(B, "○ Sin señal");
      await see(A, "Funciona sin señal");
      await pause();

      // Recurring patient: strong match with reasons, confirmed by a person.
      await fillSearch(A, LUCIA);
      await see(A, "¿Es alguna de ellas?");
      await see(A, LUCIA.shown);
      await see(A, "Coincidencia fuerte");
      // The reasons list is labelled for screen readers only; the chips are the visible part.
      await A.getByRole("list", { name: "Motivos de la coincidencia" }).waitFor({ state: "visible" });
      currentChecks.push("list[aria-label=Motivos de la coincidencia]");
      for (const reason of ["Misma fecha de nacimiento", "Nombre parecido", "Mismo teléfono"]) await see(A, reason);
      await pause(1500);
      await tap(A, act(A, "Es ella"));
      await see(A, `Visita de hoy · ${LUCIA.shown}`);
      await see(A, "Sus datos ya están llenos. Solo confirma o corrige lo que cambió.");
      await see(A, "Escribe este folio en el formato:");
      folio = await readFolio(A);
      await tap(A, A.getByRole("checkbox", { name: /Revisión mamaria/ }));
      await seeChecked(A.getByRole("checkbox", { name: /^Nutrición/ }), "Pasará con Nutrición");
      await seeChecked(A.getByRole("checkbox", { name: /^Médico/ }), "Pasará con Médico");
      await pause();
      await tap(A, act(A, "Guardar visita"));
      await see(A, "Guardado ✓");
      await see(A, `Folio ${folio}: escríbelo en el formato de la paciente.`);
      await checkForbidden(A, "visita de Lucía");
      await pause(1500);

      // New patient: registered by name parts; the EIRA ID is computed live.
      await go(A, "/intake");
      await see(A, "Identifica a la paciente");
      await fillSearch(A, NEW_PATIENT);
      await see(A, "No encontramos a nadie con esos datos");
      await pause();
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
      await seeValue(A.getByLabel(/^ID EIRA \(4\. ID\)/), eiraId, "ID EIRA");
      await see(A, "Lo calculamos con sus iniciales y fecha; corrígelo si el formato dice otro.");
      await typeInto(A, A.getByLabel("Residencia habitual", { exact: true }), NEW_PATIENT.residence);
      await pause(1200);
      await tap(A, act(A, "Registrar y seguir con la visita"));
      await see(A, `Visita de hoy · ${NEW_PATIENT.shown}`);
      await see(A, "Sus datos quedaron registrados. Elige los servicios de hoy.");
      newFolio = await readFolio(A);
      await tap(A, A.getByRole("checkbox", { name: /Revisión mamaria/ }));
      await tap(A, A.getByRole("checkbox", { name: /Papanicolaou/ }));
      await seeChecked(A.getByRole("checkbox", { name: /^Nutrición/ }), "Pasará con Nutrición");
      await seeChecked(A.getByRole("checkbox", { name: /^Médico/ }), "Pasará con Médico");
      await seeChecked(A.getByRole("checkbox", { name: /^Patología/ }), "Pasará con Patología");
      await pause();
      await tap(A, act(A, "Guardar visita"));
      await see(A, "Guardado ✓");
      await see(A, `Folio ${newFolio}: escríbelo en el formato de la paciente.`);
      await see(A, /^\d+ cambios? por enviar$/);
      await checkForbidden(A, "visita nueva");
      await pause(1500);
    });

    await scene("S4", "Estación por folio sin señal", ["B"], async () => {
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
      await pause();
      await tap(B, act(B, "Guardar y terminar"));
      await see(B, "Pacientes esperándome");
      await see(B, /^\d+ cambios? por enviar$/);
      await checkForbidden(B, "paso sin señal");
      await pause(1500);
    });

    await scene("S5", "Vuelve la señal", ["A", "B"], async () => {
      await tablets.B.ctx.setOffline(false);
      await see(B, "● Con señal");
      // The station's step reaches the server before the visit: it waits, it is not lost.
      // A saved step is two changes (its fields and "done"), so the bar may count 2.
      const WAITING = /^\d+ pasos? esperando a que llegue la visita$/;
      await see(B, WAITING, 45_000);
      await see(B, "Pasos que necesitan atención");
      await pause(2000);
      await tablets.A.ctx.setOffline(false);
      await see(A, "● Con señal");
      await see(A, /^Todo enviado · \d{2}:\d{2}$/, 45_000);
      const waiting = B.getByText(WAITING);
      try {
        await waiting.waitFor({ state: "hidden", timeout: 20_000 });
      } catch {
        await tap(B, act(B, "Enviar ahora"));
        await waiting.waitFor({ state: "hidden", timeout: 40_000 });
      }
      currentChecks.push("B: 'N pasos esperando a que llegue la visita' disappeared");
      await see(B, /^Todo enviado · \d{2}:\d{2}$/, 30_000);
      await checkForbidden(A, "vuelve la señal");
      await checkForbidden(B, "vuelve la señal");
      await pause(1500);
    });

    await scene("S6", "Médico con señal: BIRADS y expediente", ["B"], async () => {
      await logout(B);
      await login(B, DOCTOR.username, STAFF_PIN);
      await see(B, "Pacientes esperándome");
      await see(B, LUCIA.shown, 30_000);
      await see(B, NEW_PATIENT.shown, 30_000);
      await pause(1200);
      const card = B.locator("li").filter({ hasText: LUCIA.shown });
      await tap(B, card.getByRole("link", { name: "Atender", exact: true }));
      await see(B, `Folio ${folio} · ${LUCIA.shown}`);
      await see(B, "Tu paso: Médico. Llena solo tus campos; lo demás lo llenan las otras estaciones.");
      await typeInto(B, B.getByLabel(/^Nombre que confirma la paciente/), LUCIA.shown);
      // One field besides BIRADS/Conducta so the record shows the doctor's "Consulta" group.
      await typeInto(B, B.getByLabel("11. Edad de presentación de la menarca (años)", { exact: true }), "12");
      await tap(B, B.getByRole("radio", { name: "1 · Mama normal", exact: true }));
      await tap(B, B.getByRole("radio", { name: "1 · Detección de rutina en un año", exact: true }));
      await pause();
      await tap(B, act(B, "Guardar y terminar"));
      await see(B, "Pacientes esperándome");
      await see(B, /^Todo enviado · \d{2}:\d{2}$/, 30_000);

      await go(B, "/patients");
      await see(B, "Buscar expediente");
      await fillSearch(B, LUCIA);
      await tap(B, B.getByText("Ver expediente", { exact: true }));
      await see(B, "Datos de identificación");
      await see(B, /2 visitas/);
      await see(B, "Historial de visitas");
      await see(B, new RegExp(`Folio ${escapeRe(folio)}`));
      await see(B, /Jornada mayo 2026/);
      await see(B, "Somatometría");
      await see(B, "Consulta");
      await see(B, /BIRADS 1/);
      await see(B, "Conducta a seguir: Detección de rutina en un año");
      await checkForbidden(B, "expediente");
      await B.mouse.wheel(0, 500);
      await pause(2500);
    });

    await scene("S7", "Bitácora de la paciente", ["A"], async () => {
      await logout(A);
      await login(A, ADMIN.username, ADMIN.pin);
      await see(A, "Tablero de la jornada");
      await pause(2500);
      await checkForbidden(A, "tablero");
      await tap(A, A.getByRole("link", { name: "Bitácora", exact: true }));
      await see(A, "Busca a la paciente para ver todo lo que pasó con su expediente.");
      await fillSearch(A, LUCIA);
      await tap(A, A.getByRole("button", { name: "Bitácora", exact: true }));
      await see(A, `Bitácora de ${LUCIA.shown}`);
      for (const sentence of [
        `${INTAKE.name} reconoció que ya había venido antes`,
        `${INTAKE.name} registró la visita ${folio}`,
        `${NUTRITION.name} terminó Nutrición en la visita ${folio}`,
        `${DOCTOR.name} terminó Médico en la visita ${folio}`,
      ]) {
        // Each line reads "<sentence> · <day month time>".
        await see(A, new RegExp(`^${escapeRe(sentence)} · \\d{1,2} [a-z]{3} \\d{2}:\\d{2}$`));
      }
      await see(A, /Tableta de captura 1/);
      await checkForbidden(A, "bitácora");
      await A.mouse.wheel(0, 400);
      await pause(2500);
    });
  } catch (err) {
    exitCode = 1;
    console.error("\n✗ Recording stopped:", err instanceof Error ? err.message : err);
  } finally {
    const videos: Record<string, { file: string; seconds: number | null }> = {};
    for (const id of ["A", "B"] as const) {
      const t = tablets[id];
      if (!t) continue;
      const video = t.page.video();
      await t.ctx.close().catch(() => undefined);
      if (video) {
        const file = path.join(OUT, `tablet-${id.toLowerCase()}.webm`);
        await video.saveAs(file).catch((e) => console.error("video save failed", e));
        await video.delete().catch(() => undefined);
        videos[id] = { file: path.relative(ROOT, file), seconds: videoDuration(file) };
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
      path.join(OUT, "timeline.json"),
      JSON.stringify({ recordedAt: new Date().toISOString(), viewport: VIEWPORT, videos, scenes: timeline, softFailures }, null, 2),
    );
    rmSync(work, { recursive: true, force: true });
    console.log("\n• Timeline:");
    for (const s of timeline) console.log(`  ${s.status === "pass" ? "✓" : "✗"} ${s.scene} [${s.tablet}] ${s.startMs}–${s.endMs} ms · ${s.title}`);
    for (const f of softFailures) console.log(`  ! ${f}`);
    for (const [id, v] of Object.entries(videos)) console.log(`  video ${id}: ${v.file} (${v.seconds ?? "?"} s)`);
    process.exit(exitCode);
  }
}

void main();
