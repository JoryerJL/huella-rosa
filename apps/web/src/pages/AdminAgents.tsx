import { useEffect, useState, type FormEvent } from "react";
import type { AgentTokenView } from "@er/shared";
import { AdminPage, when } from "../components/AdminPage";
import { Alert, Button, Card, TextField } from "../components/ui";
import { createAgentToken, fetchAgentTokens, revokeAgentToken } from "../data/admin";
import { ApiError } from "../lib/http";
import { useOnline } from "../lib/useOnline";
import { es } from "../i18n/es";

const t = es.admin.agents;

const message = (error: unknown) => (error instanceof ApiError ? error.message : es.admin.loadError);

function AgentRow({ agent, onChanged }: { agent: AgentTokenView; onChanged: (a: AgentTokenView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = agent.revokedAt !== null;

  async function revoke() {
    if (!window.confirm(t.confirmRevoke(agent.name))) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await revokeAgentToken(agent.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-line py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={`text-lg font-bold ${revoked ? "text-muted" : ""}`}>{agent.name}</p>
          <p className="text-base text-muted">{revoked ? t.revokedAt(when(agent.revokedAt)) : t.createdAt(when(agent.createdAt))}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-base font-bold ${revoked ? "bg-[#f1eeee] text-muted" : "bg-green-50 text-ok"}`}
        >
          {revoked ? t.revokedGroup : t.activeGroup}
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

function NewAgentForm({ onCreated }: { onCreated: (a: AgentTokenView) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once, right after creating; never stored.
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    try {
      const result = await createAgentToken(name);
      onCreated(result.agentToken);
      setCreated({ name: result.agentToken.name, token: result.token });
      setName("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="lg:w-[440px] lg:shrink-0">
      <h2 className="text-2xl font-bold">{t.formTitle}</h2>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <div>
          <TextField label={t.name} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" maxLength={60} />
          <p className="mt-1 text-base text-muted">{t.nameHint}</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t.saving : t.submit}
        </Button>
      </form>
      {created && (
        <div role="status" className="mt-4 rounded-xl bg-green-50 p-4 text-ok">
          <p className="text-lg font-bold">{t.created(created.name)}</p>
          <p className="mt-2 break-all rounded-lg bg-white p-3 font-mono text-lg text-ink">{created.token}</p>
          <p className="mt-2 text-base">{t.tokenOnce}</p>
          <Button className="mt-3 w-full" onClick={copy}>
            {copied ? t.copied : t.copy}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** "Agentes de IA": admin creates and revokes agent tokens for the MCP server (SPEC 6.7). Online only. */
export function AdminAgents() {
  const online = useOnline();
  const [agents, setAgents] = useState<AgentTokenView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    fetchAgentTokens()
      .then(setAgents)
      .catch((e) => setError(message(e)));
  }, [online]);

  const upsert = (agent: AgentTokenView) =>
    setAgents((list) => [agent, ...(list ?? []).filter((a) => a.id !== agent.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  const groups = [
    { title: t.activeGroup, items: (agents ?? []).filter((a) => a.revokedAt === null) },
    { title: t.revokedGroup, items: (agents ?? []).filter((a) => a.revokedAt !== null) },
  ];

  return (
    <AdminPage title={t.title} subtitle={t.subtitle}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Card className="flex-1">
          <h2 className="text-2xl font-bold">{t.listTitle}</h2>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          {agents === null && !error && <p className="mt-3 text-muted">{es.common.loading}</p>}
          {agents?.length === 0 && <p className="mt-3 text-muted">{t.empty}</p>}
          {groups.map(
            (group) =>
              group.items.length > 0 && (
                <section key={group.title} className="mt-4">
                  <h3 className="text-lg font-bold text-brand-strong">{group.title}</h3>
                  <ul>
                    {group.items.map((a) => (
                      <AgentRow key={a.id} agent={a} onChanged={upsert} />
                    ))}
                  </ul>
                </section>
              ),
          )}
        </Card>
        <NewAgentForm onCreated={upsert} />
      </div>
    </AdminPage>
  );
}
