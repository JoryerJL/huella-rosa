import { useState } from "react";
import { compressImage, jpegName } from "../lib/imageCompress";
import { queueScan, type ScanLink } from "../data/scans";
import { requestSync } from "../data/sync";
import { useOnline } from "../lib/useOnline";
import { CameraIcon } from "../pages/ScanIdentifyPage";
import { Alert, buttonClass } from "./ui";
import { es } from "../i18n/es";

/**
 * "Adjuntar foto del formato" (SPEC 6.4 item 3, frame 06b): always visible, with or without signal.
 * The compressed photo is stored on this tablet linked to the visit; the sync engine sends it.
 */
export function AttachScanButton({ link }: { link: ScanLink }) {
  const online = useOnline();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await compressImage(file);
      await queueScan(blob, jpegName(file.name), link);
      setCount((n) => n + 1);
      requestSync();
    } catch {
      setError(es.scan.attachError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className={buttonClass("outline", "w-full cursor-pointer text-xl")}>
        <CameraIcon />
        {busy ? es.common.saving : es.scan.attach}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {count > 0 ? (
        <p className="text-lg font-semibold text-ok" role="status">
          {online ? es.scan.attached : es.scan.attachedOffline}
        </p>
      ) : (
        <p className="text-base text-muted">{es.scan.attachHint}</p>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
