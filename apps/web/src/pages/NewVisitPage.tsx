import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  CLINICAL_ROLES,
  DEFAULT_STEPS_BY_SERVICE,
  SERVICE_TYPES,
  type ClinicalRole,
  type PatientFields,
  type PatientRecord,
  type ServiceType,
  type SyncOp,
} from "@er/shared";
import { Page } from "../components/Page";
import { Alert, Button, Card, Check, Pencil, buttonClass, inputClass } from "../components/ui";
import { opMeta, saveVisit } from "../data/patients";
import { usePackageStatus } from "../data/hooks";
import { isPackageExpired, type PackageMeta } from "../data/db";
import { ensureFolioPrefix, reserveFolio } from "../data/folioPrefix";
import { usePatientRecord } from "../data/usePatientRecord";
import { ageFrom, formatBirthDate, isIsoDate, todayIso } from "../lib/format";
import { es } from "../i18n/es";
import { BackButton } from "./PatientRecordPage";
// Block 3a: form photo
import { AttachScanButton } from "../components/AttachScanButton";

/** Identification fields intake can confirm or correct on a visit (SPEC 6.2 step 4, 6.3 step 2). */
const REVIEW_FIELDS = ["fullName", "birthDate", "formId", "birthState", "mobile", "phone", "residence", "affiliation"] as const;
type ReviewField = (typeof REVIEW_FIELDS)[number];
type FieldState = "pending" | "confirmed" | "editing" | "corrected";

/** The campaign's last day; the server adds `endDate` to CampaignView (falls back to its single date). */
export function isOutsideCampaign(meta: PackageMeta, date: string): boolean {
  const { date: start, endDate } = meta.campaign as PackageMeta["campaign"] & { endDate?: string };
  return date < start || date > (endDate ?? start);
}

/** Specialists proposed from the services of the day (SPEC 6.3.1 item 1), in a stable order. */
export function defaultSteps(services: ServiceType[]): ClinicalRole[] {
  const wanted = new Set(services.flatMap((t) => DEFAULT_STEPS_BY_SERVICE[t]));
  return CLINICAL_ROLES.filter((r) => wanted.has(r));
}

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
  // Registered in this same flow: intake just typed her data, so it is a summary with one "Corregir datos".
  const justRegistered = params.get("new") === "1";
  const [fixing, setFixing] = useState(false);
  const summaryOnly = justRegistered && !fixing;

  const [values, setValues] = useState<Record<ReviewField, string>>(
    () => Object.fromEntries(REVIEW_FIELDS.map((k) => [k, originalValue(record, k)])) as Record<ReviewField, string>,
  );
  const [states, setStates] = useState<Record<ReviewField, FieldState>>(
    () => Object.fromEntries(REVIEW_FIELDS.map((k) => [k, "pending"])) as Record<ReviewField, FieldState>,
  );

  // The visit's campaign is the one of the downloaded package (SPEC 6.2 item 5).
  const pkgStatus = usePackageStatus();
  const pkg = pkgStatus.meta && !isPackageExpired(pkgStatus.meta) ? pkgStatus.meta : null;
  const campaignId = pkg?.campaignId ?? "";
  // undefined: still reserving; null: this tablet has no folio prefix yet (needs one online login).
  const [folio, setFolio] = useState<string | null | undefined>(undefined);
  const [services, setServices] = useState<ServiceType[]>([]);
  const [steps, setSteps] = useState<ClinicalRole[]>([]);
  const [stepsTouched, setStepsTouched] = useState(false);
  const [saved, setSaved] = useState(false);
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
    let active = true;
    (async () => {
      if (navigator.onLine) await ensureFolioPrefix();
      const next = await reserveFolio();
      if (active) setFolio(next);
    })().catch(() => active && setFolio(null));
    return () => {
      active = false;
    };
  }, []);

  const setState = (key: ReviewField, state: FieldState) => setStates((s) => ({ ...s, [key]: state }));
  const toggleService = (t: ServiceType) => {
    const next = services.includes(t) ? services.filter((x) => x !== t) : [...services, t];
    setServices(next);
    // Proposed from the services until intake changes the steps by hand.
    if (!stepsTouched) setSteps(defaultSteps(next));
  };
  const toggleStep = (role: ClinicalRole) => {
    setStepsTouched(true);
    setSteps((list) => (list.includes(role) ? list.filter((x) => x !== role) : CLINICAL_ROLES.filter((r) => r === role || list.includes(r))));
  };

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
    if (!pkg) return setError(es.visit.noPackage);
    if (!folio) return setError(es.visit.folioMissing);
    if (services.length === 0) return setError(es.visit.errorServices);
    if (steps.length === 0) return setError(es.visit.errorSteps);
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
        folio,
        confirmedMatch,
        services: services.map((type) => ({ serviceId: ids.serviceIds[type], type })),
        plannedSteps: steps,
      });
    }

    setBusy(true);
    setError(null);
    try {
      // Saved on this device and queued; the top bar shows it until the sync engine sends it.
      await saveVisit(ops, pkg.campaign.name);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const age = ageFrom(record.birthDate);

  if (saved && folio) {
    return (
      <Page title={es.visit.title(record.fullName)} leading={<BackButton />}>
        <Card className="max-w-2xl space-y-4">
          <p className="text-3xl font-bold text-ok" role="status">
            {es.visit.savedTitle}
          </p>
          <p className="text-lg">{es.visit.savedFolio(folio)}</p>
          <p className="text-5xl font-bold tracking-wider text-brand-strong">{folio}</p>
          <AttachScanButton link={{ visitId: ids.visitId, campaignId, folio }} />
          <Button onClick={() => navigate(`/patients/${record.id}`)} className="w-full text-xl">
            {es.visit.goToRecord}
          </Button>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title={es.visit.title(record.fullName)}
      subtitle={justRegistered ? es.visit.newSubtitle : es.visit.subtitle}
      leading={<BackButton />}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <h2 className="text-xl font-bold">{es.visit.yourData}</h2>
          {summaryOnly ? (
            <>
              <dl className="mt-4 space-y-3">
                {REVIEW_FIELDS.map((key) => (
                  <div key={key}>
                    <dt className="text-base text-muted">{es.fields[key]}</dt>
                    <dd className="text-lg font-bold">
                      {(key === "birthDate" ? formatBirthDate(values.birthDate) : values[key]) || es.common.none}
                    </dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={() => {
                  setFixing(true);
                  setStates(Object.fromEntries(REVIEW_FIELDS.map((k) => [k, "confirmed"])) as Record<ReviewField, FieldState>);
                }}
                className="mt-4 text-lg font-semibold text-brand-strong underline underline-offset-4"
              >
                {es.visit.fixData}
              </button>
            </>
          ) : (
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
          )}
        </Card>

        <div className="space-y-6">
          {folio === undefined ? (
            <p className="text-muted" role="status">{es.visit.folioLoading}</p>
          ) : folio === null ? (
            <Alert tone="warn">{es.visit.folioMissing}</Alert>
          ) : (
            <div className="rounded-2xl border-2 border-brand bg-blush px-5 py-4" aria-live="polite">
              <p className="text-lg font-semibold">{es.visit.folioWrite}</p>
              <p className="text-5xl font-bold tracking-wider text-brand-strong">{folio}</p>
              <p className="mt-1 text-base text-muted">{es.visit.folioHint}</p>
            </div>
          )}

          <div>
            <p className="text-base font-semibold">{es.visit.campaign}</p>
            {pkg ? (
              <p className="mt-1 text-xl font-bold">
                {pkg.campaign.name} · {formatBirthDate(pkg.campaign.date)}
              </p>
            ) : (
              pkgStatus.loaded && (
                <div className="mt-2 space-y-3">
                  <Alert tone="warn">{es.visit.noPackage}</Alert>
                  <Link to="/campaigns" className={buttonClass("outline")}>
                    {es.package.navLink}
                  </Link>
                </div>
              )
            )}
          </div>


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

          <fieldset>
            <legend className="text-base font-semibold">{es.visit.stepsLegend}</legend>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {CLINICAL_ROLES.map((role) => {
                const on = steps.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleStep(role)}
                    className={`min-h-20 rounded-2xl border-2 p-3 text-left ${on ? "border-brand bg-blush" : "border-field bg-white"}`}
                  >
                    <span className="flex items-center gap-2 text-xl font-bold">
                      {on && <Check />}
                      {es.stepRole[role]}
                    </span>
                    <span className="mt-1 block text-base text-muted">{on ? es.visit.stepOn : es.visit.stepOff}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {pkg && isOutsideCampaign(pkg, todayIso()) && <Alert tone="warn">{es.visit.outsideCampaign}</Alert>}

          {error && <Alert>{error}</Alert>}

          <Button type="submit" disabled={busy || !pkg || !folio} className="w-full text-xl">
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
