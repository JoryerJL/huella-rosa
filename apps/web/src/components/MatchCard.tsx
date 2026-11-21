import type { ReactNode } from "react";
import type { MatchCandidate } from "@er/shared";
import { es } from "../i18n/es";
import { formatBirthDate, formatShortDate } from "../lib/format";
import { Check, Chip, EiraIdBadge, Warn } from "./ui";

/** One candidate from the search: strength as text + icon (never color alone), reasons and last visit. */
export function MatchCard({ candidate, action }: { candidate: MatchCandidate; action: ReactNode }) {
  const { patient, strength, reasons } = candidate;
  const strong = strength === "STRONG";
  const details = [
    es.matches.born(formatBirthDate(patient.birthDate)),
    patient.phoneLast4 ? es.matches.phoneLast4(patient.phoneLast4) : es.matches.noPhone,
    es.common.visitsCount(patient.visitCount),
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-4 rounded-2xl border-2 border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold">{patient.fullName}</h2>
          <EiraIdBadge formId={patient.formId} />
          <span
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-base font-semibold ${
              strong ? "bg-green-100 text-ok" : "bg-amber-100 text-warn"
            }`}
          >
            {strong ? <Check /> : <Warn />}
            {strong ? es.matches.strong : es.matches.weak}
          </span>
        </div>
        <p className="text-base text-muted">{details.join(" · ")}</p>
        {reasons.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={es.matches.reasonsLabel}>
            {reasons.map((r) => (
              <li key={r}>
                <Chip>
                  <Check className="text-ok" />
                  {es.matches.reason[r]}
                </Chip>
              </li>
            ))}
          </ul>
        )}
        <p className="text-base text-muted">
          {patient.lastVisitDate
            ? es.matches.lastVisit(formatShortDate(patient.lastVisitDate), patient.lastCampaignName ?? "")
            : es.matches.noVisits}
        </p>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}
