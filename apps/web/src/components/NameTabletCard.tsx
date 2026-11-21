import { useState, type FormEvent } from "react";
import { getDeviceMeta } from "../data/db";
import { useLive } from "../data/hooks";
import { nameTablet } from "../data/folioPrefix";
import { useSession } from "../lib/session";
import { useOnline } from "../lib/useOnline";
import { es } from "../i18n/es";
import { Alert, Button, Card, TextField } from "./ui";

const t = es.nameTablet;
const LATER_KEY = "er.nameTablet.later";

function laterChosen(): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Figma "09b · Nombrar tableta": once the tablet is registered (first login with signal), intake
 * and specialists can give it a friendly name; the audit timeline shows it instead of an id.
 */
export function NameTabletCard() {
  const { profile } = useSession();
  const online = useOnline();
  const device = useLive(() => getDeviceMeta(), [], null);
  const [name, setName] = useState("");
  const [later, setLater] = useState(laterChosen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile || profile.role === "admin" || !online || !device || device.name || later) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await nameTablet(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  function onLater() {
    try {
      sessionStorage.setItem(LATER_KEY, "1");
    } catch {
      // Private mode: the card simply comes back on the next screen.
    }
    setLater(true);
  }

  return (
    <Card className="mb-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold">{t.title}</h2>
        <p className="mt-1 text-lg text-muted">{t.body}</p>
      </div>
      <form className="flex flex-wrap items-end gap-4" onSubmit={onSubmit}>
        <TextField
          className="min-w-64 flex-1"
          label={t.label}
          placeholder={t.placeholder}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={busy || name.trim().length < 2}>
          {busy ? es.common.saving : t.save}
        </Button>
        <Button variant="secondary" onClick={onLater}>
          {t.later}
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
    </Card>
  );
}
