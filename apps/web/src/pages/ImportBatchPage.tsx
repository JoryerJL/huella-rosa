import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  IMPORT_FIELDS,
  patientSlug,
  type ImportBatchView,
  type ImportField,
  type ImportRowDecisionInput,
  type ImportRowView,
} from "@er/shared";
import { Page } from "../components/Page";
import { MatchCard } from "../components/MatchCard";
import { Alert, BackArrow, Button, Card, Check, Plus, Warn, buttonClass, inputClass } from "../components/ui";
import { confirmImportMapping, decideImportRow, getImportBatch, registerAllNewRows } from "../data/imports";
import { formatShortDate } from "../lib/format";
import { useOnline } from "../lib/useOnline";
import { es } from "../i18n/es";

function BackToImports() {
  return (
    <Link to="/intake/import" className={buttonClass("secondary")}>
      <BackArrow />
      {es.common.back}
    </Link>
  );
}

function SuggestedTag() {
  return <span className="rounded-md bg-brand-soft px-2 py-0.5 text-base font-bold text-brand-strong">{es.imports.suggested}</span>;
}

/** Frame "13b · Columnas": the person confirms which field each column feeds. */
function ColumnsStep({ batch, onDone }: { batch: ImportBatchView; onDone: (b: ImportBatchView) => void }) {
  const [fields, setFields] = useState<Record<number, ImportField | null>>(() =>
    Object.fromEntries(batch.mapping.columns.map((c) => [c.index, c.field])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const columns = batch.mapping.columns.map((c) => ({ index: c.index, field: fields[c.index] ?? null }));
      onDone(await confirmImportMapping(batch.id, columns));
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={es.imports.columnsTitle} subtitle={es.imports.columnsSubtitle(batch.fileName ?? "")} actions={<BackToImports />}>
      <p className="mb-5 flex flex-wrap items-center gap-2 text-lg text-muted">
        <SuggestedTag /> {es.imports.suggestedLegend}
      </p>
      <Card className="overflow-x-auto py-2">
        <table className="w-full text-left text-lg">
          <thead>
            <tr className="text-base text-muted">
              <th className="py-3 pr-4 font-bold">{es.imports.columnHeader}</th>
              <th className="py-3 pr-4 font-bold">{es.imports.exampleHeader}</th>
              <th className="py-3 font-bold">{es.imports.fieldHeader}</th>
            </tr>
          </thead>
          <tbody>
            {batch.mapping.columns.map((column) => {
              const value = fields[column.index] ?? null;
              const isSuggested = value !== null && value === column.suggested;
              return (
                <tr key={column.index} className="border-t border-line">
                  <td className="py-3 pr-4 font-bold">{column.header || "—"}</td>
                  <td className="py-3 pr-4 text-muted">{column.example ?? ""}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <select
                        aria-label={`${es.imports.fieldHeader}: ${column.header}`}
                        className={`${inputClass} mt-0 ${isSuggested ? "border-brand font-bold" : ""}`}
                        value={value ?? ""}
                        onChange={(e) =>
                          setFields((f) => ({ ...f, [column.index]: (e.target.value || null) as ImportField | null }))
                        }
                      >
                        <option value="">{es.imports.skipColumn}</option>
                        {IMPORT_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {es.imports.fieldLabel[field]}
                          </option>
                        ))}
                      </select>
                      {isSuggested && <SuggestedTag />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {error && (
        <div className="mt-5">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => void onConfirm()} disabled={busy}>
          <Check />
          {busy ? es.common.saving : es.imports.confirmColumns}
        </Button>
        <Link to="/intake/import" className={buttonClass("secondary")}>
          {es.imports.cancel}
        </Link>
      </div>
    </Page>
  );
}

/** One line of identification values, never the full phone number. */
function rowDetails(row: ImportRowView): string {
  const d = row.data;
  const phone = d.mobile ?? d.phone;
  return [
    es.imports.rowLine(row.rowNumber),
    d.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(d.birthDate) ? es.matches.born(formatShortDate(d.birthDate)) : null,
    d.birthState ?? null,
    d.formId ? es.matches.formId(d.formId) : null,
    phone ? es.matches.phoneLast4(phone.slice(-4)) : null,
    row.status === "INVALID" ? (d.residence ?? null) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function RowCard({ row, actions, children }: { row: ImportRowView; actions?: ReactNode; children?: ReactNode }) {
  return (
    <li className="space-y-4 rounded-2xl border-2 border-line bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold">{row.data.fullName ?? "—"}</p>
          <p className="text-lg text-muted">{rowDetails(row)}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
      </div>
      {children}
    </li>
  );
}

function SectionHeader({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mt-8 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-lg text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

function decisionLabel(row: ImportRowView) {
  if (row.decision === "REGISTERED") return es.imports.registered;
  if (row.decision === "IS_HER") return es.imports.addedToRecord;
  return es.imports.discarded;
}

/** Frame "13 · Revisar lote": rows grouped by what they need; every save is a person's click. */
function ReviewStep({ batch, setBatch }: { batch: ImportBatchView; setBatch: (b: ImportBatchView) => void }) {
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const groups = {
    new: batch.rows.filter((r) => r.status === "NEW"),
    match: batch.rows.filter((r) => r.status === "POSSIBLE_MATCH"),
    invalid: batch.rows.filter((r) => r.status === "INVALID"),
    done: batch.rows.filter((r) => r.status === "CONFIRMED" || r.status === "DISCARDED"),
  };

  async function decide(row: ImportRowView, decision: ImportRowDecisionInput) {
    setBusyRow(row.id);
    setError(null);
    setNotice(null);
    try {
      setBatch(await decideImportRow(batch.id, row.id, decision));
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusyRow(null);
    }
  }

  async function onRegisterAll() {
    setConfirmAll(false);
    setBusyRow("all");
    setError(null);
    try {
      const res = await registerAllNewRows(batch.id);
      setBatch(res.batch);
      setNotice(es.imports.registeredAll(res.registered, res.failed));
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusyRow(null);
    }
  }

  const busy = busyRow !== null;
  const discard = (row: ImportRowView) => (
    <Button variant="secondary" disabled={busy} onClick={() => void decide(row, { action: "discard" })}>
      {es.imports.discard}
    </Button>
  );

  return (
    <Page
      title={es.imports.reviewTitle(batch.fileName ?? "")}
      subtitle={es.imports.reviewSubtitle(batch.counts.total)}
      actions={<BackToImports />}
    >
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="ok">{notice}</Alert>}
      {batch.status === "DONE" && <Alert tone="ok">{es.imports.allDone}</Alert>}

      {groups.new.length > 0 && (
        <section>
          <SectionHeader
            title={es.imports.newTitle(groups.new.length)}
            body={es.imports.newBody}
            action={
              <Button disabled={busy} onClick={() => setConfirmAll(true)}>
                <Plus />
                {es.imports.registerAll(groups.new.length)}
              </Button>
            }
          />
          <ul className="space-y-3">
            {groups.new.map((row) => (
              <RowCard
                key={row.id}
                row={row}
                actions={
                  <>
                    <Button variant="outline" disabled={busy} onClick={() => void decide(row, { action: "register" })}>
                      <Plus />
                      {busyRow === row.id ? es.common.saving : es.imports.register}
                    </Button>
                    {discard(row)}
                  </>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {groups.match.length > 0 && (
        <section>
          <SectionHeader title={es.imports.matchTitle(groups.match.length)} body={es.imports.matchBody} />
          <ul className="space-y-3">
            {groups.match.map((row) => (
              <RowCard key={row.id} row={row}>
                {row.sameAsRows.map((same) => (
                  <p key={same.rowNumber} className="flex items-center gap-2 text-lg font-semibold text-warn">
                    <Warn />
                    {es.imports.sameAsRow(same.rowNumber)}
                  </p>
                ))}
                {row.candidates.length > 0 && (
                  <ul className="space-y-3">
                    {row.candidates.map((candidate) => (
                      <MatchCard
                        key={candidate.patient.id}
                        candidate={candidate}
                        action={
                          <Button
                            disabled={busy}
                            onClick={() => void decide(row, { action: "isHer", patientId: candidate.patient.id })}
                          >
                            <Check />
                            {es.imports.isHer}
                          </Button>
                        }
                      />
                    ))}
                  </ul>
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <p className="flex-1 text-lg text-muted">{es.imports.noneOfThem}</p>
                  <Button variant="outline" disabled={busy} onClick={() => void decide(row, { action: "register" })}>
                    <Plus />
                    {es.imports.otherPerson}
                  </Button>
                  {discard(row)}
                </div>
                {row.candidates.length > 0 && <p className="text-lg text-muted">{es.imports.isHerNote}</p>}
              </RowCard>
            ))}
          </ul>
        </section>
      )}

      {groups.invalid.length > 0 && (
        <section>
          <SectionHeader title={es.imports.invalidTitle(groups.invalid.length)} body={es.imports.invalidBody} />
          <ul className="space-y-3">
            {groups.invalid.map((row) => (
              <RowCard key={row.id} row={row} actions={discard(row)}>
                <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-lg font-bold text-warn">
                  <Warn />
                  {row.reason}
                </p>
              </RowCard>
            ))}
          </ul>
        </section>
      )}

      {groups.done.length > 0 && (
        <section>
          <SectionHeader title={es.imports.doneTitle(groups.done.length)} body="" />
          <ul className="space-y-3">
            {groups.done.map((row) => (
              <RowCard
                key={row.id}
                row={row}
                actions={
                  <>
                    <span className={`text-lg font-bold ${row.decision === "DISCARDED" ? "text-muted" : "text-ok"}`}>
                      {decisionLabel(row)}
                    </span>
                    {row.patientId && (
                      <Link to={`/patients/${patientSlug({ id: row.patientId, formId: rowFormId(row) })}`} className={buttonClass("secondary")}>
                        {es.imports.openRecord}
                      </Link>
                    )}
                  </>
                }
              />
            ))}
          </ul>
        </section>
      )}

      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-labelledby="confirm-all-title">
          <div className="w-full max-w-xl space-y-4 rounded-2xl border-2 border-line bg-white p-8">
            <h2 id="confirm-all-title" className="text-2xl font-bold">
              {es.imports.confirmAllTitle(groups.new.length)}
            </h2>
            <p className="text-lg text-muted">
              {groups.new.map((r) => r.data.fullName).join(", ")}. {es.imports.confirmAllBody}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void onRegisterAll()}>
                <Check />
                {es.imports.confirmAllYes(groups.new.length)}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmAll(false)}>
                {es.imports.cancel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

/** /intake/import/:id — column mapping first when needed, then the review. */
export function ImportBatchPage() {
  const { id = "" } = useParams();
  const online = useOnline();
  const [batch, setBatch] = useState<ImportBatchView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    getImportBatch(id)
      .then(setBatch)
      .catch((err) => setError(err instanceof Error ? err.message : es.errors.generic));
  }, [id, online]);

  if (!online) {
    return (
      <Page title={es.imports.title} actions={<BackToImports />}>
        <Alert tone="warn">{es.imports.offline}</Alert>
      </Page>
    );
  }
  if (!batch) {
    return (
      <Page title={es.imports.title} actions={<BackToImports />}>
        {error ? <Alert>{error}</Alert> : <p className="text-lg text-muted">{es.common.loading}</p>}
      </Page>
    );
  }
  return batch.needsMapping ? <ColumnsStep batch={batch} onDone={setBatch} /> : <ReviewStep batch={batch} setBatch={setBatch} />;
}

/** EIRA ID of the record a decided row points to: the matched patient's, else the one in the row. */
function rowFormId(row: ImportRowView): string | null {
  const matched = row.candidates.find((c) => c.patient.id === row.patientId);
  return matched?.patient.formId ?? row.data.formId ?? null;
}
