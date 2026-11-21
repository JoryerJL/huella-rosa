import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  SERVICE_TYPES,
  type CampaignView,
  type PatientFields,
  type PatientRecord,
  type ServiceType,
  type SyncOp,
} from "@er/shared";
import { Page } from "../components/Page";
import { Alert, Button, Card, Check, Pencil, inputClass } from "../components/ui";
import { listCampaigns, opMeta, saveVisit } from "../data/patients";
import { usePatientRecord } from "../data/usePatientRecord";
import { ageFrom, formatBirthDate, isIsoDate, todayIso } from "../lib/format";
import { es } from "../i18n/es";
import { BackButton } from "./PatientRecordPage";

/** Identification fields intake can confirm or correct on a visit (SPEC 6.2 step 4, 6.3 step 2). */
const REVIEW_FIELDS = ["fullName", "birthDate", "formId", "birthState", "mobile", "phone", "residence", "affiliation"] as const;
type ReviewField = (typeof REVIEW_FIELDS)[number];
type FieldState = "pending" | "confirmed" | "editing" | "corrected";

function originalValue(record: PatientRecord, key: ReviewField): string {
  return record[key] ?? "";
}

export function NewVisitPage() {
  const { id } = useParams();
  const { record, error, reload } = usePatientRecord(id);

  if (error) {
    return (
      <Page title={es.record.loadError} leading={<BackButton />}>
        <div className="max-w-2xl space-y-4">
          <Alert>{error}</Alert>
          <Button onClick={reload}>{es.common.retry}</Button>
        </div>
      </Page>
    );
  }
  if (!record) {
    return (
      <Page title={es.common.loading} leading={<BackButton />}>
        <p className="text-muted" role="status">{es.common.loading}</p>
      </Page>
    );
  }
  return <VisitForm record={record} />;
}

function VisitForm({ record }: { record: PatientRecord }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const confirmedMatch = params.get("match") === "1";

  const [values, setValues] = useState<Record<ReviewField, string>>(
    () => Object.fromEntries(REVIEW_FIELDS.map((k) => [k, originalValue(record, k)])) as Record<ReviewField, string>,
  );
  const [states, setStates] = useState<Record<ReviewField, FieldState>>(
    () => Object.fromEntries(REVIEW_FIELDS.map((k) => [k, "pending"])) as Record<ReviewField, FieldState>,
  );

  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [folio, setFolio] = useState("");
  const [services, setServices] = useState<ServiceType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Stable ids: saving twice stores the ops once, and the server is idempotent on the same opId.
  const [ids] = useState(() => ({
    visitId: crypto.randomUUID(),
    visitOp: opMeta(),
    updateOp: opMeta(),
    serviceIds: Object.fromEntries(SERVICE_TYPES.map((t) => [t, crypto.randomUUID()])) as Record<ServiceType, string>,
  }));

  useEffect(() => {
    listCampaigns()
      .then((list) => {
        const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
        setCampaigns(sorted);
        if (sorted[0]) setCampaignId(sorted[0].id);
      })
      .catch((err: unknown) => {
        setCampaigns([]);
        setError(err instanceof Error ? err.message : es.errors.generic);
      });
  }, []);

  const setState = (key: ReviewField, state: FieldState) => setStates((s) => ({ ...s, [key]: state }));
  const toggleService = (t: ServiceType) =>
    setServices((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]));

  function changedFields(): Partial<PatientFields> {
    const changes: Record<string, string | null> = {};
    for (const key of REVIEW_FIELDS) {
      const next = values[key].trim();
      if (next !== originalValue(record, key).trim()) changes[key] = next === "" ? null : next;
    }
    return changes as Partial<PatientFields>;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!campaignId) return setError(es.visit.errorCampaign);
    if (services.length === 0) return setError(es.visit.errorServices);
    const changes = changedFields();
    if ("fullName" in changes && (changes.fullName ?? "").length < 2) return setError(es.visit.errorName);
    if ("birthDate" in changes && !isIsoDate(changes.birthDate ?? "")) return setError(es.visit.errorDate);

    const ops: Extract<SyncOp, { kind: "UPDATE_PATIENT" | "CREATE_VISIT" }>[] = [];
    if (Object.keys(changes).length > 0) {
      ops.push({ ...ids.updateOp, kind: "UPDATE_PATIENT", patientId: record.id, baseVersion: record.version, changes });
    }
    {
      ops.push({
        ...ids.visitOp,
        kind: "CREATE_VISIT",
        visitId: ids.visitId,
        patientId: record.id,
        campaignId,
        date: todayIso(),
        folio: folio.trim() || null,
        confirmedMatch,
        services: services.map((type) => ({ serviceId: ids.serviceIds[type], type })),
      });
    }

    setBusy(true);
    setError(null);
    try {
      // Saved on this device and queued; the top bar shows it until the sync engine sends it.
      const campaignName = campaigns?.find((c) => c.id === campaignId)?.name ?? "";
      await saveVisit(ops, campaignName);
      navigate(`/patients/${record.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const age = ageFrom(record.birthDate);

  return (
    <Page title={es.visit.title(record.fullName)} subtitle={es.visit.subtitle} leading={<BackButton />}>
      <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <h2 className="text-xl font-bold">{es.visit.yourData}</h2>
          <ul className="mt-4 space-y-3">
            {REVIEW_FIELDS.map((key) => (
              <FieldRow
                key={key}
                field={key}
                value={values[key]}
                display={
                  key === "birthDate"
                    ? `${formatBirthDate(values.birthDate)}${age !== null && values.birthDate === record.birthDate ? ` · ${es.common.yearsOld(age)}` : ""}`
                    : values[key]
                }
                state={states[key]}
                onChange={(v) => setValues((s) => ({ ...s, [key]: v }))}
                onState={(st) => setState(key, st)}
                onUndo={() => {
                  setValues((s) => ({ ...s, [key]: originalValue(record, key) }));
                  setState(key, "pending");
                }}
              />
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <label className="block">
            <span className="text-base font-semibold">{es.visit.campaign}</span>
            <select className={inputClass} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!campaigns}>
              {!campaigns && <option value="">{es.common.loading}</option>}
              {campaigns?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {formatBirthDate(c.date)}
                </option>
              ))}
            </select>
            {campaigns && campaigns.length === 0 && <span className="mt-2 block text-base text-danger">{es.visit.noCampaigns}</span>}
          </label>

          <label className="block">
            <span className="text-base font-semibold">{es.visit.folio}</span>
            <input className={inputClass} value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="F-000000" autoComplete="off" />
          </label>

          <fieldset>
            <legend className="text-base font-semibold">{es.visit.services}</legend>
            <div className="mt-2 grid grid-cols-2 gap-4">
              {SERVICE_TYPES.map((t) => {
                const on = services.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleService(t)}
                    className={`min-h-24 rounded-2xl border-2 p-4 text-left ${on ? "border-brand bg-blush" : "border-field bg-white"}`}
                  >
                    <span className="flex items-center gap-3 text-xl font-bold">
                      <span
                        aria-hidden="true"
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 ${on ? "border-brand bg-brand text-white" : "border-field bg-white"}`}
                      >
                        {on && <Check />}
                      </span>
                      {es.services[t]}
                    </span>
                    <span className="mt-2 block text-base text-muted">{on ? es.visit.serviceOn : es.visit.serviceOff}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {error && <Alert>{error}</Alert>}

          <Button type="submit" disabled={busy || !campaigns} className="w-full text-xl">
            <Check />
            {busy ? es.common.saving : es.visit.submit}
          </Button>
        </div>
      </form>
    </Page>
  );
}

function FieldRow({
  field,
  value,
  display,
  state,
  onChange,
  onState,
  onUndo,
}: {
  field: ReviewField;
  value: string;
  display: string;
  state: FieldState;
  onChange: (v: string) => void;
  onState: (s: FieldState) => void;
  onUndo: () => void;
}) {
  const label = es.fields[field];

  if (state === "editing") {
    return (
      <li className="rounded-xl border-2 border-brand p-4">
        <label className="block">
          <span className="text-base font-semibold">{label}</span>
          {field === "affiliation" ? (
            <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} autoFocus>
              <option value="">{es.fields.affiliationPlaceholder}</option>
              {es.affiliationOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              type={field === "birthDate" ? "date" : "text"}
              inputMode={field === "mobile" || field === "phone" ? "tel" : undefined}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              autoFocus
            />
          )}
        </label>
        <div className="mt-3 flex gap-3">
          <Button onClick={() => onState("corrected")} className="flex-1">
            <Check />
            {es.visit.done}
          </Button>
          <Button variant="secondary" onClick={onUndo} className="flex-1">
            {es.visit.undo}
          </Button>
        </div>
      </li>
    );
  }

  const settledState = state === "confirmed" || state === "corrected";
  return (
    <li className={`rounded-xl p-4 ${settledState ? "bg-surface" : "border-2 border-field"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base text-muted">{label}</p>
          <p className="text-lg font-bold">{display || es.common.none}</p>
        </div>
        {settledState && (
          <button
            type="button"
            onClick={() => onState("editing")}
            className="inline-flex min-h-14 items-center gap-2 rounded-full bg-green-100 px-4 text-base font-semibold text-ok"
            aria-label={`${state === "corrected" ? es.visit.corrected : es.visit.confirmed}. ${es.visit.correct} ${label}`}
          >
            <Check />
            {state === "corrected" ? es.visit.corrected : es.visit.confirmed}
          </button>
        )}
      </div>
      {!settledState && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => onState("confirmed")}>
            <Check />
            {es.visit.confirm}
          </Button>
          <Button variant="secondary" onClick={() => onState("editing")}>
            <Pencil />
            {es.visit.correct}
          </Button>
        </div>
      )}
    </li>
  );
}
