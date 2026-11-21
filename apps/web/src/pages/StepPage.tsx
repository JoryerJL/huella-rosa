import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { isClinicalRole, type ClinicalRole, type PatientRecord, type ServiceType, type SyncOp } from "@er/shared";
import { Page } from "../components/Page";
import { StepChips } from "../components/StepChips";
import { Alert, Button, Card, Check, buttonClass, inputClass } from "../components/ui";
import { BackButton } from "./PatientRecordPage";
import { getPackageMeta, type LocalVisit } from "../data/db";
import { getPatientRecord, listCampaigns, opMeta } from "../data/patients";
import { findVisitByFolio, knownPatientName, saveStep } from "../data/steps";
import { useSession } from "../lib/session";
import { isValidFolio, normalizeFolio } from "../lib/folio";
import { formatShortDate } from "../lib/format";
import { stepFieldsFor, type StepField } from "../lib/stepFields";
import { es } from "../i18n/es";

type StepOp = Extract<SyncOp, { kind: "UPDATE_SERVICE_FIELDS" | "COMPLETE_STEP" }>;

interface Loaded {
  visit: LocalVisit | null;
  name: string | null;
  campaignId: string | null;
}

async function resolveCampaignId(visit: LocalVisit | null): Promise<string | null> {
  if (visit?.campaignId) return visit.campaignId;
  const pkg = await getPackageMeta();
  if (pkg) return pkg.campaignId;
  try {
    const list = await listCampaigns();
    return [...list].sort((a, b) => b.date.localeCompare(a.date))[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** "Mi paso" (SPEC 6.3.1 items 3-4): only this specialist's fields; works even if the visit has not arrived. */
export function StepPage() {
  const params = useParams();
  const folio = normalizeFolio(params.folio ?? "");
  const { profile } = useSession();
  const role = profile && isClinicalRole(profile.role) ? profile.role : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const visit = await findVisitByFolio(folio);
      const [name, campaignId] = await Promise.all([knownPatientName(visit), resolveCampaignId(visit)]);
      if (active) setLoaded({ visit, name, campaignId });
    })().catch(() => active && setLoaded({ visit: null, name: null, campaignId: null }));
    return () => {
      active = false;
    };
  }, [folio]);

  if (!isValidFolio(folio) || !role || !profile) {
    return (
      <Page title={es.step.title(folio, null)} leading={<BackButton />}>
        <Alert>{es.step.invalidFolio}</Alert>
      </Page>
    );
  }
  if (!loaded) {
    return (
      <Page title={es.step.title(folio, null)} leading={<BackButton />}>
        <p className="text-muted" role="status">{es.common.loading}</p>
      </Page>
    );
  }
  return <StepForm folio={folio} role={role} staffName={profile.name} loaded={loaded} />;
}

function StepForm({ folio, role, staffName, loaded }: { folio: string; role: ClinicalRole; staffName: string; loaded: Loaded }) {
  const navigate = useNavigate();
  const fields = useMemo(() => stepFieldsFor(role), [role]);
  const [confirmedName, setConfirmedName] = useState(loaded.name ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [leaving, setLeaving] = useState(false);
  const [reason, setReason] = useState(es.step.leftReasonDefault);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Stable op ids: a double tap stores the ops once.
  const [ids] = useState(() => ({ fields: { BREAST_REVIEW: opMeta(), PAP: opMeta() }, done: opMeta(), skip: opMeta() }));

  const mine = loaded.visit?.steps?.find((s) => s.role === role);

  async function submit(kind: "DONE" | "SKIPPED") {
    const name = confirmedName.trim();
    if (name.length < 2) return setError(es.step.errorName);
    if (!loaded.campaignId) return setError(es.step.noCampaign);
    if (kind === "SKIPPED" && reason.trim().length === 0) return setError(es.step.errorReason);

    const base = { campaignId: loaded.campaignId, folio, confirmedName: name };
    const ops: StepOp[] = [];
    if (kind === "DONE") {
      const byService = new Map<ServiceType, Record<string, string>>();
      for (const f of fields) {
        const v = (values[f.key] ?? "").trim();
        if (!v) continue;
        byService.set(f.serviceType, { ...(byService.get(f.serviceType) ?? {}), [f.key]: v });
      }
      for (const [serviceType, data] of byService) {
        const meta = serviceType === "PAP" ? ids.fields.PAP : ids.fields.BREAST_REVIEW;
        ops.push({ ...meta, ...base, kind: "UPDATE_SERVICE_FIELDS", serviceType, fields: data });
      }
      ops.push({ ...ids.done, ...base, kind: "COMPLETE_STEP", role, status: "DONE" });
    } else {
      ops.push({ ...ids.skip, ...base, kind: "COMPLETE_STEP", role, status: "SKIPPED", reason: reason.trim() });
    }

    setBusy(true);
    setError(null);
    try {
      await saveStep(ops, staffName);
      navigate("/queue");
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit("DONE");
  }

  return (
    <Page
      title={es.step.title(folio, loaded.name)}
      subtitle={es.step.subtitle(es.stepRole[role])}
      leading={<BackButton />}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {!loaded.visit && <Alert tone="warn">{es.step.notArrived}</Alert>}
          {mine && mine.status !== "PENDING" && <Alert tone="ok">{es.step.alreadyDone(es.stepStatus[mine.status])}</Alert>}
          {loaded.visit?.steps && <StepChips steps={loaded.visit.steps} />}

          <Card>
            <label className="block">
              <span className="text-lg font-semibold">{es.step.confirmName}</span>
              <input
                className={inputClass}
                value={confirmedName}
                onChange={(e) => setConfirmedName(e.target.value)}
                autoComplete="off"
                required
              />
              <span className="mt-2 block text-base text-muted">
                {loaded.name ? es.step.confirmKnownHint : es.step.confirmNameHint}
              </span>
            </label>
          </Card>

          {!leaving && (
            <Card className="space-y-5">
              <h2 className="text-xl font-bold">{es.step.fieldsTitle}</h2>
              {fields.length === 0 && <p className="text-muted">{es.step.noFields}</p>}
              {fields.map((f) => (
                <FieldInput
                  key={`${f.serviceType}:${f.key}`}
                  field={f}
                  value={values[f.key] ?? ""}
                  onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                />
              ))}
            </Card>
          )}

          {leaving && (
            <Card className="space-y-3">
              <label className="block">
                <span className="text-lg font-semibold">{es.step.leftReason}</span>
                <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            </Card>
          )}

          {error && <Alert>{error}</Alert>}

          {leaving ? (
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => void submit("SKIPPED")} disabled={busy}>
                {busy ? es.common.saving : es.step.leftConfirm}
              </Button>
              <Button variant="secondary" onClick={() => setLeaving(false)}>
                {es.step.cancel}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button type="submit" disabled={busy} className="text-xl">
                <Check />
                {busy ? es.common.saving : es.step.save}
              </Button>
              <Button variant="secondary" onClick={() => setLeaving(true)} className="text-xl">
                {es.step.left}
              </Button>
            </div>
          )}
        </form>

        <History patientId={loaded.visit?.patientId ?? null} />
      </div>
    </Page>
  );
}

function FieldInput({ field, value, onChange }: { field: StepField; value: string; onChange: (v: string) => void }) {
  if (field.kind === "choice") {
    return (
      <fieldset>
        <legend className="text-lg font-semibold">{field.label}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {field.options.map((o) => {
            const on = value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(on ? "" : o.value)}
                className={`min-h-14 rounded-xl border-2 px-4 text-lg font-semibold ${on ? "border-brand bg-blush" : "border-field bg-white"}`}
              >
                {o.label === o.value ? o.label : `${o.value} · ${o.label}`}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }
  return (
    <label className="block">
      <span className="text-lg font-semibold">{field.label}</span>
      {field.kind === "longText" ? (
        <textarea className={`${inputClass} min-h-28 py-3`} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          className={inputClass}
          type={field.kind === "date" ? "date" : "text"}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

/** Online: server record with clinical data. Offline: local history without clinical data. */
function History({ patientId }: { patientId: string | null }) {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    getPatientRecord(patientId)
      .then((r) => active && setRecord(r))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [patientId]);

  const visits = record ? [...record.visits].sort((a, b) => b.date.localeCompare(a.date)) : [];
  const hasClinical = visits.some((v) => v.services.some((s) => s.data !== null));

  return (
    <Card className="h-fit space-y-3">
      <h2 className="text-xl font-bold">{es.step.historyTitle}</h2>
      {!patientId || failed ? (
        <>
          <p className="text-lg text-muted">{es.step.historyUnknown}</p>
          <Link to="/patients" className={buttonClass("outline", "w-full")}>
            {es.step.searchPatient}
          </Link>
        </>
      ) : !record ? (
        <p className="text-muted" role="status">{es.common.loading}</p>
      ) : visits.length === 0 ? (
        <p className="text-muted">{es.record.noVisits}</p>
      ) : (
        <ul className="space-y-3">
          {visits.map((v) => (
            <li key={v.id}>
              <p className="text-lg font-semibold">
                {formatShortDate(v.date)} · {v.campaignName}
              </p>
              <p className="text-base text-muted">
                {v.services
                  .map((s) => {
                    const birads = s.data?.birads;
                    return birads ? `${es.services[s.type]} · ${es.record.birads(birads)}` : es.services[s.type];
                  })
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {record && !hasClinical && <p className="text-base text-muted">{es.step.historyOffline}</p>}
    </Card>
  );
}
