import { describe, expect, it } from "vitest";
import { buildEiraId, isEiraIdLike, joinNameParts, splitFullName, parsePatientSlug, patientSlug, pickBySlug } from "./eiraId";

describe("buildEiraId (SPEC 6.1.1)", () => {
  it("builds the SPEC example", () => {
    expect(
      buildEiraId({ givenNames: "Lucía", paternalSurname: "Ramírez", maternalSurname: "Torres", birthDate: "1990-01-05" }),
    ).toBe("RATL900105");
  });

  it("uses the first given name only", () => {
    expect(
      buildEiraId({
        givenNames: "María Guadalupe",
        paternalSurname: "Hernández",
        maternalSurname: "López",
        birthDate: "1985-03-12",
      }),
    ).toBe("HELM850312");
  });

  it("skips particles and uses X without a maternal surname", () => {
    expect(buildEiraId({ givenNames: "Ana", paternalSurname: "de la Cruz", birthDate: "1979-11-30" })).toBe(
      "CRXA791130",
    );
    expect(
      buildEiraId({ givenNames: "Ana", paternalSurname: "de la Cruz", maternalSurname: "  ", birthDate: "1979-11-30" }),
    ).toBe("CRXA791130");
  });

  it("turns Ñ into X and removes accents", () => {
    expect(
      buildEiraId({ givenNames: "Ñeli", paternalSurname: "Ñúñez", maternalSurname: "Ávila", birthDate: "2001-07-09" }),
    ).toBe("XUAX010709");
    expect(
      buildEiraId({ givenNames: "Itzel", paternalSurname: "Muñoz", maternalSurname: "Peña", birthDate: "1995-12-01" }),
    ).toBe("MUPI951201");
  });

  it("returns empty when a required part is missing", () => {
    expect(buildEiraId({ givenNames: "Ana", paternalSurname: "", birthDate: "1990-01-05" })).toBe("");
    expect(buildEiraId({ givenNames: "", paternalSurname: "Ruiz", birthDate: "1990-01-05" })).toBe("");
    expect(buildEiraId({ givenNames: "Ana", paternalSurname: "Ruiz", birthDate: "1990-01" })).toBe("");
  });
});

describe("isEiraIdLike", () => {
  it("accepts 4 letters + 6 digits and an optional 11th character, any case", () => {
    expect(isEiraIdLike("RATL900105")).toBe(true);
    expect(isEiraIdLike("ratl900105")).toBe(true);
    expect(isEiraIdLike("RATL9001052")).toBe(true);
  });

  it("rejects other shapes", () => {
    expect(isEiraIdLike("RAT900105")).toBe(false);
    expect(isEiraIdLike("RATL90010")).toBe(false);
    expect(isEiraIdLike("DEMO-000001")).toBe(false);
    expect(isEiraIdLike("")).toBe(false);
  });
});

describe("splitFullName", () => {
  it("takes the last two units as surnames, keeping particles with the next word", () => {
    expect(splitFullName("María Guadalupe Hernández López")).toEqual({
      givenNames: "María Guadalupe",
      paternalSurname: "Hernández",
      maternalSurname: "López",
    });
    expect(splitFullName("Ana de la Cruz")).toEqual({ givenNames: "Ana", paternalSurname: "de la Cruz", maternalSurname: "" });
    expect(splitFullName("Lucía")).toEqual({ givenNames: "Lucía", paternalSurname: "", maternalSurname: "" });
  });
});

describe("joinNameParts", () => {
  it("joins non-empty parts with single spaces", () => {
    expect(joinNameParts({ givenNames: " Ana ", paternalSurname: "de la Cruz", maternalSurname: "" })).toBe(
      "Ana de la Cruz",
    );
  });
});

describe("readable record slugs", () => {
  const lucia = { id: "3f2a9c1e-0000-4000-8000-000000000001", formId: "RATL900105" };
  const other = { id: "3f2b0000-0000-4000-8000-000000000002", formId: null };

  it("builds <EIRA ID>-<4 chars of the uuid>, or SINID without an ID", () => {
    expect(patientSlug(lucia)).toBe("RATL900105-3f2a");
    expect(patientSlug(other)).toBe("SINID-3f2b");
  });

  it("parses a slug and rejects a uuid", () => {
    expect(parsePatientSlug("ratl900105-3F2A")).toEqual({ idPart: "RATL900105", uuidPrefix: "3f2a" });
    expect(parsePatientSlug(lucia.id)).toBeNull();
  });

  it("picks the patient by slug, and keeps working after the EIRA ID changes", () => {
    expect(pickBySlug("RATL900105-3f2a", [lucia, other])).toBe(lucia);
    expect(pickBySlug("SINID-3f2b", [lucia, other])).toBe(other);
    expect(pickBySlug("OLDX900105-3f2a", [lucia, other])).toBe(lucia);
    expect(pickBySlug("RATL900105-ffff", [lucia, other])).toBeNull();
  });
});
