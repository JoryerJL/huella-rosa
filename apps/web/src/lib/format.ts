import { es } from "../i18n/es";

// Clinical dates travel as "YYYY-MM-DD" text (CLAUDE.md); format them without Date to avoid time zones.

function parts(date: string): [string, string, string] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? [m[1]!, m[2]!, m[3]!] : null;
}

/** "1978-03-12" -> "12/03/1978" */
export function formatBirthDate(date: string): string {
  const p = parts(date);
  return p ? `${p[2]}/${p[1]}/${p[0]}` : date;
}

/** "2026-05-14" -> "14 may 2026" */
export function formatShortDate(date: string): string {
  const p = parts(date);
  if (!p) return date;
  return `${Number(p[2])} ${es.months[Number(p[1]) - 1] ?? p[1]} ${p[0]}`;
}

/** Today on this device as "YYYY-MM-DD" (local time). */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ageFrom(birthDate: string, today = todayIso()): number | null {
  const b = parts(birthDate);
  const t = parts(today);
  if (!b || !t) return null;
  let age = Number(t[0]) - Number(b[0]);
  if (Number(t[1]) < Number(b[1]) || (t[1] === b[1] && Number(t[2]) < Number(b[2]))) age -= 1;
  return age >= 0 ? age : null;
}

/** Builds "YYYY-MM-DD" from day/month/year inputs, or null when it is not a real date. */
export function isoFromParts(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isIsoDate(value: string): boolean {
  const p = parts(value);
  return !!p && value.length === 10 && isoFromParts(p[2], p[1], p[0]) === value;
}
