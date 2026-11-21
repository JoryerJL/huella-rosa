import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { PatientFields } from "@er/shared";
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
    fullName: draft.fullName,
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Stable for this form: a retry after a lost response is idempotent instead of creating a second patient.
  const [ids] = useState(() => ({ patientId: crypto.randomUUID(), meta: opMeta() }));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);
  const orNull = (v: string) => (v.trim() ? v.trim() : null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.fullName.trim().length < 2) return setError(es.search.errorName);
    const birthDate = isoFromParts(form.day, form.month, form.year);
    if (!birthDate) return setError(es.search.errorDate);

    const fields: PatientFields = {
      fullName: form.fullName.trim(),
      birthDate,
      formId: orNull(form.formId),
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
      navigate(`/patients/${patientId}/visit`);
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
        <TextField label={es.fields.fullName} value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} />
        <div className="grid grid-cols-[1fr_1fr_1.8fr] gap-4">
          <TextField label={es.search.day} inputMode="numeric" value={form.day} onChange={(e) => set({ day: digits(e.target.value, 2) })} />
          <TextField label={es.search.month} inputMode="numeric" value={form.month} onChange={(e) => set({ month: digits(e.target.value, 2) })} />
          <TextField label={es.search.year} inputMode="numeric" value={form.year} onChange={(e) => set({ year: digits(e.target.value, 4) })} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label={es.fields.formId} value={form.formId} onChange={(e) => set({ formId: e.target.value })} />
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
