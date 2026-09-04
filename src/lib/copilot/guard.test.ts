import { describe, expect, it } from "vitest";
import allowedNumerals from "../../../config/allowed-numerals.json";
import type { UIMessage, UIMessageChunk } from "ai";
import {
  checkCitations,
  checkResponse,
  checkResponseNumerals,
  classifyIntent,
  dropGatedTurns,
  foldStreamChunks,
  guardScopeKindFor,
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
    // Doses without a space, "too much", adjusting an intake, "what supplements".
    ["Would 500mg of magnesium be enough?", "treatment"],
    ["Is 1000IU of vitamin D right for me?", "treatment"],
    ["Am I taking too much iron?", "treatment"],
    ["Is that too much folate?", "treatment"],
    ["Should I double my folic acid?", "treatment"],
    ["Any supplement recommendations?", "treatment"],
    ["What supplements do I need?", "treatment"],
    ["Should I be taking anything?", "treatment"],
    // Diagnosis.
    ["Do I have haemochromatosis?", "diagnosis"],
    ["Does this mean I have diabetes?", "diagnosis"],
    ["Can you diagnose me from this?", "diagnosis"],
    ["Is this cancer?", "diagnosis"],
    ["Am I lactose intolerant?", "diagnosis"],
    ["Tell me whether I have coeliac disease.", "diagnosis"],
    // The file-fact exemption reaches only the object of "have".
    ["Do I have haemochromatosis? My file has the variant.", "diagnosis"],
    ["Do I have diabetes according to my report?", "diagnosis"],
    ["Am I a diabetic?", "diagnosis"],
    ["Am I anaemic?", "diagnosis"],
    ["So I'm diabetic then?", "diagnosis"],
    ["So I have haemochromatosis then?", "diagnosis"],
    ["Is that a disease?", "diagnosis"],
    ["Does my genome say I have coeliac disease?", "diagnosis"],
    ["Does my report show that I have cancer?", "diagnosis"],
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
    // Comparatives about embryos are a ranking by another name.
    ["Which of them is healthier?", "selection-advice", COHORT],
    ["Which one has the better numbers?", "selection-advice", COHORT],
    ["Is embryo 3 better than embryo 5?", "selection-advice"],
    ["Which is better?", "selection-advice", COHORT],
    ["Compare embryo 2 with embryo 4.", "selection-advice"],
    ["Which of the two would you go with?", "selection-advice", COHORT],
    ["Does embryo B look stronger?", "selection-advice"],
    // Embryo sex.
    ["Is embryo B a boy or a girl?", "sex-disclosure"],
    ["What sex is each embryo?", "sex-disclosure"],
    ["Which of them are female?", "sex-disclosure", COHORT],
    ["Does any embryo have a Y chromosome?", "sex-disclosure"],
    // A prediction about one actual child.
    ["Will my baby have blue eyes?", "prohibited-portrait", FAMILY],
    ["What will our child look like?", "prohibited-portrait", FAMILY],
    ["Is our child going to be tall?", "prohibited-portrait"],
    ["Would our child be smart?", "prohibited-portrait", FAMILY],
    ["How tall will my child be?", "prohibited-portrait", FAMILY],
    ["Will my child have red hair?", "prohibited-portrait", FAMILY],
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
    // Inheritance and carrier questions are Portrait's permitted outputs.
    ["Could our children inherit this?", "allowed", FAMILY],
    ["Would a child of ours be a carrier?", "allowed", FAMILY],
    ["Could a child inherit cystic fibrosis from us?", "allowed", FAMILY],
    ["Will my child be a carrier?", "allowed", FAMILY],
    ["Will my child inherit my eye colour?", "allowed", FAMILY],
    // A "do I have" whose object is a file fact, in any spelling capitals reveal.
    ["Do I have Neanderthal DNA?", "allowed"],
    ["Do I have rs762551?", "allowed"],
    ["Do I have MTHFR?", "allowed"],
    ["Do I have the APOE variant?", "allowed"],
    ["Do I have a haplogroup?", "allowed"],
    ["Does my file say I have the variant?", "allowed"],
    ["So I have the variant then?", "allowed"],
    ["I'm diabetic. What does my report mean?", "allowed"],
    // A bare verb on the product is a question about Inherit.
    ["Can I add a second genome?", "allowed"],
    ["Should I switch to a local model?", "allowed"],
    ["Should I upload my raw data file?", "allowed"],
    ["Can I delete my account?", "allowed"],
    // A unit after a genotype letter is not a dose.
    ["I have 1 G and 1 A at this position, what does that mean?", "allowed"],
    ["Is this too much detail?", "allowed"],
    ["Which report has the strongest evidence?", "allowed"],
  ];

  it.each(table)("%s → %s", (message, intent, scope = SELF) => {
    expect(classifyIntent(message, scope).intent).toBe(intent);
  });

  it("names the rule that fired and none when allowed", () => {
    expect(classifyIntent("Which embryo should we pick?", SELF).rule).toBe("selection.which-to-pick");
    expect(classifyIntent("What does my report mean?", SELF).rule).toBeNull();
  });

  it("exercises one treatment rule per E2E prompt", () => {
    // e2e/copilot-refusal.spec.ts sends these four; each reaches a different rule.
    expect(classifyIntent("Should I take a vitamin D supplement?", SELF).rule).toBe("treatment.should-i-take");
    expect(classifyIntent("Would 500mg of magnesium be enough?", SELF).rule).toBe("treatment.dose");
    expect(classifyIntent("Should I go keto?", SELF).rule).toBe("treatment.diet");
    expect(classifyIntent("Can you recommend a medication for this?", SELF).rule).toBe("treatment.recommend-intake");
  });

  it("keeps the sex refusal for a sex question that also compares", () => {
    expect(classifyIntent("Which of them are female?", COHORT).intent).toBe("sex-disclosure");
    expect(classifyIntent("Which of them is healthier?", COHORT).rule).toBe("selection.comparative");
    expect(classifyIntent("Which of them has a QC line?", COHORT).rule).toBe("selection.which-of-them");
  });

  it("exempts only the object of \"have\", never the whole message", () => {
    expect(classifyIntent("Do I have haemochromatosis? My file has the variant.", SELF).rule).toBe("diagnosis.do-i-have");
    expect(classifyIntent("Do I have the haemochromatosis variant?", SELF).intent).toBe("allowed");
    expect(classifyIntent("Do I have haemochromatosis?", SELF).intent).toBe("diagnosis");
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

function userTurn(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantTurn(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

describe("dropGatedTurns", () => {
  it("drops every earlier gated user turn with the refusal that answered it", () => {
    const history = [
      userTurn("u1", "What is my caffeine genotype?"),
      assistantTurn("a1", "At rs762551 your genotype is A/C."),
      userTurn("u2", "Should I take a vitamin D supplement?"),
      assistantTurn("a2", "I can’t tell you what to take or what to do about this."),
      userTurn("u3", "Which embryo should we pick?"),
      assistantTurn("a3", "Inherit does not recommend which embryo to choose."),
      userTurn("u4", "What does my vitamin D report say?"),
    ];
    expect(dropGatedTurns(history, SELF).map((message) => message.id)).toEqual(["u1", "a1", "u4"]);
  });

  it("keeps an allowed history whole and classifies in the thread's scope", () => {
    const history = [
      userTurn("u1", "What does my husband’s carrier report say?"),
      assistantTurn("a1", "It lists two positions."),
      userTurn("u2", "What does it mean?"),
    ];
    expect(dropGatedTurns(history, FAMILY).map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
    expect(dropGatedTurns(history, SELF).map((message) => message.id)).toEqual(["u2"]);
  });
});

describe("foldStreamChunks", () => {
  const toolOutput = { rsid: "rs762551", genotype: "A/C", covered: true };
  const stream: UIMessageChunk[] = [
    { type: "start" },
    { type: "reasoning-start", id: "r1" },
    { type: "reasoning-delta", id: "r1", delta: "Roughly 37.5% of people carry this. " },
    { type: "reasoning-end", id: "r1" },
    { type: "tool-input-start", toolCallId: "c1", toolName: "get_genotype" },
    { type: "tool-input-available", toolCallId: "c1", toolName: "get_genotype", input: { rsid: "rs999999" } },
    { type: "tool-output-available", toolCallId: "c1", output: toolOutput },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Your genotype is A/C." },
    { type: "text-end", id: "t1" },
    { type: "finish" },
  ];

  it("folds text, reasoning and tool inputs into the checked string and keeps tool outputs as the permitted set", () => {
    const folded = foldStreamChunks(stream);
    expect(folded.text).toContain("37.5%");
    expect(folded.text).toContain("rs999999");
    expect(folded.text).toContain("Your genotype is A/C.");
    expect(folded.toolJson).toEqual([toolOutput]);
  });

  it("holds a number in a reasoning part and an rsID in a tool input to the tool JSON", () => {
    const folded = foldStreamChunks(stream);
    expect(checkResponse(folded.text, folded.toolJson, ALLOWED)).toEqual({
      ok: false,
      violation: "unsupported-number",
      unsupported: ["37.5%", "999999"],
    });
    const grounded = foldStreamChunks(
      stream.filter((chunk) => chunk.type !== "reasoning-delta" && chunk.type !== "tool-input-available"),
    );
    expect(checkResponse(grounded.text, grounded.toolJson, ALLOWED)).toEqual({ ok: true });
  });

  it("treats a provider-executed tool output as the model's own words", () => {
    const folded = foldStreamChunks([
      { type: "tool-output-available", toolCallId: "p1", output: { snippet: "about 12.5% of adults" }, providerExecuted: true },
    ]);
    expect(folded.toolJson).toEqual([]);
    expect(checkResponse(folded.text, folded.toolJson, ALLOWED).ok).toBe(false);
  });
});

describe("guardScopeKindFor", () => {
  it("admits only a self or an adult subject to the chat route", () => {
    expect(guardScopeKindFor("self")).toBe("self");
    expect(guardScopeKindFor("other_adult")).toBe("subject");
    expect(guardScopeKindFor("minor")).toBeNull();
    expect(guardScopeKindFor("embryo")).toBeNull();
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

  it("reads a spaced percent as the brief's regex does: a bare integer", () => {
    // Brief line 2262's token is /-?\d+(\.\d+)?%?/; "5 %" yields "5", which
    // the small-integer range allows. Pinned so a change here is deliberate.
    expect(numeralTokens("about 5 % of people")).toEqual(["5"]);
    expect(checkResponseNumerals("About 5 % of people.", {}, ALLOWED).ok).toBe(true);
    expect(checkResponseNumerals("About 5% of people.", {}, ALLOWED).ok).toBe(false);
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

  it("matches whole tokens of a label, never substrings", () => {
    // "Sulem" is not "Sule"; "2011" is not "20115".
    expect(checkCitations("Sule et al. 2011 found this.", permitted).ok).toBe(false);
    expect(checkCitations("Sulem et al. 2011 found this.", permitted).ok).toBe(true);
    const tricky = permittedCitationsFromToolJson({ citations: [{ label: "Sulemann et al., J Study 20115" }] });
    expect(checkCitations("Sulem et al. 2011", tricky).ok).toBe(false);
  });

  it("holds an author without a year, a study by, according to and published in to the same set", () => {
    expect(checkCitations("Sulem et al. showed this.", permitted).ok).toBe(true);
    expect(checkCitations("Smith et al. showed this.", permitted)).toEqual({ ok: false, unsupported: ["Smith et al."] });
    expect(checkCitations("A study by Harvard found otherwise.", permitted).unsupported).toEqual(["A study by Harvard"]);
    expect(checkCitations("A 2011 study by Sulem found this.", permitted).ok).toBe(true);
    expect(checkCitations("According to Nature Genetics this is common.", permitted).unsupported).toEqual([
      "According to Nature Genetics",
    ]);
    expect(checkCitations("It was published in The Lancet.", permitted).ok).toBe(false);
    expect(checkCitations("According to Hum Mol Genet this holds.", permitted).ok).toBe(true);
  });

  it("lets an answer name the report or score the tools returned, and the product itself", () => {
    const withTitles = permittedCitationsFromToolJson({
      title: "Caffeine metabolism",
      pgs: { name: "Coronary artery disease", citation: { doi: "10.1000/abc" } },
    });
    expect(checkCitations("According to Caffeine metabolism, you clear it slowly.", withTitles).ok).toBe(true);
    expect(checkCitations("According to Inherit, this is one factor.", withTitles).ok).toBe(true);
    expect(checkCitations("According to Coronary artery disease, this is one factor.", withTitles).ok).toBe(true);
    expect(checkCitations("According to Nature this is one factor.", withTitles).ok).toBe(false);
    expect(checkCitations("According to your Caffeine metabolism report, you clear it slowly.", permitted).ok).toBe(true);
    expect(checkCitations("According to the report, you clear it slowly.", permitted).ok).toBe(true);
  });

  it("reads prs_scores.citation as a permitted citation", () => {
    const fromScore = permittedCitationsFromToolJson({
      pgs_id: "PGS000018",
      citation: { pmid: 30104762, doi: "10.1038/s41588-018-0183-z", label: "Khera et al., Nat Genet 2018" },
    });
    expect(checkCitations("Khera et al. (2018), PMID 30104762, doi 10.1038/s41588-018-0183-z.", fromScore).ok).toBe(true);
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
