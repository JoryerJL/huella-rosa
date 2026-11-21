import { useState, type FormEvent } from "react";
import type { SearchQuery } from "@er/shared";
import { es } from "../i18n/es";
import { isoFromParts } from "../lib/format";
import { Alert, Button, Card, Check, TextField, inputClass } from "./ui";
import { DateFields } from "./DateFields";

export type ExtraKind = "phone" | "formId" | "birthState";
const EXTRA_KINDS: ExtraKind[] = ["phone", "formId", "birthState"];

/** What intake typed, kept so "Cambiar datos" and the registration form can reuse it. */
export interface SearchDraft {
  fullName: string;
  day: string;
  month: string;
  year: string;
  extraKind: ExtraKind;
  extra: string;
}

export const emptyDraft: SearchDraft = { fullName: "", day: "", month: "", year: "", extraKind: "phone", extra: "" };

export function draftToQuery(draft: SearchDraft): SearchQuery | null {
  const birthDate = isoFromParts(draft.day, draft.month, draft.year);
  if (!birthDate) return null;
  return { fullName: draft.fullName.trim(), birthDate, [draft.extraKind]: draft.extra.trim() };
}

export function PatientSearchForm({
  initial,
  busy,
  onSearch,
}: {
  initial: SearchDraft;
  busy: boolean;
  onSearch: (query: SearchQuery, draft: SearchDraft) => void;
}) {
  const [draft, setDraft] = useState<SearchDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<SearchDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (draft.fullName.trim().length < 2) return setError(es.search.errorName);
    const query = draftToQuery(draft);
    if (!query) return setError(es.search.errorDate);
    if (!draft.extra.trim()) return setError(es.search.errorExtra);
    setError(null);
    onSearch(query, draft);
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <TextField
          label={es.search.fullName}
          value={draft.fullName}
          onChange={(e) => set({ fullName: e.target.value })}
          autoComplete="off"
        />

        <DateFields
          value={{ day: draft.day, month: draft.month, year: draft.year }}
          onChange={(d) => set(d)}
          labels={{ day: es.search.day, month: es.search.month, year: es.search.year }}
        />

        <fieldset>
          <legend className="text-base font-semibold">{es.search.extraLegend}</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {EXTRA_KINDS.map((kind) => {
              const active = draft.extraKind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={active}
                  onClick={() => set({ extraKind: kind, extra: "" })}
                  className={`inline-flex min-h-14 items-center gap-2 rounded-xl border-2 px-5 text-lg font-semibold ${
                    active ? "border-brand-strong bg-brand-strong text-white" : "border-field bg-white text-ink"
                  }`}
                >
                  {active && <Check />}
                  {es.search.extraKind[kind]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-base font-semibold">{es.search.extraLabel[draft.extraKind]}</span>
          <input
            className={inputClass}
            value={draft.extra}
            inputMode={draft.extraKind === "phone" ? "tel" : "text"}
            onChange={(e) => set({ extra: e.target.value })}
            autoComplete="off"
          />
        </label>

        {error && <Alert>{error}</Alert>}

        <Button type="submit" disabled={busy} className="w-full text-xl">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          {busy ? es.search.searching : es.search.submit}
        </Button>
      </form>
    </Card>
  );
}
