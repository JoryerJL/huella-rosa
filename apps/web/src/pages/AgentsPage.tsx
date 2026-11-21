import { useEffect, useState } from "react";
import type { AgentGrantView } from "@er/shared";
import { AdminPage, when } from "../components/AdminPage";
import { Alert, Button, Card } from "../components/ui";
import { fetchAgentGrants, revokeAgentGrant } from "../data/admin";
import { ApiError } from "../lib/http";
import { useOnline } from "../lib/useOnline";
import { useSession } from "../lib/session";
import { es } from "../i18n/es";

const t = es.agents;

const message = (error: unknown) => (error instanceof ApiError ? error.message : es.admin.loadError);

function GrantRow({ grant, showAccount, onChanged }: { grant: AgentGrantView; showAccount: boolean; onChanged: (g: AgentGrantView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = grant.revokedAt !== null;

  async function revoke() {
    if (!window.confirm(t.confirmRevoke(grant.clientName))) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await revokeAgentGrant(grant.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const detail = revoked
    ? t.revokedAt(when(grant.revokedAt))
    : `${t.connectedAt(when(grant.createdAt))} · ${grant.lastUsedAt ? t.lastUsed(when(grant.lastUsedAt)) : t.neverUsed}`;

  return (
    <li className="border-t border-line py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={`text-lg font-bold ${revoked ? "text-muted" : ""}`}>{grant.clientName}</p>
          {showAccount && <p className="text-base font-semibold text-brand-strong">{t.account(grant.userName)}</p>}
          <p className="text-base text-muted">{detail}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-base font-bold ${revoked ? "bg-[#f1eeee] text-muted" : "bg-green-50 text-ok"}`}>
          {revoked ? t.disconnected : t.connected}
        </span>
        {!revoked && (
          <Button variant="outline" onClick={revoke} disabled={busy}>
            {t.revoke}
          </Button>
        )}
      </div>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </li>
  );
}

/** "Agentes conectados" (SPEC 6.7): each person sees and disconnects their AI agents; admin sees all. Online only. */
export function AgentsPage() {
  const online = useOnline();
  const { profile } = useSession();
  const isAdmin = profile?.role === "admin";
  const [grants, setGrants] = useState<AgentGrantView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    fetchAgentGrants()
      .then(setGrants)
      .catch((e) => setError(message(e)));
  }, [online]);

  const upsert = (grant: AgentGrantView) => setGrants((list) => (list ?? []).map((g) => (g.id === grant.id ? grant : g)));

  const groups = [
    { title: t.activeGroup, items: (grants ?? []).filter((g) => g.revokedAt === null) },
    { title: t.revokedGroup, items: (grants ?? []).filter((g) => g.revokedAt !== null) },
  ];

  return (
    <AdminPage title={t.title} subtitle={isAdmin ? t.subtitleAdmin : t.subtitle}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Card className="flex-1">
          <h2 className="text-2xl font-bold">{isAdmin ? t.listTitleAdmin : t.listTitle}</h2>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          {grants === null && !error && <p className="mt-3 text-muted">{es.common.loading}</p>}
          {grants?.length === 0 && <p className="mt-3 text-muted">{t.empty}</p>}
          {groups.map(
            (group) =>
              group.items.length > 0 && (
                <section key={group.title} className="mt-4">
                  <h3 className="text-lg font-bold text-brand-strong">{group.title}</h3>
                  <ul>
                    {group.items.map((g) => (
                      <GrantRow key={g.id} grant={g} showAccount={isAdmin && !g.isMine} onChanged={upsert} />
                    ))}
                  </ul>
                </section>
              ),
          )}
        </Card>
        <Card className="lg:w-[440px] lg:shrink-0">
          <h2 className="text-2xl font-bold">{t.howTitle}</h2>
          <div className="mt-4 space-y-2 rounded-xl bg-green-50 p-4 text-ok">
            {t.howSteps.map((step) => (
              <p key={step} className="text-base">
                {step}
              </p>
            ))}
            <p className="text-base">{t.howNote}</p>
          </div>
        </Card>
      </div>
    </AdminPage>
  );
}
