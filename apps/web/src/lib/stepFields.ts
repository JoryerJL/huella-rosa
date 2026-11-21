import type { ClinicalRole, ServiceType } from "@er/shared";
import mamaria from "../../../../plantillas/mamaria.json";
import citologia from "../../../../plantillas/citologia.json";

// Fields each specialist fills on their step (SPEC 6.3.1), with labels and options from the templates.
// Template `filledBy` wins when present; the fallback list mirrors the field ownership agreed for block 2b.
// Fields marked `no_transcribir` are never typed: the paper form image keeps them (CLAUDE.md rule 5).

interface TemplateField {
  clave: string;
  etiqueta: string;
  tipo: string;
  opciones?: Record<string, string>;
  rango?: number[];
  no_transcribir?: boolean;
  filledBy?: string;
}

export type StepFieldKind = "number" | "text" | "longText" | "date" | "choice";

export interface StepField {
  key: string;
  label: string;
  kind: StepFieldKind;
  /** value -> visible label, for `choice`. */
  options: { value: string; label: string }[];
  serviceType: ServiceType;
}

const FALLBACK_OWNER: Record<string, ClinicalRole> = {
  // mamaria.json
  height: "nutritionist",
  weight: "nutritionist",
  bloodPressure: "nutritionist",
  capillaryGlucose: "nutritionist",
  bt: "nutritionist",
  at: "nutritionist",
  consultationReason: "doctor",
  menarcheAge: "doctor",
  familyBreastCancer: "doctor",
  lastMenstrualPeriod: "doctor",
  contraceptionType: "doctor",
  contraceptionStart: "doctor",
  contraceptionDuration: "doctor",
  contraceptionStop: "doctor",
  menopauseAge: "doctor",
  priorMammography: "doctor",
  lastMammographyDate: "doctor",
  lastMammographyResult: "doctor",
  mammographyNotes: "doctor",
  otherRiskFactors: "doctor",
  thermography: "doctor",
  birads: "doctor",
  nextStep: "doctor",
  referralReason: "doctor",
  // citologia.json (result fields)
  interpretationDate: "pathologist",
  cytologyNumber: "pathologist",
  laboratory: "pathologist",
  sampleQuality: "pathologist",
  diagnosisCode: "pathologist",
  otherFindingsCode: "pathologist",
  repeatStudy: "pathologist",
  pathologistReviewed: "pathologist",
};

const KIND: Record<string, StepFieldKind> = {
  numero: "number",
  texto: "text",
  texto_libre: "longText",
  fecha: "date",
  casilla: "choice",
};

function toStepField(field: TemplateField, serviceType: ServiceType): StepField | null {
  const kind = KIND[field.tipo];
  if (!kind) return null;
  let options: StepField["options"] = [];
  if (kind === "choice") {
    if (field.opciones) options = Object.entries(field.opciones).map(([value, label]) => ({ value, label }));
    else if (field.rango && field.rango.length === 2) {
      const [from, to] = field.rango as [number, number];
      for (let n = from; n <= to; n++) options.push({ value: String(n), label: String(n) });
    }
  }
  return { key: field.clave, label: field.etiqueta, kind, options, serviceType };
}

export function ownerOf(field: TemplateField): string | undefined {
  return field.filledBy ?? FALLBACK_OWNER[field.clave];
}

function fieldsOf(template: { campos: TemplateField[] }, role: ClinicalRole, serviceType: ServiceType): StepField[] {
  return template.campos
    .filter((f) => !f.no_transcribir && ownerOf(f) === role)
    .map((f) => toStepField(f, serviceType))
    .filter((f): f is StepField => f !== null);
}

/** Fields of `role`'s step: mamaria.json goes to BREAST_REVIEW, citologia.json to PAP. */
export function stepFieldsFor(role: ClinicalRole): StepField[] {
  return [
    ...fieldsOf(mamaria as { campos: TemplateField[] }, role, "BREAST_REVIEW"),
    ...fieldsOf(citologia as { campos: TemplateField[] }, role, "PAP"),
  ];
}
