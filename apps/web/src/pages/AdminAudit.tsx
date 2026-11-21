import { useEffect, useState } from "react";
import { Page } from "../components/Page";
import { api } from "../lib/api";
import { es } from "../i18n/es";

interface Entry {
  id: number;
  at: string;
  actorId: string;
  action: string;
  deviceId: string | null;
  detail: string | null;
}

export function AdminAudit() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.api.audit
      .$get({ query: {} })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { entries: Entry[] };
        setEntries(data.entries);
      })
      .catch(() => setError(es.audit.loadError));
  }, []);

  return (
    <Page title={es.audit.title} subtitle={es.audit.subtitle}>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-danger">{error}</p>}
      {entries && entries.length === 0 && <p className="text-muted">{es.audit.empty}</p>}
      {entries && entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-base">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-3">{es.audit.when}</th>
                <th className="px-4 py-3">{es.audit.who}</th>
                <th className="px-4 py-3">{es.audit.action}</th>
                <th className="px-4 py-3">{es.audit.device}</th>
                <th className="px-4 py-3">{es.audit.detail}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(e.at).toLocaleString("es-MX")}</td>
                  <td className="px-4 py-3">{e.actorId}</td>
                  <td className="px-4 py-3 font-mono">{e.action}</td>
                  <td className="px-4 py-3 font-mono text-sm">{e.deviceId?.slice(0, 8) ?? "—"}</td>
                  <td className="px-4 py-3">{e.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
