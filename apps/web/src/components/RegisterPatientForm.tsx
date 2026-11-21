import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { buildEiraId, joinNameParts, patientSlug, splitFullName, type PatientFields } from "@er/shared";
import { es } from "../i18n/es";
import { createPatient, opMeta } from "../data/patients";
import { isoFromParts } from "../lib/format";
import type { SearchDraft } from "./PatientSearchForm";
import { Alert, Button, Card, TextField, inputClass } from "./ui";

/** Shown only after a search: "Es otra persona" (REJECTED_MATCH) or zero candidates (NO_MATCH). SPEC 6.2. */
export function RegisterPatientForm({
  draft,
  rejectedCandidateIds,
  onCancel,
}: {
  draft: SearchDraft;
  rejectedCandidateIds: string[];
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    ...splitFullName(draft.fullName),
    day: draft.day,
    month: draft.month,
    year: draft.year,
    formId: draft.extraKind === "formId" ? draft.extra : "",
    birthState: draft.extraKind === "birthState" ? draft.extra : "",
    phone: draft.extraKind === "phone" ? draft.extra : "",
    mobile: "",
    residence: "",
    affiliation: "",
  });
  // The EIRA ID follows the name and date until the person types their own (SPEC 6.1.1).
  const [formIdEdited, setFormIdEdited] = useState(draft.extraKind === "formId" && draft.extra.trim() !== "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Stable for this form: a retry after a lost response is idempotent instead of creating a second patient.
  const [ids] = useState(() => ({ patientId: crypto.randomUUID(), meta: opMeta() }));
  const set = (patch: Partial<typeof form>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      if (formIdEdited) return next;
      const birthDate = isoFromParts(next.day, next.month, next.year) ?? "";
      return { ...next, formId: buildEiraId({ ...next, birthDate }) };
    });
  const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);
  const orNull = (v: string) => (v.trim() ? v.trim() : null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fullName = joinNameParts(form);
    if (fullName.length < 2 || !form.givenNames.trim()) return setError(es.register.errorGivenNames);
    if (!form.paternalSurname.trim()) return setError(es.register.errorPaternal);
    const birthDate = isoFromParts(form.day, form.month, form.year);
    if (!birthDate) return setError(es.search.errorDate);

    const fields: PatientFields = {
      fullName,
      givenNames: orNull(form.givenNames),
      paternalSurname: orNull(form.paternalSurname),
      maternalSurname: orNull(form.maternalSurname),
      birthDate,
      formId: orNull(form.formId.toUpperCase()),
      birthState: orNull(form.birthState),
      phone: orNull(form.phone),
      mobile: orNull(form.mobile),
      residence: orNull(form.residence),
      affiliation: orNull(form.affiliation),
    };
    const { patientId } = ids;
    const op = {
      ...ids.meta,
      kind: "CREATE_PATIENT" as const,
      patientId,
      fields,
      decision: rejectedCandidateIds.length > 0 ? ("REJECTED_MATCH" as const) : ("NO_MATCH" as const),
      rejectedCandidateIds,
    };

    setBusy(true);
    setError(null);
    try {
      // Saved on this device and queued; the sync engine sends it when there is signal.
      await createPatient(op);
      // "new=1": she was just registered here, so the visit shows her data as a summary, not field by field.
      navigate(`/patients/${patientSlug({ id: patientId, formId: fields.formId })}/visit?new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <p className="text-lg text-muted">{es.register.subtitle}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
        <TextField label={es.fields.givenNames} value={form.givenNames} onChange={(e) => set({ givenNames: e.target.value })} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label={es.fields.paternalSurname} value={form.paternalSurname} onChange={(e) => set({ paternalSurname: e.target.value })} />
          <TextField label={es.fields.maternalSurname} value={form.maternalSurname} onChange={(e) => set({ maternalSurname: e.target.value })} />
        </div>
        <div className="grid grid-cols-[1fr_1fr_1.8fr] gap-4">
          <TextField label={es.search.day} inputMode="numeric" value={form.day} onChange={(e) => set({ day: digits(e.target.value, 2) })} />
          <TextField label={es.search.month} inputMode="numeric" value={form.month} onChange={(e) => set({ month: digits(e.target.value, 2) })} />
          <TextField label={es.search.year} inputMode="numeric" value={form.year} onChange={(e) => set({ year: digits(e.target.value, 4) })} />
        </div>
        <label className="block rounded-lg border-2 border-[#f3ebe8] bg-[#fdf8f6] p-4">
          <span className="text-base font-semibold">{es.fields.formId}</span>
          <input
            className={`${inputClass} font-mono text-2xl tracking-widest uppercase`}
            value={form.formId}
            maxLength={11}
            autoCapitalize="characters"
            onChange={(e) => {
              setFormIdEdited(true);
              setForm((f) => ({ ...f, formId: e.target.value.toUpperCase() }));
            }}
          />
          <span className="mt-2 block text-base text-muted">{es.register.eiraIdHint}</span>
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label={es.fields.birthState} value={form.birthState} onChange={(e) => set({ birthState: e.target.value })} />
          <TextField label={es.fields.phone} inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          <TextField label={es.fields.mobile} inputMode="tel" value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} />
        </div>
        <TextField label={es.fields.residence} value={form.residence} onChange={(e) => set({ residence: e.target.value })} />
        <label className="block">
          <span className="text-base font-semibold">{es.fields.affiliation}</span>
          <select className={inputClass} value={form.affiliation} onChange={(e) => set({ affiliation: e.target.value })}>
            <option value="">{es.fields.affiliationPlaceholder}</option>
            {es.affiliationOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        {error && <Alert>{error}</Alert>}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" disabled={busy} className="flex-1 text-xl">
            {busy ? es.common.saving : es.register.submit}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {es.register.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
