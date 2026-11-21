import { useState } from "react";
import { Link } from "react-router";
import type { MatchCandidate, SearchQuery } from "@er/shared";
import { Page } from "../components/Page";
import { MatchCard } from "../components/MatchCard";
import { PatientSearchForm, emptyDraft, type SearchDraft } from "../components/PatientSearchForm";
import { RegisterPatientForm } from "../components/RegisterPatientForm";
import { Alert, Button, Card, Check, Pencil, Plus, Warn, buttonClass } from "../components/ui";
import { searchPatients } from "../data/patients";
import { formatBirthDate } from "../lib/format";
import { es } from "../i18n/es";

type Step = "search" | "results" | "register";

/** Identify first, register after (SPEC 6.2): there is no "new patient" action before a search. */
export function Intake() {
  const [step, setStep] = useState<Step>("search");
  const [draft, setDraft] = useState<SearchDraft>(emptyDraft);
  const [query, setQuery] = useState<SearchQuery | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(q: SearchQuery, d: SearchDraft) {
    setBusy(true);
    setError(null);
    setDraft(d);
    try {
      const res = await searchPatients(q);
      setQuery(q);
      setCandidates(res.candidates);
      setStep("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (step === "register") {
    return (
      <Page title={es.register.title}>
        <div className="max-w-3xl">
          <RegisterPatientForm
            draft={draft}
            rejectedCandidateIds={candidates.map((c) => c.patient.id)}
            onCancel={() => setStep("results")}
          />
        </div>
      </Page>
    );
  }

  if (step === "results" && query) {
    const searched = [query.fullName, formatBirthDate(query.birthDate), query.phone ?? query.formId ?? query.birthState]
      .filter(Boolean)
      .join(" · ");
    const onlyName = candidates.some((c) => c.reasons.length === 1 && c.reasons[0] === "SIMILAR_NAME");

    return (
      <Page
        title={candidates.length > 0 ? es.matches.title : es.matches.emptyTitle}
        subtitle={`${es.matches.searchedFor} ${searched}`}
        actions={
          <Button variant="secondary" onClick={() => setStep("search")}>
            <Pencil />
            {es.matches.changeData}
          </Button>
        }
      >

        {candidates.length > 0 ? (
          <>
            <ul className="space-y-4">
              {candidates.map((c) => (
                <MatchCard
                  key={c.patient.id}
                  candidate={c}
                  action={
                    <Link to={`/patients/${c.patient.id}/visit?match=1`} className={buttonClass("primary", "w-full px-10 sm:w-auto")}>
                      <Check />
                      {es.matches.isHer}
                    </Link>
                  }
                />
              ))}
            </ul>
            {onlyName && (
              <p className="mt-4 flex items-center gap-2 font-semibold text-warn">
                <Warn />
                {es.matches.onlyNameWarning}
              </p>
            )}
            <div className="mt-8 flex flex-col gap-4 rounded-2xl border-2 border-dashed border-field p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-bold">{es.matches.noneTitle}</p>
                <p className="text-base text-muted">{es.matches.noneBody}</p>
              </div>
              <Button variant="outline" onClick={() => setStep("register")}>
                <Plus />
                {es.matches.otherPerson}
              </Button>
            </div>
          </>
        ) : (
          <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-lg">{es.matches.emptyBody}</p>
            <Button variant="outline" onClick={() => setStep("register")}>
              <Plus />
              {es.matches.emptyRegister}
            </Button>
          </Card>
        )}
      </Page>
    );
  }

  return (
    <Page title={es.intake.title} subtitle={es.intake.subtitle}>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <PatientSearchForm initial={draft} busy={busy} onSearch={onSearch} />
          {error && <Alert>{error}</Alert>}
        </div>
        <aside className="h-fit rounded-2xl bg-[#f3ebe8] p-6">
          <p className="font-bold">{es.intake.offlineTitle}</p>
          <p className="mt-2 text-base">{es.intake.offlineBody}</p>
          <p className="mt-4 text-base font-bold text-brand-strong">{es.intake.onlyAfterSearch}</p>
          <Link to="/campaigns" className={buttonClass("outline", "mt-4 w-full")}>
            {es.package.navLink}
          </Link>
        </aside>
      </div>
    </Page>
  );
}
