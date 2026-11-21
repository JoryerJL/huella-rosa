import { es } from "../i18n/es";
import { isoFromParts } from "../lib/format";
import { TextField } from "./ui";

// Dates are typed in three boxes, DD / MM / AAAA. The native date picker shows English
// "Day/Month/Year" on some tablets and breaks when typing, so it is not used anywhere.

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

export const emptyDateParts: DateParts = { day: "", month: "", year: "" };

/** "2026-11-21" → { day: "21", month: "11", year: "2026" }; anything else gives empty boxes. */
export function partsFromIso(iso: string | null | undefined): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? { day: m[3]!, month: m[2]!, year: m[1]! } : emptyDateParts;
}

/** AAAA-MM-DD when the three boxes form a real date, otherwise null. */
export function isoFromDateParts(p: DateParts): string | null {
  return isoFromParts(p.day, p.month, p.year);
}

const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

export function DateFields({
  value,
  onChange,
  labels = { day: es.dateFields.day, month: es.dateFields.month, year: es.dateFields.year },
}: {
  value: DateParts;
  onChange: (next: DateParts) => void;
  labels?: { day: string; month: string; year: string };
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1.8fr] gap-4">
      <TextField
        label={labels.day}
        inputMode="numeric"
        placeholder="DD"
        value={value.day}
        onChange={(e) => onChange({ ...value, day: digits(e.target.value, 2) })}
      />
      <TextField
        label={labels.month}
        inputMode="numeric"
        placeholder="MM"
        value={value.month}
        onChange={(e) => onChange({ ...value, month: digits(e.target.value, 2) })}
      />
      <TextField
        label={labels.year}
        inputMode="numeric"
        placeholder="AAAA"
        value={value.year}
        onChange={(e) => onChange({ ...value, year: digits(e.target.value, 4) })}
      />
    </div>
  );
}
