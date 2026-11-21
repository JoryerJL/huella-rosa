import { useState } from "react";
import { Link } from "react-router";
import type { MatchCandidate, SearchQuery } from "@er/shared";
import { Page } from "../components/Page";
import { MatchCard } from "../components/MatchCard";
import { PatientSearchForm, emptyDraft } from "../components/PatientSearchForm";
import { Alert, buttonClass } from "../components/ui";
import { searchPatients } from "../data/patients";
import { es } from "../i18n/es";

/** Record search for intake and the clinical roles: results only open the record (no "Es ella" / register here). */
export function Patients() {
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
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

  return (
    <Page title={es.patients.title} subtitle={es.patients.subtitle}>
      <div className="max-w-3xl space-y-6">
        <PatientSearchForm initial={emptyDraft} busy={busy} onSearch={onSearch} />
        {error && <Alert>{error}</Alert>}
        {candidates && candidates.length === 0 && <Alert tone="warn">{es.matches.emptyClinician}</Alert>}
      </div>
      {candidates && candidates.length > 0 && (
        <ul className="mt-8 space-y-4">
          {candidates.map((c) => (
            <MatchCard
              key={c.patient.id}
              candidate={c}
              action={
                <Link to={`/patients/${c.patient.id}`} className={buttonClass("primary", "w-full sm:w-auto")}>
                  {es.matches.viewRecord}
                </Link>
              }
            />
          ))}
        </ul>
      )}
    </Page>
  );
}
