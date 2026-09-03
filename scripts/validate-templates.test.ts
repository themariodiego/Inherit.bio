import { describe, expect, it } from "vitest";
import { BANNED_PATTERNS, bannedLanguage } from "./validate-templates";

describe("bannedLanguage", () => {
  it("names the §6.4 treatment-advice row for dosage, supplement and 'we recommend you take'", () => {
    expect(bannedLanguage("Ask your prescriber whether the dosage should change.")).toEqual([
      "treatment advice (§6.4)",
    ]);
    expect(bannedLanguage("No supplement changes this result.")).toEqual([
      "treatment advice (§6.4)",
    ]);
    expect(bannedLanguage("We recommend you take this result to your cardiology team.")).toEqual([
      "treatment advice (§6.4)",
    ]);
    expect(bannedLanguage("WE RECOMMEND YOU TAKE it seriously.")).toEqual([
      "treatment advice (§6.4)",
    ]);
  });

  it("matches the §6.4 words on word boundaries only", () => {
    expect(bannedLanguage("supplementary reading about dosages and a recommendation")).toEqual([]);
    expect(bannedLanguage("we recommend you talk to a professional")).toEqual([]);
  });

  it("keeps the earlier rows and reports each matched row once, in pattern order", () => {
    expect(bannedLanguage("this treats clots")).toEqual(["treatment claim"]);
    expect(bannedLanguage("if you have two copies")).toEqual(["deterministic claim"]);
    expect(bannedLanguage("a clinical-grade diagnosis")).toEqual([
      "clinical-grade claim",
      "diagnostic language",
    ]);
    expect(
      bannedLanguage("You have two copies, so the medicine treats clots less well. Ask about the dosage."),
    ).toEqual(["deterministic claim", "treatment claim", "treatment advice (§6.4)"]);
  });

  it("carries exactly one label per pattern and the §6.4 row last", () => {
    expect(BANNED_PATTERNS.map(([, why]) => why)).toEqual([
      "coverage inflation",
      "clinical-grade claim",
      "diagnostic language",
      "deterministic claim",
      "treatment claim",
      "treatment advice (§6.4)",
    ]);
  });

  it("finds nothing in plain-register report prose", () => {
    expect(
      bannedLanguage(
        "Your file shows C on both copies at this position. It says nothing about how you respond to a medicine.",
      ),
    ).toEqual([]);
  });
});
