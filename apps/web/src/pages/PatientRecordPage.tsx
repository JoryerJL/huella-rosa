import { Link, useNavigate, useParams } from "react-router";
import { patientSlug, type PatientRecord, type ServiceView } from "@er/shared";
import { Page } from "../components/Page";
import { Alert, BackArrow, Button, Card, EiraIdBadge, Lock, Plus, buttonClass } from "../components/ui";
import { usePatientRecord } from "../data/usePatientRecord";
import type { VisitWithSteps } from "../data/patients";
import { StepChips } from "../components/StepChips";
import { useSession } from "../lib/session";
import { ageFrom, formatBirthDate, formatShortDate, todayIso } from "../lib/format";
import { es } from "../i18n/es";
import { recordSections } from "../lib/stepFields";

export function BackButton() {
  const navigate = useNavigate();
  return (
    <Button variant="secondary" onClick={() => navigate(-1)}>
      <BackArrow />
      {es.common.back}
    </Button>
  );
}

export function recordSubtitle(record: PatientRecord): string {
  const age = ageFrom(record.birthDate);
  return [
    age !== null ? es.common.yearsOld(age) : null,
    es.common.visitsCount(record.visits.length),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Expediente (SPEC 6.3): identification, linked records note and visit timeline. Clinical data only for the clinical roles (server decides). */
export function PatientRecordPage() {
  const { id } = useParams();
  const { profile } = useSession();
  const { record, error, reload } = usePatientRecord(id);
  const isIntake = profile?.role === "intake";

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

  const visits = [...record.visits].sort((a, b) => b.date.localeCompare(a.date));
  const showsClinical = visits.some((v) => v.services.some((s) => s.data !== null));

  return (
    <Page
      title={record.fullName}
      badge={<EiraIdBadge formId={record.formId} />}
      subtitle={recordSubtitle(record)}
      leading={<BackButton />}
      actions={
        isIntake && (
          <Link to={`/patients/${patientSlug(record)}/visit`} className={buttonClass("primary")}>
            <Plus />
            {es.record.newVisit}
          </Link>
        )
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="h-fit">
          <h2 className="text-xl font-bold">{es.record.identification}</h2>
          {record.linkedIds.length > 0 && (
            <p className="mt-3 rounded-xl bg-blush px-4 py-2 text-base font-semibold text-plum">
              {es.record.linked(record.linkedIds.length)}
            </p>
          )}
          <dl className="mt-4 space-y-3">
            <Item label={es.fields.formId} value={record.formId} />
            <Item label={es.fields.birthDate} value={formatBirthDate(record.birthDate)} />
            <Item label={es.fields.birthState} value={record.birthState} />
            <Item label={es.fields.mobile} value={record.mobile} />
            <Item label={es.fields.phone} value={record.phone} />
            <Item label={es.fields.residence} value={record.residence ?? record.localityName} />
            <Item label={es.fields.affiliation} value={record.affiliation} />
          </dl>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold">{es.record.history}</h2>
            {isIntake && !showsClinical && (
              <span className="inline-flex items-center gap-2 text-base text-muted">
                <Lock />
                {es.record.noClinicalHere}
              </span>
            )}
          </div>
          {visits.length === 0 ? (
            <p className="mt-4 text-muted">{es.record.noVisits}</p>
          ) : (
            <ol className="mt-4 space-y-6 border-l-2 border-line pl-6">
              {visits.map((v, i) => (
                <VisitItem key={v.id} visit={v} first={i === 0} />
              ))}
            </ol>
          )}
        </Card>
      </div>
    </Page>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-base text-muted">{label}</dt>
      <dd className="text-lg font-bold">{value || es.common.none}</dd>
    </div>
  );
}

function VisitItem({ visit, first }: { visit: VisitWithSteps; first: boolean }) {
  const isToday = visit.date === todayIso();
  const hasData = visit.services.some((s) => s.data !== null);
  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className={`absolute -left-[33px] top-1.5 h-4 w-4 rounded-full border-2 ${first ? "border-brand bg-brand" : "border-muted bg-white"}`}
      />
      <p className="text-lg">
        <strong className={isToday ? "text-brand-strong" : ""}>
          {isToday ? `${es.common.today}, ` : ""}
          {formatShortDate(visit.date)}
        </strong>
        <span className="text-base text-muted">
          {" · "}
          {visit.campaignName}
          {visit.folio ? ` · ${es.record.folio(visit.folio)}` : ""}
        </span>
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {visit.services.map((s) => (
          <li key={s.id} className="rounded-md bg-[#f3ebe8] px-3 py-1 text-base font-semibold">
            {es.services[s.type]}
          </li>
        ))}
      </ul>
      {visit.steps && visit.steps.length > 0 && (
        <div className="mt-2">
          <StepChips steps={visit.steps} />
        </div>
      )}
      {hasData ? (
        <div className="mt-3 space-y-2">
          {visit.services.map((s) => (s.data ? <ServiceResult key={s.id} service={s} data={s.data} /> : null))}
        </div>
      ) : (
        visit.services.length > 0 && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-[#f3ebe8] px-4 py-3 text-base font-semibold text-muted">
            <Lock />
            {es.record.onlyClinician}
          </p>
        )
      )}
    </li>
  );
}

function ServiceResult({ service, data }: { service: ServiceView; data: Record<string, string> }) {
  const { birads, nextStep } = data;
  const isBreast = service.type === "BREAST_REVIEW" && (birads !== undefined || nextStep !== undefined);
  const sections = recordSections(service.type, data, isBreast ? ["birads", "nextStep"] : []);

  if (!isBreast && sections.length === 0) {
    return (
      <p className="rounded-xl bg-blush px-4 py-3 text-base">
        {es.services[service.type]}: {es.record.noResults}
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-xl bg-blush px-4 py-3">
      {isBreast ? (
        <>
          {birads !== undefined && (
            <p className="text-lg">
              <strong className="text-brand-strong">{es.record.birads(birads)}</strong>
              {es.biradsLabel[birads] ? ` · ${es.biradsLabel[birads]}` : ""}
            </p>
          )}
          {nextStep !== undefined && (
            <p className="text-base">{es.record.nextStep(es.nextStepLabel[nextStep] ?? nextStep)}</p>
          )}
        </>
      ) : (
        <p className="font-bold">{es.services[service.type]}</p>
      )}
      {sections.map((section) => (
        <section key={section.role}>
          <h4 className="text-base font-bold text-brand-strong">{es.record.sectionTitle[section.role]}</h4>
          <dl className="text-base">
            {section.items.map((item) => (
              <div key={item.key}>
                <dt className="inline font-semibold">{item.label}: </dt>
                <dd className="inline">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
