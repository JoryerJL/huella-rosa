import { useState } from "react";
import type { MatchCandidate, PatientAuditEntry, SearchQuery } from "@er/shared";
import { AdminPage, when } from "../components/AdminPage";
import { MatchCard } from "../components/MatchCard";
import { PatientSearchForm, emptyDraft } from "../components/PatientSearchForm";
import { Alert, Button, Card } from "../components/ui";
import { fetchPatientAudit } from "../data/admin";
import { searchPatients } from "../data/patients";
import { auditSentence, es } from "../i18n/es";

const t = es.admin.audit;

/** Bitácora por paciente: find her with the usual search, then read what happened in plain Spanish. */
export function AdminAudit() {
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const [selected, setSelected] = useState<{ name: string; entries: PatientAuditEntry[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(q: SearchQuery) {
    setBusy(true);
    setError(null);
    try {
      setCandidates((await searchPatients(q)).candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  async function open(c: MatchCandidate) {
    setError(null);
    try {
      setSelected({ name: c.patient.fullName, entries: await fetchPatientAudit(c.patient.id) });
    } catch {
      setError(es.audit.loadError);
    }
  }

  return (
    <AdminPage title={selected ? t.timelineTitle(selected.name) : t.title} subtitle={selected ? undefined : t.subtitle}>
      {error && <Alert>{error}</Alert>}
      {selected ? (
        <div className="space-y-4">
          <Button variant="outline" onClick={() => setSelected(null)}>
            {t.back}
          </Button>
          {selected.entries.length === 0 ? (
            <p className="text-lg text-muted">{t.empty}</p>
          ) : (
            <Card>
              <ol className="space-y-3">
                {selected.entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 border-t border-line pt-3 first:border-0 first:pt-0">
                    <span className="text-lg">
                      {auditSentence(e)} · <strong>{when(e.at)}</strong>
                    </span>
                    {(e.deviceName || e.devicePrefix) && (
                      <span className="text-base text-muted">
                        {e.deviceName ? t.device(e.deviceName) : t.deviceByPrefix(e.devicePrefix!)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      ) : (
        <div className="max-w-3xl space-y-6">
          <PatientSearchForm initial={emptyDraft} busy={busy} onSearch={onSearch} />
          {candidates && candidates.length === 0 && <Alert tone="warn">{es.matches.emptyClinician}</Alert>}
          {candidates && candidates.length > 0 && (
            <ul className="space-y-4">
              {candidates.map((c) => (
                <MatchCard
                  key={c.patient.id}
                  candidate={c}
                  action={<Button onClick={() => void open(c)}>{es.admin.nav.audit}</Button>}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </AdminPage>
  );
}
