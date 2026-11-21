import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { ImportBatchSummary } from "@er/shared";
import { Page } from "../components/Page";
import { Alert, BackArrow, Card, Plus, buttonClass } from "../components/ui";
import { IMPORT_TEMPLATE_URL, listImportBatches, uploadImportFile } from "../data/imports";
import { useOnline } from "../lib/useOnline";
import { es } from "../i18n/es";

const pad = (n: number) => String(n).padStart(2, "0");

/** "Hoy 13:05" or "19 nov 17:29" in device time. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `${es.common.today} ${time}`;
  return `${d.getDate()} ${es.months[d.getMonth()]} ${time}`;
}

function StatusPill({ batch }: { batch: ImportBatchSummary }) {
  const [label, cls] = batch.needsMapping
    ? [es.imports.statusMapping, "bg-amber-100 text-warn"]
    : batch.status === "DONE"
      ? [es.imports.statusDone, "bg-green-100 text-ok"]
      : [es.imports.statusPending, "bg-amber-100 text-warn"];
  return <span className={`rounded-lg px-3 py-1 text-base font-bold ${cls}`}>{label}</span>;
}

function BackButton() {
  return (
    <Link to="/intake" className={buttonClass("secondary")}>
      <BackArrow />
      {es.common.back}
    </Link>
  );
}

/** /intake/import (frame "12 · Importar Excel"): template, upload and recent files. Online only. */
export function ImportPage() {
  const online = useOnline();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [batches, setBatches] = useState<ImportBatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!online) return;
    listImportBatches()
      .then((res) => setBatches(res.batches))
      .catch(() => setError(es.imports.loadError));
  }, [online]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const batch = await uploadImportFile(file);
      navigate(`/intake/import/${batch.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  if (!online) {
    return (
      <Page title={es.imports.title} actions={<BackButton />}>
        <Alert tone="warn">{es.imports.offline}</Alert>
      </Page>
    );
  }

  return (
    <Page title={es.imports.title} subtitle={es.imports.subtitle} actions={<BackButton />}>
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-2xl font-bold">{es.imports.templateTitle}</h2>
          <p className="text-lg text-muted">{es.imports.templateBody}</p>
          <a href={IMPORT_TEMPLATE_URL} download className={buttonClass("outline")}>
            {es.imports.templateButton}
          </a>
        </Card>
        <Card className="space-y-4">
          <h2 className="text-2xl font-bold">{es.imports.uploadTitle}</h2>
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-field bg-[#f3ebe8] p-5 text-center">
            <p className="text-lg text-muted">{es.imports.uploadHint}</p>
            <label className={buttonClass("primary", busy ? "pointer-events-none opacity-50" : "cursor-pointer")}>
              <Plus />
              {busy ? es.imports.uploading : es.imports.uploadButton}
              <input
                ref={input}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                disabled={busy}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
          </div>
        </Card>
      </div>

      {error && (
        <div className="mt-6">
          <Alert>{error}</Alert>
        </div>
      )}

      <h2 className="mt-10 text-2xl font-bold">{es.imports.batchesTitle}</h2>
      {batches === null ? (
        !error && <p className="mt-4 text-lg text-muted">{es.common.loading}</p>
      ) : batches.length === 0 ? (
        <p className="mt-4 text-lg text-muted">{es.imports.noBatches}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {batches.map((batch) => (
            <li key={batch.id} className="flex flex-col gap-4 rounded-2xl border-2 border-line bg-white p-5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xl font-bold">{batch.fileName ?? es.imports.title}</p>
                {batch.agentName && <p className="text-lg font-semibold text-brand-strong">{es.imports.proposedByAgent(batch.agentName)}</p>}
                <p className="text-lg text-muted">
                  {es.imports.batchLine(
                    formatWhen(batch.createdAt),
                    batch.needsMapping ? es.imports.rowsCount(batch.counts.total) : es.imports.summary(batch.counts),
                  )}
                </p>
              </div>
              <StatusPill batch={batch} />
              <Link
                to={`/intake/import/${batch.id}`}
                className={buttonClass(batch.status === "DONE" && !batch.needsMapping ? "secondary" : "primary")}
              >
                {batch.needsMapping ? es.imports.reviewColumns : batch.status === "DONE" ? es.imports.view : es.imports.review}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
