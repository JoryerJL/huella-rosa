import { useCallback, useEffect, useState } from "react";
import type { PatientRecord } from "@er/shared";
import { getPatientRecord } from "./patients";
import { es } from "../i18n/es";

export function usePatientRecord(id: string | undefined) {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setError(null);
    getPatientRecord(id)
      .then((r) => active && setRecord(r))
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : es.errors.generic));
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { record, error, reload };
}
