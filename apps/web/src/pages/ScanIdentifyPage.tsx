import { useState } from "react";
import { useNavigate } from "react-router";
import { LOW_CONFIDENCE, type ScanView } from "@er/shared";
import { Page } from "../components/Page";
import { Alert, Button, Card, Check, Lock, Warn, buttonClass, inputClass } from "../components/ui";
import type { SearchDraft } from "../components/PatientSearchForm";
import { BackButton } from "./PatientRecordPage";
import { confirmScan, uploadScan } from "../data/scans";
import { compressImage, jpegName } from "../lib/imageCompress";
import { formatBirthDate } from "../lib/format";
import { useOnline } from "../lib/useOnline";
import { es } from "../i18n/es";

// "Identificar con foto" (SPEC 6.4, frame 06a): online only. Intake confirms the identification
// fields with the photo in view; confirming fills the search form and runs the normal search (6.2).

const ID_FIELDS = ["fullName", "birthDate", "formId", "birthState", "mobile", "phone", "residence"] as const;

/** Values as shown to intake: dates on paper order (DD/MM/AAAA). */
function initialValues(scan: ScanView): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ID_FIELDS) {
    const v = scan.fields[key]?.value ?? "";
    out[key] = key === "birthDate" && v ? formatBirthDate(v) : v;
  }
  return out;
}

/** Confirmed values -> the search form draft (name + birth date + one more datum). */
export function draftFromScan(values: Record<string, string>): SearchDraft {
  const [day = "", month = "", year = ""] = (values.birthDate ?? "").split(/[/.-]/).map((p) => p.trim());
  const phone = values.mobile?.trim() || values.phone?.trim();
  const extra = phone
    ? { extraKind: "phone" as const, extra: phone }
    : values.formId?.trim()
      ? { extraKind: "formId" as const, extra: values.formId.trim() }
      : { extraKind: "birthState" as const, extra: values.birthState?.trim() ?? "" };
  return {
    fullName: values.fullName?.trim() ?? "",
    day: day.replace(/\D/g, "").slice(0, 2),
    month: month.replace(/\D/g, "").slice(0, 2),
    year: year.replace(/\D/g, "").slice(0, 4),
    ...extra,
  };
}

export function ScanIdentifyPage() {
  const online = useOnline();
  const navigate = useNavigate();
  const [scan, setScan] = useState<ScanView | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await compressImage(file);
      const read = await uploadScan(blob, jpegName(file.name));
      setScan(read);
      setValues(initialValues(read));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : es.scan.uploadError);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    if (!scan) return;
    setBusy(true);
    setError(null);
    try {
      // Field names only reach the server's log; the values go through the normal search.
      await confirmScan(scan.id, ID_FIELDS.filter((k) => k in scan.fields && values[k]?.trim()));
      navigate("/intake", { state: { scanDraft: draftFromScan(values) } });
    } catch (err) {
      setError(err instanceof Error ? err.message : es.errors.generic);
      setBusy(false);
    }
  }

  const picker = (
    <label className={buttonClass(scan ? "secondary" : "primary", "w-full cursor-pointer text-xl")}>
      <CameraIcon />
      {busy && !scan ? es.scan.reading : scan ? es.scan.retake : es.scan.takePhoto}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={busy || !online}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );

  if (!online) {
    return (
      <Page title={es.scan.title} leading={<BackButton />}>
        <div className="max-w-2xl">
          <Alert tone="warn">{es.scan.needsSignal}</Alert>
        </div>
      </Page>
    );
  }

  if (!scan) {
    return (
      <Page title={es.scan.title} subtitle={es.scan.subtitle} leading={<BackButton />}>
        <div className="max-w-xl space-y-4">
          {picker}
          {error && <Alert>{error}</Alert>}
        </div>
      </Page>
    );
  }

  const shown = ID_FIELDS.filter((k) => k in scan.fields);
  const low = shown.filter((k) => scan.fields[k]!.value && scan.fields[k]!.confidence < LOW_CONFIDENCE);
  const nothingRead = shown.every((k) => !scan.fields[k]!.value);

  return (
    <Page title={es.scan.confirmTitle} subtitle={es.scan.confirmSubtitle} leading={<BackButton />}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <img
            src={scan.imageUrl}
            alt={es.scan.photoAlt}
            className="w-full rounded-2xl border-2 border-line bg-white object-contain"
          />
          {picker}
        </div>
        <div className="space-y-4">
          {low.length > 0 && (
            <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 font-semibold text-warn" role="status">
              <Warn />
              {es.scan.lowCount(low.length)}
            </p>
          )}
          {nothingRead && <Alert tone="warn">{es.scan.nothingRead}</Alert>}
          <Card className="grid gap-4 sm:grid-cols-2">
            {shown.map((key) => {
              const isLow = low.includes(key);
              return (
                <label key={key} className="block">
                  <span className="text-base font-semibold">{es.scan.fields[key] ?? key}</span>
                  <input
                    className={`${inputClass} ${isLow ? "border-amber-500 bg-amber-50" : ""}`}
                    value={values[key] ?? ""}
                    onChange={(e) => setValues((s) => ({ ...s, [key]: e.target.value }))}
                    autoComplete="off"
                  />
                  {isLow && (
                    <span className="mt-1 flex items-center gap-1 text-base font-semibold text-warn">
                      <Warn />
                      {es.scan.checkThis}
                    </span>
                  )}
                </label>
              );
            })}
          </Card>
          <p className="flex items-center gap-2 rounded-xl bg-surface px-4 py-3 text-base text-muted">
            <Lock />
            {es.scan.clinicalNote}
          </p>
          {error && <Alert>{error}</Alert>}
          <Button onClick={() => void onConfirm()} disabled={busy} className="w-full text-xl">
            <Check />
            {busy ? es.common.saving : es.scan.confirmAndSearch}
          </Button>
        </div>
      </div>
    </Page>
  );
}

export function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
