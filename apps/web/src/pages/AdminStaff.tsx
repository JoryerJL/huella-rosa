import { useEffect, useState, type FormEvent } from "react";
import { ROLES, type Role, type StaffView } from "@er/shared";
import { AdminPage } from "../components/AdminPage";
import { Alert, Button, Card, TextField } from "../components/ui";
import { createStaff, fetchStaff, setStaffActive } from "../data/admin";
import { ApiError } from "../lib/http";
import { useOnline } from "../lib/useOnline";
import { useSession } from "../lib/session";
import { es, roleLabel } from "../i18n/es";

const t = es.admin.staff;

// Order of the groups on screen: field staff first, administration last.
const ROLE_ORDER: Role[] = ["intake", "nutritionist", "doctor", "pathologist", "admin"];

const message = (error: unknown) => (error instanceof ApiError ? error.message : es.admin.loadError);

function StatusChip({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-base font-bold ${active ? "bg-green-50 text-ok" : "bg-[#f1eeee] text-muted"}`}
    >
      {active ? t.active : t.inactive}
    </span>
  );
}

function StaffRow({ person, isMe, onChanged }: { person: StaffView; isMe: boolean; onChanged: (p: StaffView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (person.active && !window.confirm(t.confirmDeactivate(person.name))) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await setStaffActive(person.id, !person.active));
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
          <p className={`text-lg font-bold ${person.active ? "" : "text-muted"}`}>
            {person.name} {isMe && <span className="font-normal text-muted">({t.you})</span>}
          </p>
          <p className="text-base text-muted">{t.username(person.username)}</p>
        </div>
        <StatusChip active={person.active} />
        {!isMe && (
          <Button variant="outline" onClick={toggle} disabled={busy}>
            {person.active ? t.deactivate : t.reactivate}
          </Button>
        )}
      </div>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </li>
  );
}

function NewStaffForm({ onCreated }: { onCreated: (p: StaffView) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("intake");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once, right after creating; never stored.
  const [created, setCreated] = useState<{ name: string; pin: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const person = await createStaff({ name, username, role, pin });
      onCreated(person);
      setCreated({ name: person.name, pin });
      setName("");
      setUsername("");
      setPin("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lg:w-[440px] lg:shrink-0">
      <h2 className="text-2xl font-bold">{t.formTitle}</h2>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <TextField label={t.name} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
        <div>
          <TextField
            label={t.usernameLabel}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <p className="mt-1 text-base text-muted">{t.usernameHint}</p>
        </div>
        <fieldset>
          <legend className="text-base font-semibold">{t.role}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                className={`min-h-12 rounded-full px-4 text-lg font-bold ${
                  role === r ? "bg-brand text-white" : "border-2 border-line bg-white hover:bg-blush"
                }`}
              >
                {roleLabel[r]}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <TextField
            label={t.pin}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="off"
            required
          />
          <p className="mt-1 text-base text-muted">{t.pinHint}</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t.saving : t.submit}
        </Button>
      </form>
      {created && (
        <div role="status" className="mt-4 rounded-xl bg-green-50 p-4 text-ok">
          <p className="text-lg font-bold">{t.created(created.name)}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{t.createdPin(created.pin)}</p>
          <p className="mt-1 text-base">{t.pinOnce}</p>
        </div>
      )}
    </Card>
  );
}

/** "Personal": admin creates, deactivates and reactivates staff (SPEC 6.0). Online only. */
export function AdminStaff() {
  const online = useOnline();
  const { profile } = useSession();
  const [staff, setStaff] = useState<StaffView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    fetchStaff()
      .then(setStaff)
      .catch((e) => setError(message(e)));
  }, [online]);

  const upsert = (person: StaffView) =>
    setStaff((list) => [...(list ?? []).filter((p) => p.id !== person.id), person].sort((a, b) => a.name.localeCompare(b.name)));

  return (
    <AdminPage title={t.title} subtitle={t.subtitle}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Card className="flex-1">
          <h2 className="text-2xl font-bold">{t.listTitle}</h2>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          {staff === null && !error && <p className="mt-3 text-muted">{es.common.loading}</p>}
          {staff?.length === 0 && <p className="mt-3 text-muted">{t.empty}</p>}
          {ROLE_ORDER.map((role) => {
            const people = (staff ?? []).filter((p) => p.role === role);
            if (people.length === 0) return null;
            return (
              <section key={role} className="mt-4">
                <h3 className="text-lg font-bold text-brand-strong">{roleLabel[role]}</h3>
                <ul>
                  {people.map((p) => (
                    <StaffRow key={p.id} person={p} isMe={p.id === profile?.id} onChanged={upsert} />
                  ))}
                </ul>
              </section>
            );
          })}
        </Card>
        <NewStaffForm onCreated={upsert} />
      </div>
    </AdminPage>
  );
}
