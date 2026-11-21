import { Page } from "../components/Page";
import { es } from "../i18n/es";

export function Patients() {
  return (
    <Page title={es.patients.title} subtitle={es.patients.subtitle}>
      <p className="rounded-xl border-2 border-dashed border-line bg-white p-6 text-muted">{es.patients.comingSoon}</p>
    </Page>
  );
}
