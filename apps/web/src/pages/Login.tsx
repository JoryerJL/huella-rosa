import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { ROLE_HOME, type Role } from "@er/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useOnline } from "../lib/useOnline";
import { es, roleLabel } from "../i18n/es";
import { TopBar } from "../components/TopBar";

interface DemoUser {
  id: string;
  name: string;
  role: string;
}

export function Login() {
  const { profile, signIn } = useSession();
  const online = useOnline();
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.api.auth["demo-users"]
      .$get()
      .then((res) => res.json())
      .then((data) => setUsers(data.users))
      .catch(() => setError(es.login.offlineHint));
  }, []);

  if (profile) return <Navigate to={ROLE_HOME[profile.role]} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.api.auth.login.$post({ json: { userId, pin } });
      const data = (await res.json()) as { profile?: { id: string; name: string; role: Role }; error?: string };
      if (!res.ok || !data.profile) {
        setError(data.error ?? es.login.genericError);
        return;
      }
      signIn(data.profile);
    } catch {
      setError(es.login.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-xl px-6 py-10">
        <h1 className="text-3xl font-bold">{es.login.title}</h1>
        <p className="mt-2 text-muted">{es.login.subtitle}</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-6">
          <fieldset className="space-y-3">
            {users.map((u) => (
              <label
                key={u.id}
                className={`flex min-h-16 cursor-pointer items-center justify-between rounded-xl border-2 px-5 ${
                  userId === u.id ? "border-brand bg-brand-soft" : "border-line bg-white"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="user"
                    value={u.id}
                    checked={userId === u.id}
                    onChange={() => setUserId(u.id)}
                    className="h-6 w-6 accent-brand"
                  />
                  <span className="font-semibold">{u.name}</span>
                </span>
                <span className="text-muted">{roleLabel[u.role as Role] ?? u.role}</span>
              </label>
            ))}
          </fieldset>

          <label className="block">
            <span className="font-semibold">{es.login.pinLabel}</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="mt-2 block min-h-14 w-full rounded-xl border-2 border-line bg-white px-4 text-2xl tracking-widest focus:border-brand focus:outline-none"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!userId || pin.length < 4 || loading || !online}
            className="min-h-14 w-full rounded-xl bg-brand text-xl font-bold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {loading ? es.login.loading : es.login.submit}
          </button>
          <p className="text-center text-base text-muted">{online ? es.login.demoHint : es.login.offlineHint}</p>
        </form>
      </main>
    </div>
  );
}
