import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fleschKincaidGrade, readabilitySentences, wordCount } from "../../../scripts/readability";
import { vocabularyWords } from "../../../scripts/readability-gate";
import { CARRIER_REASONS } from "../../lib/family/carrier-pair";
import { MENDEL_ASSUMPTIONS, MENDEL_OUTCOMES, MENDEL_PATTERNS, canonicalCross } from "../../lib/family/mendel";
import { TRAIT_KEYS } from "../../lib/family/traits";
import { EXACT_MARKER } from "../../lib/figures/contract";
import { REPORT_HEADINGS } from "../reports/headings";
import { COUNSELLOR_NO_ROUTE, DATA_AND_METHODS, NOT_DIAGNOSTIC } from "../reports/strings";
import * as healthPicture from "./health-picture";
import { UNNAMED_PERSON_LABEL } from "./index";
import { SHARING_ERROR_STATUS } from "./permissions";
import { GATE_ERROR_STATUS, PAUSED_BODY } from "./person";
import * as copy from "./portrait";

/**
 * The Portrait copy registry (design §4; brief lines 352-364, 1016, 1254,
 * 1345-1368, 2238, 2650). The strings the brief quotes ship
 * character-for-character with U+2019 and U+2014; everything written here is
 * graded, capped and checked word by word in its short role exactly as the
 * readability gate will check it; and nothing anywhere is about one child.
 */

/** Every exported string, including the ones the exported functions produce. */
function corpus(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    // A function called with a shape it was not written for yields a
    // placeholder-filled string, not copy; only real copy is graded.
    if (typeof value === "string" && !/undefined|\[object Object\]/.test(value)) out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  const call = (fn: unknown, ...args: unknown[]) => {
    // A function refuses an argument shape it was not written for; every
    // shape it was written for is tried below.
    try {
      walk((fn as (...values: unknown[]) => string)(...args));
    } catch {
      /* not this shape */
    }
  };
  for (const value of Object.values(copy)) {
    if (typeof value === "function") {
      call(value, "Bo", "rs1");
      call(value, 3, 12);
      call(value, "Bo", "dominant");
      call(value, ["Bo", "Ana"]);
      call(value, canonicalCross("recessive_both_one_copy").outcomes);
      call(value, "Bo", 999_999_001, "TESTGENE", "Pathogenic");
    } else walk(value);
  }
  return out;
}

/** The strings the gate checks word by word against the plain vocabulary. */
function shortRoleStrings(): [string, string][] {
  return [
    ["PORTRAIT_H1", copy.PORTRAIT_H1],
    ["BANNER_LABEL", copy.BANNER_LABEL],
    ["blockingHeading", copy.blockingHeading("fact")],
    ["OPEN_CONSENTS_BUTTON", copy.OPEN_CONSENTS_BUTTON],
    ["ACKNOWLEDGE_CHECKBOX_LABEL", copy.ACKNOWLEDGE_CHECKBOX_LABEL],
    ["ACKNOWLEDGE_BUTTON", copy.ACKNOWLEDGE_BUTTON],
    ["ACKNOWLEDGE_ERROR_STATUS", copy.ACKNOWLEDGE_ERROR_STATUS],
    ["PAIR_BAR_LABEL", copy.PAIR_BAR_LABEL],
    ["OUTPUTS_HEADING", copy.OUTPUTS_HEADING],
    ["outputHeading", copy.outputHeading("fact")],
    ["HOW_SURE_HEADING", copy.HOW_SURE_HEADING],
    ...Object.entries(copy.HOW_SURE_LABELS).map(([key, text]): [string, string] => [`HOW_SURE_LABELS.${key}`, text]),
    ["DOTS_LABEL", copy.DOTS_LABEL],
    ["BAR_LABEL", copy.BAR_LABEL],
    ["DOTS_LEGEND_LABEL", copy.DOTS_LEGEND_LABEL],
    ["SEE_AS_TABLE_BUTTON", copy.SEE_AS_TABLE_BUTTON],
    ...Object.entries(copy.DOTS_TABLE_LABELS).map(([key, text]): [string, string] => [`DOTS_TABLE_LABELS.${key}`, text]),
    ...Object.entries(copy.TRAIT_HEADINGS).map(([key, text]): [string, string] => [`TRAIT_HEADINGS.${key}`, text]),
    ["REFUSALS_HEADING", copy.REFUSALS_HEADING],
    ["DELETE_BUTTON", copy.DELETE_BUTTON],
    ["DELETE_DIALOG_HEADING", copy.DELETE_DIALOG_HEADING],
    ["DELETE_CONFIRM_BUTTON", copy.DELETE_CONFIRM_BUTTON],
    ["DELETE_CANCEL_BUTTON", copy.DELETE_CANCEL_BUTTON],
    ["DELETE_ERROR_STATUS", copy.DELETE_ERROR_STATUS],
  ];
}

const VOCABULARY = new Set(
  (
    JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data/plain-vocabulary.json"), "utf8"),
    ) as { words: string[] }
  ).words,
);

const JARGON = (
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/jargon.json"), "utf8")) as {
    terms: { term: string; aliases?: string[] }[];
  }
).terms.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])]);

function withTermsReplaced(text: string): string {
  let result = text;
  for (const term of [...JARGON].sort((left, right) => right.length - left.length)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi"), "fact");
  }
  return result;
}

describe("portrait copy", () => {
  it("ships the brief's quoted strings character-for-character", () => {
    expect(copy.BANNER_FIRST).toBe(
      "Portrait describes chances across many possible children. It cannot tell you anything about any actual child. It is not a pregnancy test and not a medical assessment.",
    );
    expect(copy.BANNER_SECOND).toBe("Both of you can see this page, and either of you can delete it.");
    expect(copy.HEADER_SENTENCE).toBe(
      "This shows what a child could inherit from the two files you have added. It is not a picture of any particular child.",
    );
    expect(copy.BOTH_GENOMES_REQUIRED).toBe(
      "Add a second genome to see what a child could inherit from these two files.",
    );
    expect(copy.DISTINGUISHING_PRINCIPLE).toBe(
      "Portrait describes the range of children a couple could have. Embryo Analysis helps choose between embryos that already exist — so no appearance trait appears there at all.",
    );
    expect(copy.SEGREGATION_SENTENCE).toBe(
      "Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.",
    );
    expect(copy.CHANCE_NOT_PREDICTION).toBe("This is a chance, not a prediction about a particular child.");
    expect(copy.EXACTNESS_LABEL).toBe("This is exact arithmetic, not an estimate.");
    expect(copy.EXACTNESS_LABEL).toBe(EXACT_MARKER);
    expect(copy.derivationLine(canonicalCross("recessive_both_one_copy").outcomes)).toBe(
      "1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%) neither",
    );
    expect(copy.outOfHundredSentence(25, "have the condition")).toBe(
      "Out of 100 possible children, about 25 would have the condition.",
    );
    expect(copy.belowOneInHundredSentence(4)).toBe(
      "Fewer than 1 in 100 — but not zero. Inherit’s estimate is about 4 in 1,000.",
    );
    expect(copy.xLinkedSentence(25, 25)).toBe(
      "Out of 100 possible pregnancies, about 25 would be boys with the condition and about 25 girls who carry it.",
    );
    expect(copy.noSecondCopy("Bo")).toBe(
      "Based on the variants your files cover, we found no second copy in Bo. This is not zero risk: your files do not cover every variant known to cause this condition.",
    );
    expect(copy.RUNS_REFUSAL).toBe(
      "These two files look more genetically similar than usual. That changes the maths in ways we cannot show you honestly here. Please talk to a genetic counsellor.",
    );
    expect(copy.cannotCalculate("Bo", "rs123")).toBe(
      "We cannot do this calculation. Bo’s file does not cover rs123.",
    );
    expect(copy.RH_ANTI_D).toBe(
      "If the pregnant parent is RhD negative and the other is RhD positive, a pregnancy may need an injection called anti-D. This is routine care, not a risk to the pregnancy.",
    );
    expect(copy.RHD_UNKNOWN).toBe(
      "Your file cannot tell whether you are RhD positive or negative. A blood test at any clinic can.",
    );
    expect(copy.CHROMOSOMAL_SEX_EXPECTATION).toBe(
      "Each conception is equally likely to get an X or a Y from the father. That is the expectation from inheritance, not an observed birth ratio.",
    );
    expect(copy.REFUSALS_HEADING).toBe("What Portrait will not tell you, and why");
    expect(copy.REFUSALS_HEADING.startsWith("What Portrait will not tell you")).toBe(true);
    expect(copy.SEE_AS_TABLE_BUTTON).toBe("See these numbers as a table");
    expect(copy.REFUSALS.find((refusal) => refusal.refusalId === "cognitive-ability")!.reason).toBe(
      "No model can estimate a future child’s cognitive ability in a way that holds up between brothers and sisters. Inherit will not print a number that cannot be checked.",
    );
  });

  it("names the blocking screen as the register's contract does", () => {
    expect(copy.blockingHeading("you and Bo")).toBe("Portrait is waiting for you and Bo");
    expect(copy.namesPhrase(["you", "Bo"])).toBe("you and Bo");
    expect(copy.namesPhrase(["Bo"])).toBe("Bo");
    expect(copy.namesPhrase(["you", "Bo", "Ana"])).toBe("you, Bo and Ana");
    expect(copy.missingStep("Bo", copy.PORTRAIT_STEPS.grant)).toBe(
      "Bo has not: turned on Portrait from their own account",
    );
    expect(copy.viewerMissingStep(copy.VIEWER_PORTRAIT_STEPS.acknowledged)).toBe(
      "You have not: read what Portrait will and will not show",
    );
    expect(copy.missingStep("Bo", copy.PORTRAIT_STEPS.account)).toBe(
      "Bo has not: opened their own Inherit account",
    );
    expect(copy.OPEN_CONSENTS_BUTTON).toBe("Open your consents");
    expect(copy.ACKNOWLEDGE_CHECKBOX_LABEL).toBe("I have read what Portrait will and will not show.");
    // Verb plus object (line 928): never a bare "Continue".
    expect(copy.ACKNOWLEDGE_BUTTON).toBe("Open Portrait");
    expect(["Submit", "OK", "Continue", "Next", "Confirm", "Yes"]).not.toContain(copy.ACKNOWLEDGE_BUTTON);
  });

  it("names every outcome, pattern, assumption, reason and trait, and no other", () => {
    expect(Object.keys(copy.OUTCOME_PHRASES).sort()).toEqual([...MENDEL_OUTCOMES].sort());
    expect(Object.keys(copy.OUTCOME_LEGEND).sort()).toEqual([...MENDEL_OUTCOMES].sort());
    expect(Object.keys(copy.PATTERN_DESCRIPTIONS).sort()).toEqual([...MENDEL_PATTERNS].sort());
    expect(Object.keys(copy.ASSUMPTION_STATEMENTS).sort()).toEqual([...MENDEL_ASSUMPTIONS].sort());
    expect(Object.keys(copy.TRAIT_HEADINGS).sort()).toEqual([...TRAIT_KEYS].sort());
    expect(Object.keys(copy.TRAIT_NAMES).sort()).toEqual([...TRAIT_KEYS].sort());
    for (const reason of CARRIER_REASONS) {
      expect(copy.carrierNoProbabilitySentence("G", reason)).toBe(
        healthPicture.carrierNoProbabilitySentence("G", reason),
      );
    }
    expect(copy.unregisteredCard(copy.TRAIT_NAMES.abo)).toBe(
      "Inherit has not registered a sourced table for blood type yet, so this card shows nothing.",
    );
  });

  it("carries eleven refusals, each with an id, a line and one sentence, and no figure", () => {
    expect(copy.REFUSALS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(copy.REFUSALS.map((refusal) => refusal.refusalId)).size).toBe(copy.REFUSALS.length);
    for (const refusal of copy.REFUSALS) {
      expect(refusal.refusalId).toMatch(/^[a-z-]+$/);
      expect(readabilitySentences(refusal.reason).length).toBeLessThanOrEqual(2);
      expect(refusal.reason).not.toMatch(/\d/);
    }
    for (const id of ["cognitive-ability", "body-measures", "polygenic-disease-risk", "sex", "ranking", "image"]) {
      expect(copy.REFUSALS.map((refusal) => refusal.refusalId)).toContain(id);
    }
  });

  it("never writes a monogenic zero, and the derivation names only outcomes that occur", () => {
    expect(copy.derivationLine(canonicalCross("recessive_one_copy_none_found").outcomes)).toBe(
      "1 in 2 (50%) carriers · 1 in 2 (50%) neither",
    );
    for (const text of corpus()) {
      expect(text, text).not.toMatch(/(^|[^\d])0%/);
      expect(text, text).not.toMatch(/\b0 in (100|1,000)\b/);
    }
  });

  it("says nothing about one child, and nothing about how the two people are related", () => {
    for (const text of corpus()) {
      expect(text, text).not.toMatch(/your child will|your baby will|your future child is|your baby’s/i);
      expect(text, text).not.toMatch(/the two of you\b/);
      expect(text, text).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to|relatedness/i);
    }
  });

  it("reads shared strings from their one home rather than respelling them", () => {
    expect(copy.HOW_SURE_HEADING).toBe(REPORT_HEADINGS[3]);
    expect(copy.COUNSELLOR_NO_ROUTE).toBe(COUNSELLOR_NO_ROUTE);
    expect(copy.NOT_DIAGNOSTIC).toBe(NOT_DIAGNOSTIC);
    expect(copy.DATA_AND_METHODS).toBe(DATA_AND_METHODS);
    expect(copy.ACKNOWLEDGE_ERROR_STATUS).toBe(GATE_ERROR_STATUS);
    expect(copy.DELETE_ERROR_STATUS).toBe(SHARING_ERROR_STATUS);
    expect(copy.PAUSED_BODY).toBe(PAUSED_BODY);
    expect(copy.UNNAMED_PERSON_LABEL).toBe(UNNAMED_PERSON_LABEL);
    expect(copy.NO_CLASSIFIED_POSITIONS).toBe(healthPicture.NO_CLASSIFIED_POSITIONS);
    expect(copy.noCarrierMatches(3)).toBe(healthPicture.noCarrierMatches(3));
  });

  it("uses typographic apostrophes and no straight quote anywhere", () => {
    for (const text of corpus()) {
      expect(text, text).not.toMatch(/'/);
      expect(text, text).not.toMatch(/&(?:apos|#39|quot);/);
    }
  });

  it("keeps every sentence under 26 words and every long block at grade 9 or below, the mandated strings aside", () => {
    // Two mandated reasons and one mandated notice grade above 9 as written
    // by the brief; they ship verbatim (X0), so the grade is checked on
    // everything else.
    const mandated = new Set([
      copy.REFUSALS.find((refusal) => refusal.refusalId === "cognitive-ability")!.reason,
      copy.RUNS_REFUSAL,
      copy.DISTINGUISHING_PRINCIPLE,
      copy.HEADER_SENTENCE,
      copy.BANNER_FIRST,
      copy.noSecondCopy("Bo"),
      copy.RH_ANTI_D,
      copy.CHROMOSOMAL_SEX_EXPECTATION,
      copy.SEGREGATION_SENTENCE,
    ]);
    for (const text of corpus()) {
      if (mandated.has(text)) continue;
      for (const sentence of readabilitySentences(text)) {
        expect(wordCount(sentence), sentence).toBeLessThanOrEqual(25);
      }
      if (wordCount(text) >= 15) {
        expect(fleschKincaidGrade(withTermsReplaced(text)), text).toBeLessThanOrEqual(9);
      }
    }
  });

  it("writes every short role in registered plain words", () => {
    for (const [name, text] of shortRoleStrings()) {
      for (const word of vocabularyWords(text)) {
        if (word === "fact") continue;
        expect(VOCABULARY.has(word), `${name}: ${word} (${text})`).toBe(true);
      }
    }
  });

  it("keeps registered terms out of headings, buttons and labels", () => {
    const pattern = (term: string) =>
      new RegExp(
        `(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`,
        "i",
      );
    for (const [name, text] of shortRoleStrings()) {
      for (const term of JARGON) {
        expect(pattern(term).test(text), `${name}: ${term} (${text})`).toBe(false);
      }
    }
  });
});
