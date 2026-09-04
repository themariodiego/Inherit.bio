import { describe, expect, it } from "vitest";
import {
  BANNED_PATTERNS,
  MEDICINES_BANNED_PATTERNS,
  MEDICINES_CATEGORY,
  bannedLanguage,
  medicinesBannedLanguage,
  MEDICINES_SENTENCE_CAP,
  overlongSentences,
  templateProseFields,
  sourceFindings,
} from "./validate-templates";

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

describe("medicinesBannedLanguage (ADR 0021)", () => {
  it("names the Medicines rows for phenotype, response, dose-direction and drug-choice language", () => {
    expect(MEDICINES_CATEGORY).toBe("pharmacogenomics");
    expect(medicinesBannedLanguage("This is one position, not a poor metabolizer status.")).toEqual([
      "phenotype word (ADR 0021)",
      "phenotype word (ADR 0021)",
    ]);
    expect(medicinesBannedLanguage("an intermediate metaboliser")).toEqual([
      "phenotype word (ADR 0021)",
      "phenotype word (ADR 0021)",
    ]);
    expect(medicinesBannedLanguage("a normal form")).toEqual(["phenotype word (ADR 0021)"]);
    expect(medicinesBannedLanguage("It does not tell you how you respond to warfarin.")).toEqual([
      "response language (ADR 0021)",
    ]);
    expect(medicinesBannedLanguage("people with this letter may respond differently")).toEqual([
      "response language (ADR 0021)",
    ]);
    expect(medicinesBannedLanguage("CPIC lists this as decreased function")).toEqual(["function label (ADR 0021)"]);
    expect(medicinesBannedLanguage("this form has no function")).toEqual(["function label (ADR 0021)"]);
    expect(medicinesBannedLanguage("this form has normal function")).toEqual([
      "phenotype word (ADR 0021)",
      "function label (ADR 0021)",
    ]);
    expect(medicinesBannedLanguage("a lower dose may be considered")).toEqual([
      "dose direction (ADR 0021)",
      "dose direction (ADR 0021)",
    ]);
    expect(medicinesBannedLanguage("to reduce the amount")).toEqual(["dose direction (ADR 0021)"]);
    expect(medicinesBannedLanguage("guided dosing")).toEqual(["dose language (ADR 0021)"]);
    expect(medicinesBannedLanguage("you could avoid this medicine")).toEqual([
      "drug choice (ADR 0021)",
      "drug choice (ADR 0021)",
    ]);
    expect(medicinesBannedLanguage("stop taking it")).toEqual(["drug choice (ADR 0021)"]);
    expect(medicinesBannedLanguage("an alternative instead of this")).toEqual(["drug choice (ADR 0021)"]);
    expect(medicinesBannedLanguage("switching is an option")).toEqual(["drug choice (ADR 0021)"]);
    expect(medicinesBannedLanguage("you should probably use less")).toEqual(["should-take language (ADR 0021)"]);
    expect(medicinesBannedLanguage("a poor metabolizer who should take a lower dose")).toEqual([
      "phenotype word (ADR 0021)",
      "phenotype word (ADR 0021)",
      "dose direction (ADR 0021)",
      "dose direction (ADR 0021)",
      "should-take language (ADR 0021)",
    ]);
  });

  it("checks every prose field and exempts only a citation label, which is the cited work's own title", () => {
    const template = {
      title: "Warfarin, one position · VKORC1",
      summary: "It is not a dose.",
      variants: [{ interpretations: { CC: "Your file shows C on both copies.", CT: "Your file shows C and T." } }],
      citations: [{ label: "CPIC guideline for pharmacogenetics-guided warfarin dosing, 2017 update" }],
    };
    expect(templateProseFields(template)).toEqual([
      "Warfarin, one position · VKORC1",
      "It is not a dose.",
      "Your file shows C on both copies.",
      "Your file shows C and T.",
    ]);
    expect(templateProseFields(template).flatMap(medicinesBannedLanguage)).toEqual([]);
    expect(medicinesBannedLanguage(template.citations[0].label)).toEqual(["dose language (ADR 0021)"]);
  });

  it("caps a Medicines sentence at 25 words on the readability gate's splitter", () => {
    expect(MEDICINES_SENTENCE_CAP).toBe(25);
    expect(overlongSentences("One short sentence. Another one, with rs762551 in it.")).toEqual([]);
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ") + ".";
    expect(overlongSentences(`Short one. ${long}`)).toEqual([long]);
  });

  it("finds nothing in the register a Medicines report uses", () => {
    expect(
      medicinesBannedLanguage(
        "Your file shows C on both copies at this position. CPIC calls C the reference form of VKORC1. This says nothing about how warfarin works in you, and it is not a dose.",
      ),
    ).toEqual([]);
    expect(medicinesBannedLanguage("This is one position, not the pair of forms you carry.")).toEqual([]);
  });

  it("carries exactly one label per row, in the order the rows are declared", () => {
    expect(MEDICINES_BANNED_PATTERNS.map(([, why]) => why)).toEqual([
      "phenotype word (ADR 0021)",
      "phenotype word (ADR 0021)",
      "function label (ADR 0021)",
      "response language (ADR 0021)",
      "dose direction (ADR 0021)",
      "dose direction (ADR 0021)",
      "dose language (ADR 0021)",
      "drug choice (ADR 0021)",
      "drug choice (ADR 0021)",
      "should-take language (ADR 0021)",
    ]);
  });
});

describe("sourceFindings", () => {
  const good = { name: "CPIC", url: "https://api.cpicpgx.org/v1/allele_definition", accessedOn: "2026-09-03", licence: "CC0 1.0" };

  it("accepts an absent source and a well-formed one", () => {
    expect(sourceFindings(undefined)).toEqual([]);
    expect(sourceFindings(null)).toEqual([]);
    expect(sourceFindings({ cpic: good, dbsnp: { ...good, name: "dbSNP", licence: undefined } })).toEqual([]);
  });

  it("names each missing or malformed field by its key", () => {
    expect(sourceFindings([])).toEqual(["source must be an object"]);
    expect(sourceFindings({ cpic: "CPIC" })).toEqual(["source.cpic must be an object"]);
    expect(sourceFindings({ cpic: { ...good, name: " " } })).toEqual(["source.cpic: missing name"]);
    expect(sourceFindings({ cpic: { ...good, url: "http://api.cpicpgx.org/v1/" } })).toEqual([
      "source.cpic: url must be https",
    ]);
    expect(sourceFindings({ cpic: { ...good, accessedOn: "3 Sep 2026" } })).toEqual([
      "source.cpic: accessedOn must be an ISO date (YYYY-MM-DD)",
    ]);
    expect(sourceFindings({ cpic: { ...good, licence: "" } })).toEqual([
      "source.cpic: licence must be a non-empty string when present",
    ]);
  });
});
