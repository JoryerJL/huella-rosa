import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { isClinicalRole } from "@er/shared";
import { Page } from "../components/Page";
import { StepChips } from "../components/StepChips";
import { ClinicalConflictsLink } from "../components/ClinicalConflictsLink";
import { Alert, Button, Card, EiraIdBadge, buttonClass, inputClass } from "../components/ui";
import { useLive, useOutboxSummary, useSyncState } from "../data/hooks";
import { loadQueue, refreshQueueFromServer, type QueueEntry } from "../data/steps";
import { useSession } from "../lib/session";
import { isValidFolio, normalizeFolio } from "../lib/folio";
import { es } from "../i18n/es";

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Pacientes esperándome" (SPEC 6.3.1 item 2): local data, works without signal. */
export function QueuePage() {
  const { profile } = useSession();
  const role = profile && isClinicalRole(profile.role) ? profile.role : null;
  const syncState = useSyncState();
  const outbox = useOutboxSummary();
  const queue = useLive<QueueEntry[]>(() => (role ? loadQueue(role) : Promise.resolve([])), [role], []);

  // With signal, refresh from the server after each sync run (and on open).
  useEffect(() => {
    if (!syncState.running) void refreshQueueFromServer().catch(() => undefined);
  }, [syncState.running]);

  const attention = [...outbox.waiting, ...outbox.failed].filter(
    (e) => e.kind === "COMPLETE_STEP" || e.kind === "UPDATE_SERVICE_FIELDS",
  );

  return (
    <Page
      title={es.queue.title}
      subtitle={es.queue.subtitle}
      actions={
        <Link to="/campaigns" className={buttonClass("secondary")}>
          {es.queue.packageLink}
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <ClinicalConflictsLink />
          {queue.length === 0 ? (
            <Card>
              <p className="text-lg text-muted">{es.queue.empty}</p>
            </Card>
          ) : (
            <ol className="space-y-3">
              {queue.map((item) => (
                <li key={item.visitId}>
                  <Card className="flex flex-wrap items-center gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-2xl font-bold">{item.fullName || es.queue.unknownName}</p>
                        <EiraIdBadge formId={item.formId} />
                      </div>
                      <p className="text-lg text-muted">{es.queue.folioLine(item.folio, clock(item.registeredAt))}</p>
                      <StepChips steps={item.steps} />
                    </div>
                    <Link to={`/visits/${encodeURIComponent(item.folio)}/step`} className={buttonClass("primary")}>
                      {es.queue.attend}
                    </Link>
                  </Card>
                </li>
              ))}
            </ol>
          )}

          {attention.length > 0 && (
            <Card>
              <h2 className="text-xl font-bold">{es.queue.attentionTitle}</h2>
              <ul className="mt-3 space-y-2">
                {attention.map((e) => (
                  <li key={e.opId} className="text-lg">
                    <strong>{e.op.kind === "COMPLETE_STEP" || e.op.kind === "UPDATE_SERVICE_FIELDS" ? es.record.folio(e.op.folio) : es.visit.opLabel[e.kind]}:</strong>{" "}
                    {e.message ?? es.sync.waiting}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <TypeFolio />
      </div>
    </Page>
  );
}

function TypeFolio() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValidFolio(value)) return setError(es.queue.invalidFolio);
    // Opens even if the visit has not reached this tablet (SPEC 6.3.1, "El folio une a las estaciones").
    navigate(`/visits/${encodeURIComponent(normalizeFolio(value))}/step`);
  }

  return (
    <Card className="h-fit">
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <h2 className="text-xl font-bold">{es.queue.typeTitle}</h2>
        <p className="text-lg text-muted">{es.queue.typeHint}</p>
        <label className="block">
          <span className="text-base font-semibold">{es.queue.typeLabel}</span>
          <input
            className={`${inputClass} text-2xl font-bold uppercase tracking-wider`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="B3-017-T"
            autoComplete="off"
            autoCapitalize="characters"
          />
        </label>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full">
          {es.queue.open}
        </Button>
        <p className="text-base text-muted">{es.queue.typeHelp}</p>
      </form>
    </Card>
  );
}
