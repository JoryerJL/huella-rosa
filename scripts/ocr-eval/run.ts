// OCR accuracy and detection evaluation against a running Huella Rosa server (local or production).
//
// For each image in $OCR_TEST_DIR/images, it uploads the photo as intake (POST /api/scans), compares
// the proposed identification fields with $OCR_TEST_DIR/expected.json, and runs the same search the
// app runs after confirming (GET /api/patients/search with fullName + birthDate + phone, else formId,
// else birthState; see draftFromScan in apps/web/src/pages/ScanIdentifyPage.tsx).
//
// Usage (Node 24 runs this file directly, types are stripped):
//   OCR_TEST_DIR=/path/to/ocr-test HR_BASE_URL=https://example.org \
//   HR_USERNAME=<intake user> HR_PIN=<pin> node scripts/ocr-eval/run.ts
//
// Images and expected values are fictitious and must stay outside the repo. Every upload with
// OCR_MODE=textract is a billed Textract page. Results are written to $OCR_TEST_DIR/results-<ts>.json.
//
// Optional:
//   OCR_ONLY=img-01,img-03        only these images
//   OCR_REPLAY=<results.json>     reuse the readings of a previous run: no upload, no Textract cost
//   OCR_TYPED_BIRTHDATE=1         when the birth date was not read, search with the expected one,
//                                 as the person would type it on the confirmation screen
//   OCR_EXPECT_EXISTING=img-01,.. images whose patient already exists (default: 01,02,03,06,07,08)

import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const FIELDS = ["fullName", "birthDate", "birthState", "formId", "mobile", "residence"] as const;
type Field = (typeof FIELDS)[number];
type Expected = Record<Field, string | null>;
type ScanField = { value: string; confidence: number };
type Candidate = {
  patient: { fullName: string; birthDate: string; formId: string | null };
  score: number;
  strength: string;
  reasons: string[];
};

const LOW_CONFIDENCE = 0.8; // Same threshold as LOW_CONFIDENCE in packages/shared/src/api.ts.
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const normText = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "");

/** "1990-01-05", "05/01/1990", "5-1-1990", "05011990" -> "1990-01-05"; null when not a date. */
export function toIso(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[/.\- ](\d{1,2})[/.\- ](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  const d = digits(s);
  if (d.length === 8 && s.replace(/[\d\s/.\-]/g, "") === "") return `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  return null;
}

/** Normalized form used to compare a read value with the expected one. */
export function normalize(field: Field, raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  switch (field) {
    case "birthDate":
      return toIso(s) ?? `?${normText(s)}`;
    case "mobile":
      return digits(s);
    case "formId":
      return stripAccents(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
    default:
      return normText(s);
  }
}

async function login(base: string, username: string, pin: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": "ocr-eval" },
    body: JSON.stringify({ username, pin }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (cookies.length === 0) throw new Error("Login returned no session cookie");
  return cookies.join("; ");
}

async function upload(base: string, cookie: string, path: string, name: string): Promise<Record<string, ScanField>> {
  const type = MIME[extname(name).toLowerCase()];
  if (!type) throw new Error(`Unsupported image type: ${name}`);
  const form = new FormData();
  form.append("image", new Blob([await readFile(path)], { type }), name);
  const res = await fetch(`${base}/api/scans`, { method: "POST", headers: { cookie, "x-device-id": "ocr-eval" }, body: form });
  const body = (await res.json()) as { status?: string; fields?: Record<string, ScanField>; error?: string };
  if (!res.ok) throw new Error(`Upload ${name} failed: ${res.status} ${body.error ?? ""}`);
  if (body.status !== "READ") throw new Error(`Upload ${name}: reading status ${body.status}`);
  return body.fields ?? {};
}

/** Same query the app builds from confirmed scan values (draftFromScan). */
function searchQuery(read: Record<string, ScanField>): { params: Record<string, string>; extraKind: string } | null {
  const v = (k: string) => read[k]?.value?.trim() ?? "";
  const birthDate = toIso(v("birthDate"));
  if (!v("fullName") || !birthDate) return null;
  const params: Record<string, string> = { fullName: v("fullName"), birthDate };
  const phone = v("mobile") || v("phone");
  if (phone) {
    params.phone = phone;
    return { params, extraKind: "phone" };
  }
  if (v("formId")) {
    params.formId = v("formId");
    return { params, extraKind: "formId" };
  }
  if (v("birthState")) params.birthState = v("birthState");
  return { params, extraKind: "birthState" };
}

async function search(base: string, cookie: string, params: Record<string, string>): Promise<Candidate[]> {
  const res = await fetch(`${base}/api/patients/search?${new URLSearchParams(params)}`, { headers: { cookie, "x-device-id": "ocr-eval" } });
  const body = (await res.json()) as { candidates?: Candidate[]; error?: string };
  if (!res.ok) throw new Error(`Search failed: ${res.status} ${body.error ?? ""}`);
  return body.candidates ?? [];
}

async function main() {
  const dir = required("OCR_TEST_DIR");
  const base = required("HR_BASE_URL").replace(/\/$/, "");
  const username = required("HR_USERNAME");
  const pin = required("HR_PIN");
  // Images whose existing patient must come back as a STRONG match; the others are new patients.
  const existing = new Set((process.env.OCR_EXPECT_EXISTING ?? "img-01,img-02,img-03,img-06,img-07,img-08").split(","));

  const expected = JSON.parse(await readFile(join(dir, "expected.json"), "utf8")) as Record<string, Expected>;
  const images = (await readdir(join(dir, "images"))).filter((f) => expected[f]).sort();
  const only = process.env.OCR_ONLY?.split(",");
  const selected = only ? images.filter((f) => only.some((o) => f.startsWith(o))) : images;

  const replay = process.env.OCR_REPLAY
    ? (JSON.parse(await readFile(process.env.OCR_REPLAY, "utf8")) as { results: { image: string; fields: { field: string; read: string; confidence: number }[]; other: Record<string, ScanField> }[] }).results
    : null;
  const typedBirthDate = process.env.OCR_TYPED_BIRTHDATE === "1";

  const cookie = await login(base, username, pin);
  const results = [];
  for (const name of selected) {
    const exp = expected[name]!;
    let read: Record<string, ScanField>;
    if (replay) {
      const prev = replay.find((r) => r.image === name);
      if (!prev) throw new Error(`No previous reading for ${name} in OCR_REPLAY`);
      read = { ...prev.other, ...Object.fromEntries(prev.fields.map((f) => [f.field, { value: f.read, confidence: f.confidence }])) };
    } else {
      read = await upload(base, cookie, join(dir, "images", name), name);
    }
    const birthDateTyped = typedBirthDate && !toIso(read.birthDate?.value ?? "") && !!exp.birthDate;
    const forSearch = birthDateTyped ? { ...read, birthDate: { value: exp.birthDate!, confidence: 1 } } : read;
    const fields = FIELDS.map((f) => {
      const got = read[f] ?? { value: "", confidence: 0 };
      const want = normalize(f, exp[f]);
      const have = normalize(f, got.value);
      return { field: f, expected: exp[f], read: got.value, confidence: got.confidence, correct: want === have, low: got.value !== "" && got.confidence < LOW_CONFIDENCE };
    });
    const query = searchQuery(forSearch);
    const candidates = query ? await search(base, cookie, query.params) : [];
    const top = candidates[0] ?? null;
    const id = name.replace(/\.[^.]+$/, "");
    const strong = top?.strength === "STRONG";
    const shouldMatch = existing.has(id);
    // An existing patient is detected only when the strong top candidate has her birth date and name.
    const rightPerson = !!top && normalize("birthDate", top.patient.birthDate) === normalize("birthDate", exp.birthDate) && normText(top.patient.fullName) === normText(exp.fullName);
    const detectionCorrect = shouldMatch ? strong && rightPerson : !strong;
    results.push({
      image: name,
      fields,
      correctCount: fields.filter((f) => f.correct).length,
      lowConfidence: fields.filter((f) => f.low).map((f) => f.field),
      other: Object.fromEntries(Object.entries(read).filter(([k, v]) => !FIELDS.includes(k as Field) && v.value)),
      search: query ? { extraKind: query.extraKind, sent: query.params, birthDateTyped } : null,
      top: top ? { fullName: top.patient.fullName, birthDate: top.patient.birthDate, score: top.score, strength: top.strength, reasons: top.reasons } : null,
      expectedStrong: shouldMatch,
      detectionCorrect,
    });
    const r = results.at(-1)!;
    console.log(`${name}: ${r.correctCount}/6 fields, low=[${r.lowConfidence.join(",")}], search=${r.search ? `${r.search.extraKind}${r.search.birthDateTyped ? " (date typed)" : ""}` : "not possible"}, top=${r.top ? `${r.top.strength} ${r.top.score} ${r.top.reasons.join("+")}` : "none"}, detection ${detectionCorrect ? "OK" : "MISS"}`);
  }

  const perField = FIELDS.map((f) => ({ field: f, correct: results.filter((r) => r.fields.find((x) => x.field === f)!.correct).length, total: results.length }));
  console.log("\nPer field:", perField.map((p) => `${p.field} ${p.correct}/${p.total}`).join(", "));
  console.log(`Detection: ${results.filter((r) => r.detectionCorrect).length}/${results.length}`);
  const out = join(dir, `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(out, JSON.stringify({ base, at: new Date().toISOString(), replay: !!replay, typedBirthDate, results, perField }, null, 2));
  console.log(`Results: ${out}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
