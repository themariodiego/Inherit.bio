import { describe, expect, it } from "vitest";
import { wordCount, readabilitySentences } from "../../../scripts/readability";
import { EVIDENCE_DEFINITIONS } from "./evidence";
import {
  EMBRYO_HEADING_SUBSTITUTIONS,
  REPORT_HEADINGS,
  REPORT_HEADING_IDS,
  headingText,
} from "./headings";
import * as strings from "./strings";

/** Every exported string, including those produced by the exported functions. */
function corpus(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const value of Object.values(strings)) {
    if (typeof value === "function") {
      walk((value as (...args: number[]) => string)(1, 2));
      walk((value as (...args: number[]) => string)(151, 424));
    } else walk(value);
  }
  return out;
}

describe("report headings", () => {
  it("are the six X13.1 headings in order with fixed ids", () => {
    expect([...REPORT_HEADINGS]).toEqual([
      "What this is",
      "Your result",
      "What this doesn’t mean",
      "How sure we are",
      "What you can do",
      "Where this comes from",
    ]);
    expect(Object.values(REPORT_HEADING_IDS)).toEqual([
      "what-this-is",
      "your-result",
      "what-this-doesnt-mean",
      "how-sure-we-are",
      "what-you-can-do",
      "where-this-comes-from",
    ]);
  });

  it("substitutes exactly one heading on the embryo surface", () => {
    expect(EMBRYO_HEADING_SUBSTITUTIONS).toEqual({
      "What you can do": "What this does and does not tell you",
    });
    expect(headingText("What you can do", "embryo")).toBe("What this does and does not tell you");
    expect(headingText("Your result", "embryo")).toBe("Your result");
    expect(headingText("What you can do", "adult")).toBe("What you can do");
  });
});

describe("report strings", () => {
  it("ship the mandated sentences character-for-character", () => {
    expect(strings.LIMIT_OF_FILE).toBe("This is a limit of your file, not a result about you.");
    expect(strings.NO_RANGE_YET).toBe(
      "We can’t put a range on this yet, so we don’t show a single number.",
    );
    expect(strings.NOT_DIAGNOSTIC).toBe(
      "This is not a diagnosis. Inherit is not a doctor and no clinician has reviewed this. Talk to a qualified professional before acting on anything here.",
    );
    expect(strings.NOT_COVERED_VCF.startsWith("Your file does not cover this variant. ")).toBe(true);
    expect(strings.cannotNumberLine(151)).toBe(
      "151 of these reports cannot give you a number yet. Why?",
    );
    expect(strings.coverageSentence(0, 2)).toBe(
      "Your file covered 0 of the 2 positions this estimate uses.",
    );
    expect(strings.fileCount(1)).toBe("1 file");
    expect(strings.fileCount(3)).toBe("3 files");
    expect(strings.supportingStudies(1)).toBe("1 supporting study");
    expect(strings.supportingStudies(2)).toBe("2 supporting studies");
  });

  it("use typographic apostrophes and keep every sentence within 32 words", () => {
    for (const text of corpus()) {
      expect(text, text).not.toMatch(/[A-Za-z]'[A-Za-z]/);
      for (const sentence of readabilitySentences(text)) {
        expect(wordCount(sentence), sentence).toBeLessThanOrEqual(32);
      }
    }
  });

  it("splits the VCF explanation into four sentences of 7 / 22 / 20 / 15 words", () => {
    expect(readabilitySentences(strings.NOT_COVERED_VCF).map(wordCount)).toEqual([7, 22, 20, 15]);
  });

  it("keeps every category description to one sentence of at most 15 words", () => {
    for (const [id, description] of Object.entries(strings.CATEGORY_DESCRIPTIONS)) {
      expect(readabilitySentences(description), id).toHaveLength(1);
      expect(wordCount(description), id).toBeLessThanOrEqual(15);
      expect(description, id).not.toMatch(/\b(genotype|variant|allele|polygenic)s?\b/i);
    }
    expect(Object.keys(strings.CATEGORY_DESCRIPTIONS)).toHaveLength(9);
  });

  it("keeps every evidence definition within 20 words", () => {
    for (const [level, definition] of Object.entries(EVIDENCE_DEFINITIONS)) {
      expect(wordCount(definition), level).toBeLessThanOrEqual(20);
    }
  });

  it("never merges counts: each layer has its own noun", () => {
    expect(strings.COUNT_NOUNS.estimate.other).toBe("statistical estimates");
    expect(strings.COUNT_NOUNS["variant-call"].other).toBe("specific-variant reports");
    expect(strings.LAYER_LABELS).toEqual({
      variant_call: "Specific variants",
      estimate: "Statistical estimates",
    });
  });
});
