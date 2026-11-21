import { useCallback, useEffect, useState } from "react";
import type { AdminMatch, AdminMatchPatient } from "@er/shared";
import { AdminPage, when } from "../components/AdminPage";
import { Alert, Button, Card, Chip } from "../components/ui";
import { dismissMatch, fetchMatches, linkMatch } from "../data/admin";
import { useOnline } from "../lib/useOnline";
import { formatBirthDate } from "../lib/format";
import { es } from "../i18n/es";

const t = es.admin.matches;

const ROWS: { key: keyof AdminMatchPatient; label: string; date?: boolean }[] = [
  { key: "fullName", label: es.fields.fullName },
  { key: "birthDate", label: es.fields.birthDate, date: true },
  { key: "birthState", label: es.fields.birthState },
  { key: "formId", label: es.fields.formId },
  { key: "mobile", label: es.fields.mobile },
  { key: "phone", label: es.fields.phone },
  { key: "residence", label: es.fields.residence },
  { key: "localityName", label: "Localidad" },
  { key: "affiliation", label: es.fields.affiliation },
];

function value(p: AdminMatchPatient, row: (typeof ROWS)[number]): string {
  const raw = p[row.key];
  if (raw === null || raw === undefined || raw === "") return t.empty_value;
  return row.date ? formatBirthDate(String(raw)) : String(raw);
}

function MatchReview({ match, onDone }: { match: AdminMatch; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const differing = new Set(match.differing.map((k) => (k === "localityId" ? "localityName" : k)));

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
      setBusy(false);
    }
  }

  const keep = (p: AdminMatchPatient) => {
    if (!window.confirm(t.confirmLink)) return;
    void run(() => linkMatch(match.id, p.id), t.linked);
  };

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <span className="font-semibold">{t.why}:</span>
        {match.reasons.map((r) => (
          <Chip key={r}>{es.matches.reason[r]}</Chip>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-lg">
          <thead>
            <tr>
              <th className="w-1/4 py-2" />
              {[match.a, match.b].map((p) => (
                <th key={p.id} className="py-2 pr-4 align-top text-base font-normal text-muted">
                  {t.registeredBy(p.registeredByName ?? es.admin.audit.someone, when(p.registeredAt))}
                  <span className="block">{t.visits(p.visitCount)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const differs = differing.has(row.key);
              return (
                <tr key={row.key} className="border-t border-line">
                  <td className="py-3 pr-4 text-base font-semibold">{row.label}</td>
                  {[match.a, match.b].map((p) => (
                    <td key={p.id} className={`py-3 pr-4 ${differs ? "bg-amber-50 font-semibold text-warn" : ""}`}>
                      {value(p, row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {match.differing.length > 0 && <p className="text-base text-muted">{t.differLegend}</p>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 rounded-xl bg-green-50 px-4 py-3 font-semibold text-ok">{t.safeNote}</p>
        <Button variant="outline" disabled={busy} onClick={() => void run(() => dismissMatch(match.id), t.dismissed)}>
          {t.notSame}
        </Button>
        {/* The record that was already there (A) stays as the main record; both are kept. */}
        <Button disabled={busy} onClick={() => keep(match.a)}>
          {t.link}
        </Button>
      </div>
    </Card>
  );
}

/** "¿Es la misma persona?" (SPEC 6.5.5): a person decides; linking keeps both records. */
export function AdminMatches() {
  const online = useOnline();
  const [matches, setMatches] = useState<AdminMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchMatches()
      .then(setMatches)
      .catch(() => setError(es.admin.loadError));
  }, []);
  useEffect(() => {
    if (online) load();
  }, [online, load]);

  return (
    <AdminPage title={t.title} subtitle={t.subtitle}>
      <div className="space-y-6">
        {notice && <Alert tone="ok">{notice}</Alert>}
        {error && <Alert>{error}</Alert>}
        {matches && matches.length === 0 && <p className="text-lg text-muted">{t.empty}</p>}
        {matches?.map((m) => (
          <MatchReview
            key={m.id}
            match={m}
            onDone={(message) => {
              setNotice(message);
              load();
            }}
          />
        ))}
      </div>
    </AdminPage>
  );
}
