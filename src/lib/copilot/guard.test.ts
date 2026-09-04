import { describe, expect, it } from "vitest";
import allowedNumerals from "../../../config/allowed-numerals.json";
import {
  checkCitations,
  checkResponse,
  checkResponseNumerals,
  classifyIntent,
  INTENT_RULES,
  normalizeMessage,
  numeralTokens,
  permittedCitationsFromToolJson,
  roundTo,
  toolJsonNumbers,
  type AllowedNumerals,
  type GuardScope,
  type IntentClass,
} from "./guard";

const SELF: GuardScope = { kind: "self", displayLabel: "You" };
const SUBJECT: GuardScope = { kind: "subject", displayLabel: "Invited adult" };
const FAMILY: GuardScope = { kind: "family", displayLabel: "your family view" };
const COHORT: GuardScope = { kind: "cohort", displayLabel: "your 6 embryos", cohortSize: 6 };

const ALLOWED = allowedNumerals as AllowedNumerals;

describe("classifyIntent", () => {
  const table: Array<[string, IntentClass, GuardScope?]> = [
    // Treatment, dose, supplement, diet — the brief line 1040 prompts.
    ["Should I take a vitamin D supplement?", "treatment"],
    ["What dosage of folic acid should I take?", "treatment"],
    ["What should I eat to lower my cholesterol risk?", "treatment"],
    ["How much iron should I take each day?", "treatment"],
    ["Is there a supplement that would help with this?", "treatment"],
    ["Which foods should I avoid?", "treatment"],
    ["Would 500 mg of magnesium be enough?", "treatment"],
    ["Should I go keto?", "treatment"],
    ["Do I need extra folate?", "treatment"],
    ["How can I lower my risk of heart disease?", "treatment"],
    ["Can you recommend a medication for this?", "treatment"],
    ["What should I do about this?", "treatment"],
    // Diagnosis.
    ["Do I have haemochromatosis?", "diagnosis"],
    ["Does this mean I have diabetes?", "diagnosis"],
    ["Can you diagnose me from this?", "diagnosis"],
    ["Is this cancer?", "diagnosis"],
    ["Am I lactose intolerant?", "diagnosis"],
    ["Tell me whether I have coeliac disease.", "diagnosis"],
    // Prognosis.
    ["Will I get Alzheimer’s?", "prognosis"],
    ["Am I going to develop diabetes?", "prognosis"],
    ["How long will I live?", "prognosis"],
    ["What is my prognosis?", "prognosis"],
    ["Will this get worse?", "prognosis"],
    // Embryo selection, disposition and ranking, in any scope.
    ["Which embryo should we pick?", "selection-advice"],
    ["Which embryo should we pick?", "selection-advice", COHORT],
    ["Which one should we transfer?", "selection-advice", COHORT],
    ["Rank them for me.", "selection-advice", COHORT],
    ["Which is the best embryo?", "selection-advice"],
    ["Rank the embryos from best to worst.", "selection-advice"],
    ["Is embryo A or embryo B healthier?", "selection-advice"],
    ["What should we do with the remaining embryos?", "selection-advice"],
    ["Should we discard the others?", "selection-advice", COHORT],
    ["Do you recommend an embryo?", "selection-advice"],
    // Embryo sex.
    ["Is embryo B a boy or a girl?", "sex-disclosure"],
    ["What sex is each embryo?", "sex-disclosure"],
    ["Which of them are female?", "sex-disclosure", COHORT],
    ["Does any embryo have a Y chromosome?", "sex-disclosure"],
    // A prediction about one actual child.
    ["Will my baby have blue eyes?", "prohibited-portrait", FAMILY],
    ["What will our child look like?", "prohibited-portrait", FAMILY],
    ["Is our child going to be tall?", "prohibited-portrait"],
    // Cross-subject.
    ["What does my sister’s file say about caffeine?", "cross-subject"],
    ["Can you read my husband’s results?", "cross-subject"],
    ["What is my daughter’s risk for this?", "cross-subject"],
    ["Compare my DNA with my brother’s.", "cross-subject"],
    ["What does her genome say?", "cross-subject"],
    ["What is embryo B’s risk?", "cross-subject"],
    ["What does my mother’s report say?", "cross-subject", FAMILY],
    ["What does my own file say?", "cross-subject", SUBJECT],
    // Near-misses that must stay allowed.
    ["What does my caffeine result mean?", "allowed"],
    ["What does my vitamin D report say?", "allowed"],
    ["Do I carry the alcohol flush variant?", "allowed"],
    ["Do I have the lactase persistence variant?", "allowed"],
    ["Am I a carrier for cystic fibrosis?", "allowed"],
    ["Which of my reports have the strongest evidence?", "allowed"],
    ["What is my genotype at rs762551?", "allowed"],
    ["What does it mean to be a carrier?", "allowed"],
    ["What is a supplement?", "allowed"],
    ["What does this report mean?", "allowed"],
    ["Did I inherit this from my mother?", "allowed"],
    ["Which reports are covered by my file?", "allowed"],
    ["Summarize my heart reports.", "allowed"],
    ["What is the evidence level of my caffeine report?", "allowed"],
    ["How common is my caffeine genotype?", "allowed"],
    ["Is embryo B’s risk shown here?", "allowed", COHORT],
    ["What does the QC line mean for embryo B?", "allowed", COHORT],
    ["What does my husband’s carrier report say?", "allowed", FAMILY],
    ["What does my partner’s carrier report say?", "allowed", COHORT],
    ["What are the chances our children inherit this?", "allowed", FAMILY],
    ["What does my own file say?", "allowed", SELF],
  ];

  it.each(table)("%s → %s", (message, intent, scope = SELF) => {
    expect(classifyIntent(message, scope).intent).toBe(intent);
  });

  it("names the rule that fired and none when allowed", () => {
    expect(classifyIntent("Which embryo should we pick?", SELF).rule).toBe("selection.which-to-pick");
    expect(classifyIntent("What does my report mean?", SELF).rule).toBeNull();
  });

  it("is deterministic and case, punctuation and apostrophe insensitive", () => {
    const a = classifyIntent("WHICH EMBRYO SHOULD WE PICK???", SELF);
    const b = classifyIntent("which embryo should we pick", SELF);
    expect(a).toEqual(b);
    expect(classifyIntent("What does my sister’s file say?", SELF).intent).toBe("cross-subject");
    expect(classifyIntent("What does my sister's file say?", SELF).intent).toBe("cross-subject");
  });

  it("keeps every rule's id unique and every intent in the gated set", () => {
    const ids = INTENT_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    const intents = new Set(INTENT_RULES.map((rule) => rule.intent));
    expect([...intents].sort()).toEqual(
      ["cross-subject", "diagnosis", "prognosis", "prohibited-portrait", "selection-advice", "sex-disclosure", "treatment"],
    );
  });

  it("normalizes to lowercase words with straight apostrophes", () => {
    expect(normalizeMessage("  Which EMBRYO — should we pick?! ")).toBe("which embryo should we pick");
    expect(normalizeMessage("my sister’s file")).toBe("my sister's file");
  });
});

describe("checkResponseNumerals", () => {
  const toolJson = [
    { rsid: "rs762551", genotype: "A/C", covered: true, annotation: { chrom: 15, pos38: 74749576, gnomad_af: 0.3842 } },
    { pgs_id: "PGS000018", result: { zscore: -0.4213, percentile: 42.3, coverage: 0.87 } },
  ];

  it("extracts the brief's tokens verbatim", () => {
    expect(numeralTokens("about 42.3% at 1 in 1,000 and -0.42")).toEqual(["42.3%", "1", "1", "000", "-0.42"]);
  });

  it("accepts a number that equals a tool value after rounding to the token's decimals", () => {
    expect(checkResponseNumerals("Your z-score is -0.42.", toolJson, ALLOWED).ok).toBe(true);
    expect(checkResponseNumerals("You sit around the 42nd percentile, 42%.", toolJson, ALLOWED).ok).toBe(true);
    expect(checkResponseNumerals("Coverage 0.9.", toolJson, ALLOWED).ok).toBe(true);
    expect(checkResponseNumerals("Position 74749576 on chromosome 15.", toolJson, ALLOWED).ok).toBe(true);
  });

  it("rejects a number the tools never returned", () => {
    const verdict = checkResponseNumerals("About 37.5% of people share your genotype.", toolJson, ALLOWED);
    expect(verdict).toEqual({ ok: false, unsupported: ["37.5%"] });
    expect(checkResponseNumerals("Your z-score is -0.43.", toolJson, ALLOWED).ok).toBe(false);
    expect(checkResponseNumerals("Coverage 0.88.", toolJson, ALLOWED).ok).toBe(false);
  });

  it("rounds half away from zero at the token's precision", () => {
    expect(roundTo(0.3842, 2)).toBe(0.38);
    expect(roundTo(42.35, 1)).toBe(42.4);
    expect(roundTo(-0.4213, 1)).toBe(-0.4);
    expect(roundTo(1.005, 2)).toBe(1.01);
  });

  it("reads numbers inside tool string values, such as an rsID", () => {
    expect(toolJsonNumbers({ rsid: "rs762551", label: "Hum Mol Genet 2011" })).toEqual([762551, 2011]);
    expect(checkResponseNumerals("at rs762551", { rsid: "rs762551" }, ALLOWED).ok).toBe(true);
  });

  it("reads nested and array-held tool values", () => {
    const nested = { reports: [{ variants: [{ outcome: { effect: 1.37 } }] }] };
    expect(checkResponseNumerals("an effect of 1.4", nested, ALLOWED).ok).toBe(true);
    expect(checkResponseNumerals("an effect of 1.3", nested, ALLOWED).ok).toBe(false);
  });

  it("allows the listed integers without tool support, never with a percent sign or a decimal point", () => {
    expect(checkResponseNumerals("In 2011 a study found this.", {}, ALLOWED).ok).toBe(true);
    expect(checkResponseNumerals("Chromosome 22 carries it.", {}, ALLOWED).ok).toBe(true);
    expect(checkResponseNumerals("You asked 3 questions about 2 reports.", {}, ALLOWED).ok).toBe(true);
    expect(checkResponseNumerals("About 22% of people.", {}, ALLOWED).ok).toBe(false);
    expect(checkResponseNumerals("About 5% of people.", {}, ALLOWED).ok).toBe(false);
    expect(checkResponseNumerals("About 5.0 units.", {}, ALLOWED).ok).toBe(false);
    expect(checkResponseNumerals("Chromosome 23.", {}, ALLOWED).ok).toBe(false);
    expect(checkResponseNumerals("In 1899.", {}, ALLOWED).ok).toBe(false);
    expect(checkResponseNumerals("150 of them.", {}, ALLOWED).ok).toBe(false);
  });

  it("allows an embryo count up to the cohort size only when a cohort is in scope", () => {
    expect(checkResponseNumerals("All 30 embryos have a QC line.", {}, ALLOWED, { cohortSize: 30 }).ok).toBe(true);
    expect(checkResponseNumerals("All 31 embryos have a QC line.", {}, ALLOWED, { cohortSize: 30 }).ok).toBe(false);
    expect(checkResponseNumerals("All 30 embryos have a QC line.", {}, ALLOWED).ok).toBe(false);
  });

  it("pins config/allowed-numerals.json to the brief's list", () => {
    expect(ALLOWED.schemaVersion).toBe(1);
    expect(ALLOWED.ranges.map((range) => [range.id, range.min, range.max ?? range.maxFrom])).toEqual([
      ["calendar-year", 1900, 2100],
      ["chromosome-number", 1, 22],
      ["embryo-count", 1, "cohortSize"],
      ["small-integer", 0, 10],
    ]);
  });
});

describe("checkCitations", () => {
  const toolJson = {
    citations: [{ pmid: "21357676", label: "Sulem et al., Hum Mol Genet 2011" }],
    pgs: { citation: { doi: "10.1038/s41588-019-0379-x", url: "https://www.pgscatalog.org/score/PGS000018/" } },
    summary: "https://example.invalid/not-a-citation",
  };
  const permitted = permittedCitationsFromToolJson(toolJson);

  it("collects only what sits under a citation key", () => {
    expect([...permitted.pmids]).toEqual(["21357676"]);
    expect([...permitted.dois]).toEqual(["10.1038/s41588-019-0379-x"]);
    expect([...permitted.urls]).toEqual(["https://www.pgscatalog.org/score/pgs000018/"]);
    expect(permitted.labels).toEqual(["Sulem et al., Hum Mol Genet 2011"]);
  });

  it("accepts a PMID, DOI, URL or author-year the tools returned", () => {
    expect(checkCitations("See PMID 21357676 and Sulem et al. (2011).", permitted).ok).toBe(true);
    expect(checkCitations("doi 10.1038/s41588-019-0379-x.", permitted).ok).toBe(true);
    expect(checkCitations("https://www.pgscatalog.org/score/PGS000018/", permitted).ok).toBe(true);
  });

  it("rejects any citation outside that set", () => {
    expect(checkCitations("PMID: 12345678 shows this.", permitted)).toEqual({ ok: false, unsupported: ["PMID: 12345678"] });
    expect(checkCitations("Smith et al. 2019 found otherwise.", permitted).unsupported).toEqual(["Smith et al. 2019"]);
    expect(checkCitations("see 10.1000/xyz123", permitted).ok).toBe(false);
    expect(checkCitations("see https://example.invalid/not-a-citation", permitted).ok).toBe(false);
    expect(checkCitations("Sulem et al. 2019 also found this.", permitted).ok).toBe(false);
  });

  it("passes prose with no citation at all", () => {
    expect(checkCitations("Your genotype is A/C.", permitted)).toEqual({ ok: true, unsupported: [] });
  });
});

describe("checkResponse", () => {
  const toolJson = { rsid: "rs762551", genotype: "A/C", citations: [{ pmid: "21357676", label: "Sulem et al., Hum Mol Genet 2011" }] };

  it("passes a grounded answer", () => {
    expect(checkResponse("At rs762551 your genotype is A/C (Sulem et al. 2011).", toolJson, ALLOWED)).toEqual({ ok: true });
  });

  it("names the numeral violation before the citation one", () => {
    expect(checkResponse("37.5% of people, per PMID 999999.", toolJson, ALLOWED)).toEqual({
      ok: false,
      violation: "unsupported-number",
      unsupported: ["37.5%", "999999"],
    });
    expect(checkResponse("This is shown by PMID 21357670.", toolJson, ALLOWED)).toMatchObject({
      ok: false,
      violation: "unsupported-number",
    });
    expect(checkResponse("Smith et al. 2011 disagree.", toolJson, ALLOWED)).toEqual({
      ok: false,
      violation: "unsupported-citation",
      unsupported: ["Smith et al. 2011"],
    });
  });
});
