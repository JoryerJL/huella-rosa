import { Page } from "../components/Page";
import { es } from "../i18n/es";

export function Intake() {
  return (
    <Page title={es.intake.title} subtitle={es.intake.subtitle}>
      <p className="rounded-xl border-2 border-dashed border-line bg-white p-6 text-muted">{es.intake.comingSoon}</p>
    </Page>
  );
}
