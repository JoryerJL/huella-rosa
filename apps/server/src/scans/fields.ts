import type { Role, ScanFieldValue } from "@er/shared";
import type { Template } from "../templates";

// Who sees which read value (SPEC 6.4 items 5-6, 6.3.1): intake confirms only identification
// fields; each specialist sees the fields it fills (`filledBy`) plus identification. Fields marked
// `no_transcribir` are never read as text: the photo keeps them (CLAUDE.md rule 5).

export type Extraction = Record<string, ScanFieldValue>;

/** Template keys the reading may propose. */
export function transcribableKeys(template: Template): string[] {
  return template.campos.filter((f) => !f.no_transcribir).map((f) => f.clave);
}

/** Keys `role` may see in a read form. Admin and unknown roles see none. */
export function visibleKeys(template: Template, role: Role): Set<string> {
  const keys = new Set<string>();
  if (role === "admin") return keys;
  for (const f of template.campos) {
    if (f.no_transcribir) continue;
    if (f.identificacion) keys.add(f.clave);
    else if (role !== "intake" && f.filledBy === role) keys.add(f.clave);
  }
  return keys;
}

export function filterForRole(extraction: Extraction, template: Template, role: Role): Extraction {
  const keys = visibleKeys(template, role);
  const out: Extraction = {};
  for (const [key, value] of Object.entries(extraction)) {
    if (keys.has(key)) out[key] = value;
  }
  return out;
}

/** Every transcribable field empty with confidence 0 (nothing could be read). */
export function emptyExtraction(template: Template): Extraction {
  return Object.fromEntries(transcribableKeys(template).map((k) => [k, { value: "", confidence: 0 }]));
}

/** Keeps only known, transcribable keys with a sane value/confidence shape. */
export function sanitizeExtraction(raw: unknown, template: Template): Extraction {
  const allowed = new Set(transcribableKeys(template));
  const out: Extraction = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key) || !v || typeof v !== "object") continue;
    const { value, confidence } = v as { value?: unknown; confidence?: unknown };
    if (typeof value !== "string" || typeof confidence !== "number") continue;
    out[key] = { value, confidence: Math.max(0, Math.min(1, confidence)) };
  }
  return out;
}
