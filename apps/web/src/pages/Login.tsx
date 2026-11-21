import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { ROLE_HOME } from "@er/shared";
import { login } from "../data/auth";
import { useSession } from "../lib/session";
import { useOnline } from "../lib/useOnline";
import { es } from "../i18n/es";
import { TopBar } from "../components/TopBar";
import { Alert, Button, Card, TextField } from "../components/ui";

const PIN_MAX = 6;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Figma "01 · Entrar" / "01b · Entrar — sin señal": username + PIN, never a staff list (SPEC 6.8). */
export function Login() {
  const { profile, signIn } = useSession();
  const online = useOnline();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (profile) return <Navigate to={ROLE_HOME[profile.role]} replace />;

  const press = (digit: string) => setPin((p) => (p.length < PIN_MAX ? p + digit : p));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(username, pin, online);
      if (result.ok) {
        signIn(result.profile, result.sessionSavedAt);
        return;
      }
      setError(result.error);
      setPin("");
    } catch {
      setError(es.login.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1.6fr_1fr]" noValidate>
          <div className="space-y-5">
            <div>
              <h1 className="text-3xl font-bold">{es.login.title}</h1>
              <p className="mt-2 text-muted">{es.login.subtitle}</p>
            </div>
            <TextField
              label={es.login.usernameLabel}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {error ? <Alert>{error}</Alert> : <Alert tone="ok">{es.login.pinNeverStored}</Alert>}
          </div>

          <Card className="h-fit space-y-5 text-center">
            <label className="block">
              <span className="text-xl font-bold">{es.login.pinLabel}</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                aria-describedby="pin-help"
                maxLength={PIN_MAX}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX))}
                className="mt-3 block min-h-14 w-full rounded-xl border-2 border-field bg-white px-4 text-center text-2xl tracking-[0.5em] focus:border-brand focus:outline-none"
              />
              <span id="pin-help" className="mt-2 block text-base text-muted">
                {es.login.pinDigits}
              </span>
            </label>

            <div className="mx-auto grid max-w-xs grid-cols-3 gap-3" aria-hidden="true">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  tabIndex={-1}
                  onClick={() => press(k)}
                  className="min-h-16 rounded-xl border-2 border-field bg-white text-2xl font-bold hover:bg-surface"
                >
                  {k}
                </button>
              ))}
              <span />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => press("0")}
                className="min-h-16 rounded-xl border-2 border-field bg-white text-2xl font-bold hover:bg-surface"
              >
                0
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setPin((p) => p.slice(0, -1))}
                className="min-h-16 rounded-xl border-2 border-field bg-white text-base font-bold hover:bg-surface"
              >
                {es.login.clear}
              </button>
            </div>

            <Button type="submit" disabled={username.trim().length < 3 || pin.length < 4 || loading} className="w-full text-xl">
              {loading ? es.login.loading : es.login.submit}
            </Button>
            <Alert tone={online ? "ok" : "warn"}>{online ? es.login.onlineHint : es.login.offlineHint}</Alert>
          </Card>
        </form>
      </main>
    </div>
  );
}
