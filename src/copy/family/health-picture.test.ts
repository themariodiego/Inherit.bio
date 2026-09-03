import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fleschKincaidGrade, readabilitySentences, wordCount } from "../../../scripts/readability";
import { vocabularyWords } from "../../../scripts/readability-gate";
import { CARRIER_REASONS } from "../../lib/family/carrier-pair";
import { naturalFrequency } from "../../lib/figures/natural-frequency";
import { REPORT_HEADINGS } from "../reports/headings";
import {
  COUNSELLOR_NO_ROUTE,
  LAYER_DEFINITIONS,
  LAYER_LABELS,
  NOT_DIAGNOSTIC,
  NO_RANGE_YET,
  PROVENANCE_LINE,
} from "../reports/strings";
import { BASELINE_ABSENT as PERSON_BASELINE_ABSENT } from "./person";
import * as copy from "./health-picture";

/**
 * The health-picture copy registry (design §4). The strings the brief quotes
 * ship character-for-character with U+2019 and U+2014; everything written
 * here is graded, capped and checked word by word in its short role exactly
 * as the readability gate will check it.
 */

/** Every exported string, including the ones the exported functions produce. */
function corpus(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const value of Object.values(copy)) {
    if (typeof value === "function") {
      walk((value as (...args: unknown[]) => string)("Bo", 3));
      walk((value as (...args: unknown[]) => string)("Bo", "dominant"));
      walk((value as (...args: unknown[]) => string)("estimate"));
      walk((value as (...args: unknown[]) => string)("Bo", 999_999_001, "TESTGENE", "Pathogenic"));
    } else walk(value);
  }
  return out;
}

/** The strings the gate checks word by word against the plain vocabulary. */
function shortRoleStrings(): [string, string][] {
  return [
    ["HEALTH_PICTURE_H1", copy.HEALTH_PICTURE_H1],
    ["CARRIER_MATCHES_HEADING", copy.CARRIER_MATCHES_HEADING],
    ["SIDE_BY_SIDE_HEADING", copy.SIDE_BY_SIDE_HEADING],
    ["HOW_SURE_HEADING", copy.HOW_SURE_HEADING],
    ["WHERE_FROM_HEADING", copy.WHERE_FROM_HEADING],
    ["TRADE_OFF_PANEL_LABEL", copy.TRADE_OFF_PANEL_LABEL],
    ["OPEN_LINK", copy.OPEN_LINK],
    ["openReportLabel", copy.openReportLabel("fact", "fact")],
    ["genotypeLabel", copy.genotypeLabel("fact")],
    ["CELL_NO_FILE", copy.CELL_NO_FILE],
    ["CELL_FILES_DISAGREE", copy.CELL_FILES_DISAGREE],
    ["CELL_NOT_SHARED", copy.CELL_NOT_SHARED],
    // `cellNotCovered` is deliberately absent: it renders in a paragraph, and
    // its one variable is a person's name, whose possessive can never be a
    // registered word.
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

/**
 * X7.3 keeps registered terms out of short roles. One string is exempt and
 * the exemption is named rather than left implicit: the two layer labels are
 * X5.1's mandated renaming and already ship as chips, tabs and count nouns.
 */
const TERM_EXEMPTIONS = new Set<string>(["LAYER_CHIP_LABELS.variant_call"]);

function withTermsReplaced(text: string): string {
  let result = text;
  for (const term of [...JARGON].sort((left, right) => right.length - left.length)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi"), "fact");
  }
  return result;
}

describe("health-picture copy", () => {
  it("ships the brief's quoted strings character-for-character", () => {
    expect(copy.COMPARISON_BANNER).toBe(
      "These are different people compared against different baselines. A bigger number in one column does not mean that person is worse off.",
    );
    expect(copy.NO_RANKING_STATEMENT).toBe(
      "Inherit does not rank embryos and does not recommend one.",
    );
    expect(copy.NOTHING_PICKS_BETWEEN_PEOPLE).toBe(
      "Nothing here picks between people. A lower chance on one row for one person says nothing about any other row or person.",
    );
    expect(copy.availabilityStatement(2)).toBe(
      "This page shows 2 people because 2 people have agreed to be seen side by side. It shows nothing about anyone who has not.",
    );
    expect(copy.perPersonTradeOff("Bo", 4)).toBe("Bo: 4 results, none compared with anyone else.");
    expect(copy.needsTwoPeople(1)).toBe(
      "This page needs two people who have both agreed to be seen side by side. So far there is 1.",
    );
    expect(copy.noCarrierMatches(12)).toBe(
      "No change to show that you both carry. Inherit checked the 12 positions both files cover.",
    );
    expect(copy.cellNotCovered("Bo")).toBe("Not in Bo’s file");
    expect(copy.BASELINE_ABSENT).toBe(
      "No baseline: Inherit does not know this person’s sex and age band.",
    );
  });

  it("names the cell of a layer another adult has not shared, in words and without a figure (D-038)", () => {
    expect(copy.CELL_NOT_SHARED).toBe("Not shared with you");
    expect(copy.CELL_NOT_SHARED).not.toMatch(/\d/);
  });

  it("says in words that there is nothing to check when the reference table classifies nothing (D-034)", () => {
    expect(copy.NO_CLASSIFIED_POSITIONS).toBe(
      "Inherit has no classified positions to check yet, so it cannot look for a change you both carry.",
    );
    expect(copy.NO_CLASSIFIED_POSITIONS).not.toMatch(/\d/);
    expect(copy.NO_CLASSIFIED_POSITIONS).not.toContain("checked the");
  });

  it("renders the mandated carrier sentence around its own figure", () => {
    // The figure the block renders at the denominator the sentence states.
    const figure = naturalFrequency(0.25, 100).text;
    expect(figure).toBe("about 25 in 100");
    expect(copy.carrierProbabilitySentence(figure)).toBe(
      "For each pregnancy, about 25 in 100 — a 1 in 4 chance — that a child inherits both copies. Each pregnancy is independent; this is not 1 in 4 of your children.",
    );
    // The two halves join with exactly one space and no stray punctuation.
    expect(copy.CARRIER_SENTENCE_LEAD).toBe("For each pregnancy,");
    expect(copy.CARRIER_SENTENCE_TAIL.startsWith("—")).toBe(true);
  });

  it("names each person's own variant and its classification, not just the gene (brief line 346)", () => {
    expect(copy.personVariantLine("Bo", 999_999_001, "E2EGENE1", "Pathogenic")).toBe(
      "Bo: rs999999001 in E2EGENE1, which outside reviewers class as Pathogenic.",
    );
    // The classification is the reference row's own label, unaltered.
    expect(copy.personVariantLine("Bo", 1, "G", "Pathogenic/Likely pathogenic")).toContain(
      "class as Pathogenic/Likely pathogenic.",
    );
  });

  it("names every reason in the closed table of eight, and no other", () => {
    expect(Object.keys(copy.CARRIER_REASON_PHRASES).sort()).toEqual([...CARRIER_REASONS].sort());
    expect(CARRIER_REASONS).toHaveLength(8);
    expect(copy.CARRIER_REASON_PHRASES.dominant).toBe("the change runs in a dominant pattern");
    expect(copy.CARRIER_REASON_PHRASES.harmless).toBe("the change is classed as harmless");
    expect(copy.CARRIER_REASON_PHRASES["unknown-meaning"]).toBe(
      "nobody yet knows what this change means",
    );
    expect(copy.CARRIER_REASON_PHRASES["copies-unknown"]).toBe(
      "one file does not show how many copies were read",
    );
    expect(copy.CARRIER_REASON_PHRASES["no-pattern"]).toBe(
      "Inherit has no recorded inheritance pattern for this gene",
    );
    expect(copy.CARRIER_REASON_PHRASES["runs-unchecked"]).toBe(
      "Inherit could not check how much of one file is made of long identical stretches",
    );
    // The two beyond the design's six: what is not recorded, said truly
    // (D-031), and two changed copies named rather than dropped (D-035).
    expect(copy.CARRIER_REASON_PHRASES["sex-unknown"]).toBe(
      "this pattern depends on which parent carries the change on the X, and Inherit does not record that",
    );
    expect(copy.CARRIER_REASON_PHRASES["two-copies"]).toBe(
      "one file shows two changed copies, not one",
    );
    expect(copy.carrierNoProbabilitySentence("BRCA2", "dominant")).toBe(
      "Both of you have a change in BRCA2, but Inherit cannot turn that into a chance for a pregnancy. Reason: the change runs in a dominant pattern.",
    );
  });

  it("carries no number in any refusal sentence", () => {
    for (const reason of CARRIER_REASONS) {
      const sentence = copy.carrierNoProbabilitySentence("TESTGENE", reason);
      expect(sentence, reason).not.toMatch(/\d/);
      expect(sentence, reason).not.toContain("0%");
    }
  });

  it("reads shared strings from their one home rather than respelling them", () => {
    expect(copy.BASELINE_ABSENT).toBe(PERSON_BASELINE_ABSENT);
    expect(copy.NOT_DIAGNOSTIC).toBe(NOT_DIAGNOSTIC);
    expect(copy.NO_RANGE_YET).toBe(NO_RANGE_YET);
    expect(copy.PROVENANCE_LINE).toBe(PROVENANCE_LINE);
    expect(copy.COUNSELLOR_NO_ROUTE).toBe(COUNSELLOR_NO_ROUTE);
    expect(copy.HOW_SURE_HEADING).toBe(REPORT_HEADINGS[3]);
    expect(copy.WHERE_FROM_HEADING).toBe(REPORT_HEADINGS[5]);
    expect(copy.LAYER_CHIP_LABELS).toBe(LAYER_LABELS);
    expect(copy.tableCaption("estimate")).toBe(
      `${LAYER_LABELS.estimate} — ${LAYER_DEFINITIONS.estimate}`,
    );
  });

  it("says nothing about how the people on the page are related", () => {
    for (const text of corpus()) {
      expect(text, text).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to|relatedness/i);
    }
  });

  it("uses typographic apostrophes and no straight quote anywhere", () => {
    for (const text of corpus()) {
      expect(text, text).not.toMatch(/'/);
      expect(text, text).not.toMatch(/&(?:apos|#39|quot);/);
    }
  });

  it("keeps every sentence under 26 words and every long block at grade 9 or below", () => {
    for (const text of corpus()) {
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
      if (TERM_EXEMPTIONS.has(name)) continue;
      for (const term of JARGON) {
        expect(pattern(term).test(text), `${name}: ${term} (${text})`).toBe(false);
      }
    }
  });
});
