import type { VisitStepView } from "@er/shared";
import { es } from "../i18n/es";

const tone = {
  PENDING: "bg-gray-200 text-muted",
  DONE: "bg-green-100 text-ok",
  SKIPPED: "bg-amber-50 text-warn",
} as const;

/** "Nutrición: hecho", "Médico: pendiente"… for a visit's specialist steps (SPEC 6.3.1 item 5). */
export function StepChips({ steps }: { steps: VisitStepView[] | undefined }) {
  if (!steps || steps.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {steps.map((s) => (
        <li key={s.role} className={`rounded-full px-3 py-1 text-base font-semibold ${tone[s.status]}`}>
          {es.stepRole[s.role]}: {es.stepStatus[s.status]}
        </li>
      ))}
    </ul>
  );
}
