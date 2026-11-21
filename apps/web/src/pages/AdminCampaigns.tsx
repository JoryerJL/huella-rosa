import { useEffect, useState, type FormEvent } from "react";
import { defaultCampaignName, type CampaignListItem, type CampaignStatus, type LocalityView } from "@er/shared";
import { AdminPage } from "../components/AdminPage";
import { Alert, Button, Card, TextField } from "../components/ui";
import { createCampaign, fetchAdminCampaigns, fetchLocalities, updateCampaign } from "../data/admin";
import { ApiError } from "../lib/http";
import { formatShortDate } from "../lib/format";
import { useOnline } from "../lib/useOnline";
import { es } from "../i18n/es";

const t = es.admin.campaigns;

const message = (error: unknown) => (error instanceof ApiError ? error.message : es.admin.loadError);

const STATUS_CLASS: Record<CampaignStatus, string> = {
  UPCOMING: "bg-amber-50 text-warn",
  ACTIVE: "bg-green-50 text-ok",
  FINISHED: "bg-[#f1eeee] text-muted",
};

function dateRange(c: CampaignListItem) {
  return c.date === c.endDate ? formatShortDate(c.date) : `${formatShortDate(c.date)} – ${formatShortDate(c.endDate)}`;
}

const signal = (l: LocalityView) => (l.hasSignal ? t.withSignal : t.withoutSignal);

interface NewLocality {
  name: string;
  hasSignal: boolean;
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="mt-2 flex gap-2">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`min-h-12 rounded-full px-5 text-lg font-bold ${
            value === v ? "bg-brand text-white" : "border-2 border-line bg-white hover:bg-blush"
          }`}
        >
          {v ? t.yes : t.no}
        </button>
      ))}
    </div>
  );
}

function CampaignForm({
  localities,
  editing,
  onSaved,
  onCancel,
}: {
  localities: LocalityView[];
  editing: CampaignListItem | null;
  onSaved: (c: CampaignListItem, created: boolean) => void;
  onCancel: () => void;
}) {
  const [municipality, setMunicipality] = useState(editing?.municipality ?? "");
  const [state, setState] = useState(editing?.state ?? "");
  const [selected, setSelected] = useState<string[]>(editing?.localityIds ?? []);
  const [newLocalities, setNewLocalities] = useState<NewLocality[]>([]);
  const [date, setDate] = useState(editing?.date ?? "");
  const [endDate, setEndDate] = useState(editing?.endDate ?? "");
  // The name follows the place and month until the admin types their own.
  const [name, setName] = useState(editing?.name ?? "");
  const [nameTouched, setNameTouched] = useState(editing !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proposed = municipality.trim() && date ? defaultCampaignName(municipality, date) : "";
  const shownName = nameTouched ? name : proposed;

  const toggle = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const setNew = (i: number, patch: Partial<NewLocality>) =>
    setNewLocalities((list) => list.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: shownName.trim() || undefined,
      municipality,
      state,
      localityIds: selected,
      newLocalities: newLocalities.filter((l) => l.name.trim()),
      date,
      endDate,
    };
    try {
      const saved = editing ? await updateCampaign(editing.id, body) : await createCampaign(body);
      onSaved(saved, !editing);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lg:w-[460px] lg:shrink-0">
      <h2 className="text-2xl font-bold">{editing ? t.editTitle : t.newTitle}</h2>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t.municipality} value={municipality} onChange={(e) => setMunicipality(e.target.value)} required />
          <TextField label={t.state} value={state} onChange={(e) => setState(e.target.value)} required />
        </div>
        <fieldset>
          <legend className="text-base font-semibold">{t.localitiesLabel}</legend>
          <ul className="mt-2 space-y-2">
            {localities.map((l) => (
              <li key={l.id}>
                <label className="flex min-h-12 items-center gap-3 text-lg">
                  <input
                    type="checkbox"
                    className="size-6 accent-[var(--color-brand)]"
                    checked={selected.includes(l.id)}
                    onChange={() => toggle(l.id)}
                  />
                  <span>{l.name}</span>
                  <span className="text-base text-muted">· {signal(l)}</span>
                </label>
              </li>
            ))}
          </ul>
          {newLocalities.map((l, i) => (
            <div key={i} className="mt-3 space-y-2 rounded-xl bg-blush p-3">
              <TextField
                label={t.newLocality}
                placeholder={t.newLocalityPlaceholder}
                value={l.name}
                onChange={(e) => setNew(i, { name: e.target.value })}
              />
              <div>
                <span className="text-base font-semibold">{t.hasSignal}</span>
                <YesNo value={l.hasSignal} onChange={(hasSignal) => setNew(i, { hasSignal })} />
              </div>
              <button
                type="button"
                className="text-base font-semibold text-brand-strong underline"
                onClick={() => setNewLocalities((list) => list.filter((_, j) => j !== i))}
              >
                {t.removeLocality}
              </button>
            </div>
          ))}
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => setNewLocalities((list) => [...list, { name: "", hasSignal: false }])}
          >
            {t.addLocality}
          </Button>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <TextField label={t.endDate} type="date" value={endDate} min={date || undefined} onChange={(e) => setEndDate(e.target.value)} required />
        </div>
        <div>
          <TextField
            label={t.name}
            value={shownName}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
          />
          <p className="mt-1 text-base text-muted">{t.nameHint}</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t.saving : editing ? t.save : t.create}
        </Button>
        {editing && (
          <Button variant="secondary" className="w-full" onClick={onCancel}>
            {t.cancelEdit}
          </Button>
        )}
      </form>
    </Card>
  );
}

/** "Jornadas": admin creates campaigns and edits them while not finished (SPEC 6.0). Online only. */
export function AdminCampaigns() {
  const online = useOnline();
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [localities, setLocalities] = useState<LocalityView[]>([]);
  const [editing, setEditing] = useState<CampaignListItem | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    const [list, locs] = await Promise.all([fetchAdminCampaigns(), fetchLocalities()]);
    setCampaigns(list);
    setLocalities(locs);
  }

  useEffect(() => {
    if (!online) return;
    reload().catch((e) => setError(message(e)));
  }, [online]);

  function startEdit(c: CampaignListItem | null) {
    setEditing(c);
    setNotice(null);
    setFormKey((k) => k + 1);
  }

  async function saved(_c: CampaignListItem, created: boolean) {
    setNotice(created ? t.created : t.updated);
    setEditing(null);
    setFormKey((k) => k + 1);
    await reload().catch((e) => setError(message(e)));
  }

  return (
    <AdminPage title={t.title} subtitle={t.subtitle}>
      <div className="space-y-4">
        {notice && <Alert tone="ok">{notice}</Alert>}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <Card className="flex-1">
            <h2 className="text-2xl font-bold">{t.listTitle}</h2>
            {error && <div className="mt-3"><Alert>{error}</Alert></div>}
            {campaigns === null && !error && <p className="mt-3 text-muted">{es.common.loading}</p>}
            {campaigns?.length === 0 && <p className="mt-3 text-muted">{t.empty}</p>}
            <ul className="mt-2">
              {(campaigns ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 border-t border-line py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xl font-bold">{c.name}</p>
                    <p className="text-base text-muted">
                      {[c.municipality, c.state].filter(Boolean).join(", ")} · {dateRange(c)}
                    </p>
                    <p className="text-base text-muted">
                      {t.localities(c.localities.map((l) => `${l.name} (${signal(l)})`).join(" · "))}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-base font-bold ${STATUS_CLASS[c.status]}`}>
                    {t.status[c.status]}
                  </span>
                  {c.status !== "FINISHED" && (
                    <Button variant="outline" onClick={() => startEdit(c)}>
                      {t.edit}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <CampaignForm
            key={formKey}
            localities={localities}
            editing={editing}
            onSaved={saved}
            onCancel={() => startEdit(null)}
          />
        </div>
      </div>
    </AdminPage>
  );
}
