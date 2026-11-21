import { useCallback, useEffect, useState } from "react";
import type { AdminConflict } from "@er/shared";
import { AdminPage, when } from "../components/AdminPage";
import { Alert, Button, Card } from "../components/ui";
import { fetchConflicts, resolveConflict } from "../data/admin";
import { useOnline } from "../lib/useOnline";
import { useSession } from "../lib/session";
import { es } from "../i18n/es";

const t = es.admin.conflicts;

function ConflictCard({ conflict, onDone }: { conflict: AdminConflict; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: "server" | "device") {
    setBusy(true);
    setError(null);
    try {
      await resolveConflict(conflict.id, choice);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
      setBusy(false);
    }
  }

  const sides = [
    { key: "server" as const, title: t.saved, side: conflict.saved, action: t.keepSaved },
    {
      key: "device" as const,
      title: conflict.incoming.byName ? t.incoming(conflict.incoming.byName) : t.incomingNoName,
      side: conflict.incoming,
      action: t.keepIncoming,
    },
  ];

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">{conflict.fieldLabel}</h2>
        <p className="text-base text-muted">
          {[conflict.patientName && t.patient(conflict.patientName), conflict.folio && t.folio(conflict.folio)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {sides.map(({ key, title, side, action }) => (
          <div key={key} className="flex flex-col gap-3 rounded-xl border-2 border-line p-4">
            <span className="text-base font-semibold">{title}</span>
            <span className="text-base text-muted">{t.byWhen(key === "server" ? side.byName : null, when(side.at))}</span>
            <span className="text-2xl font-bold">{side.value || t.emptyValue}</span>
            <Button variant={key === "server" ? "outline" : "primary"} disabled={busy} onClick={() => void choose(key)}>
              {action}
            </Button>
          </div>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
    </Card>
  );
}

/** "Dos personas cambiaron el mismo dato" (SPEC 6.5): admin sees identification; specialists their own fields. */
export function AdminConflicts() {
  const online = useOnline();
  const { profile } = useSession();
  const [conflicts, setConflicts] = useState<AdminConflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    fetchConflicts()
      .then(setConflicts)
      .catch(() => setError(es.admin.loadError));
  }, []);
  useEffect(() => {
    if (online) load();
  }, [online, load]);

  return (
    <AdminPage title={t.title} subtitle={profile?.role === "admin" ? t.subtitle : t.clinicalSubtitle}>
      <div className="space-y-6">
        {saved && <Alert tone="ok">{t.done}</Alert>}
        {error && <Alert>{error}</Alert>}
        {conflicts && conflicts.length === 0 && <p className="text-lg text-muted">{t.empty}</p>}
        {conflicts?.map((c) => (
          <ConflictCard
            key={c.id}
            conflict={c}
            onDone={() => {
              setSaved(true);
              load();
            }}
          />
        ))}
      </div>
    </AdminPage>
  );
}
