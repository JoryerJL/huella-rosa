import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { CampaignView, DashboardResponse } from "@er/shared";
import { AdminPage } from "../components/AdminPage";
import { Alert, Card, buttonClass, inputClass } from "../components/ui";
import { fetchDashboard } from "../data/admin";
import { listCampaigns } from "../data/patients";
import { useOnline } from "../lib/useOnline";
import { EiraCoBrand } from "../components/EiraCoBrand";
import { es, roleLabel } from "../i18n/es";

const t = es.admin.home;

function Stat({ label, value, to }: { label: string; value: number; to?: string }) {
  return (
    <Card className="flex flex-col gap-2">
      <span className="text-4xl font-bold">{value}</span>
      <span className="text-base text-muted">{label}</span>
      {to && value > 0 && (
        <Link to={to} className={buttonClass("outline", "mt-2 self-start")}>
          {t.review}
        </Link>
      )}
    </Card>
  );
}

/** "Tablero de la jornada": admin home (SPEC 6.6). */
export function AdminHome() {
  const online = useOnline();
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    listCampaigns()
      .then((list) => {
        setCampaigns(list);
        // Current campaign first: the most recent start date.
        const latest = [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
        setCampaignId((id) => id || latest?.id || "");
      })
      .catch(() => setError(es.admin.loadError));
  }, [online]);

  useEffect(() => {
    if (!online || !campaignId) return;
    setError(null);
    fetchDashboard(campaignId)
      .then(setData)
      .catch(() => setError(es.admin.loadError));
  }, [online, campaignId]);

  return (
    <AdminPage title={t.title} subtitle={t.subtitle}>
      <div className="space-y-6">
        <label className="block max-w-md">
          <span className="text-base font-semibold">{t.campaign}</span>
          <select className={inputClass} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {error && <Alert>{error}</Alert>}
        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t.patients} value={data.patients} />
              <Stat label={t.recurring} value={data.recurringRecognized} />
              <Stat label={t.matchesOpen} value={data.matchesOpen} to="/admin/matches" />
              <Stat label={t.conflictsOpen} value={data.conflictsOpen} to="/admin/conflicts" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Stat label={t.visits} value={data.visits} />
              <Stat label={t.matchesLinked} value={data.matchesLinked} />
            </div>
            <Card>
              <h2 className="text-2xl font-bold">{t.stations}</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-lg">
                  <thead>
                    <tr className="text-base text-muted">
                      <th className="py-2 pr-4">{t.station}</th>
                      <th className="py-2 pr-4">{t.pending}</th>
                      <th className="py-2 pr-4">{t.done}</th>
                      <th className="py-2 pr-4">{t.skipped}</th>
                      <th className="py-2">{t.avgMinutes}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.steps.map((s) => (
                      <tr key={s.role} className="border-t border-line">
                        <td className="py-3 pr-4 font-semibold">{roleLabel[s.role]}</td>
                        <td className="py-3 pr-4">{s.pending}</td>
                        <td className="py-3 pr-4">{s.done}</td>
                        <td className="py-3 pr-4">{s.skipped}</td>
                        <td className="py-3">{s.avgMinutes ?? t.noAvg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card>
              <h2 className="text-2xl font-bold">{t.byLocality}</h2>
              {data.pendingByLocality.length === 0 ? (
                <p className="mt-3 text-muted">{t.noneWaiting}</p>
              ) : (
                <ul className="mt-3 space-y-2 text-lg">
                  {data.pendingByLocality.map((l) => (
                    <li key={l.locality} className="flex justify-between border-t border-line pt-2">
                      <span>{l.locality}</span>
                      <strong>{l.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
        <footer className="border-t border-line pt-4">
          <EiraCoBrand />
        </footer>
      </div>
    </AdminPage>
  );
}
