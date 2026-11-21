import { useState } from "react";
import { Page } from "../components/Page";
import { Alert, Button, Card } from "../components/ui";
import { downloadCampaignPackage } from "../data/campaignPackage";
import { useOutboxSummary, usePackageStatus } from "../data/hooks";
import { useOnline } from "../lib/useOnline";
import { formatShortDate, todayIso } from "../lib/format";
import { es } from "../i18n/es";

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return date === todayIso() ? `${es.common.today.toLowerCase()} ${time}` : `${formatShortDate(date)} ${time}`;
}

/** Figma "09 · Paquete de jornada" (SPEC 6.1, 6.8 item 2). */
export function CampaignsPage() {
  const online = useOnline();
  const status = usePackageStatus();
  const outbox = useOutboxSummary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onDownload() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await downloadCampaignPackage();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const meta = status.meta;
  const daysLeft = meta ? Math.ceil((new Date(meta.expiresAt).getTime() - Date.now()) / DAY_MS) : 0;

  return (
    <Page title={es.package.title} subtitle={es.package.subtitle}>
      <div className="max-w-4xl space-y-4">
        <Card className="space-y-5">
          {meta ? (
            <>
              <h2 className="text-2xl font-bold">
                {meta.campaign.name} · {formatShortDate(meta.campaign.date)}
              </h2>
              <dl className="flex flex-wrap gap-x-12 gap-y-4">
                <div>
                  <dt className="text-muted">{es.package.patients}</dt>
                  <dd className="text-3xl font-bold">{status.patientCount}</dd>
                </div>
                <div>
                  <dt className="text-muted">{es.package.downloaded}</dt>
                  <dd className="text-3xl font-bold">{localDateTime(meta.generatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted">{es.package.expires}</dt>
                  <dd className={`text-3xl font-bold ${daysLeft <= 0 ? "text-danger" : ""}`}>
                    {es.package.expiresIn(localDateTime(meta.expiresAt), daysLeft)}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            status.loaded && <p className="text-lg">{es.package.none}</p>
          )}
          <Button onClick={onDownload} disabled={!online || busy}>
            {busy ? es.package.downloading : meta ? es.package.downloadAgain : es.package.download}
          </Button>
          {!online && <p className="text-base text-muted">{es.package.needsSignal}</p>}
        </Card>

        {done && <Alert tone="ok">{es.package.downloadedOk}</Alert>}
        {error && <Alert>{error}</Alert>}
        {meta && daysLeft <= 0 ? <Alert>{es.package.expiredSearch}</Alert> : <Alert tone="warn">{es.package.expiredWarning}</Alert>}
        <Alert tone="ok">{es.package.privacy}</Alert>

        {outbox.failed.length > 0 && (
          <Card>
            <h2 className="text-xl font-bold">{es.package.failedTitle}</h2>
            <p className="mt-1 text-muted">{es.package.failedBody}</p>
            <ul className="mt-4 space-y-3">
              {outbox.failed.map((entry) => (
                <li key={entry.opId} className="rounded-xl bg-amber-50 px-4 py-3">
                  <strong>{es.visit.opLabel[entry.kind]}:</strong> {entry.message}
                  <span className="block text-base text-muted">{localDateTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}
