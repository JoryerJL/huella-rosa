import { describe, expect, it } from "vitest";
import { recordSections } from "./stepFields";

describe("recordSections", () => {
  it("shows breast review values with their form labels, grouped by step", () => {
    const sections = recordSections("BREAST_REVIEW", {
      weight: "62",
      consultationReason: "Revisión anual",
      familyBreastCancer: "7",
    });
    expect(sections.map((s) => s.role)).toEqual(["nutritionist", "doctor"]);
    const doctor = sections[1]!.items;
    expect(doctor.find((i) => i.key === "familyBreastCancer")).toMatchObject({
      label: "12. Familiares con antecedente de cáncer mamario",
      value: "Ninguno",
    });
    const text = JSON.stringify(sections.map((s) => s.items.map((i) => `${i.label}: ${i.value}`)));
    expect(text).not.toContain("consultationReason");
    expect(text).not.toContain("familyBreastCancer");
  });

  it("shows coded cytology choices without labels as 'Código N'", () => {
    const [pathology] = recordSections("PAP", { cytologyNumber: "C-123", diagnosisCode: "1" });
    expect(pathology!.role).toBe("pathologist");
    const diagnosis = pathology!.items.find((i) => i.key === "diagnosisCode")!;
    expect(diagnosis.value).toBe("Código 1");
    expect(diagnosis.label).not.toBe("diagnosisCode");
    expect(pathology!.items.find((i) => i.key === "cytologyNumber")!.label).not.toBe("cytologyNumber");
  });
});
