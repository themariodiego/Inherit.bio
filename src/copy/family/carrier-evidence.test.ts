import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fleschKincaidGrade, readabilitySentences, wordCount } from "../../../scripts/readability";
import {
  LAB_CONFIRMATION_LINE,
  PENETRANCE_NOT_ESTABLISHED,
  assertionSourceLine,
  reviewedVariantLine,
  writtenDate,
} from "./carrier-evidence";

/**
 * The evidence a reviewed carrier finding carries (brief §4, lines
 * 1329-1335). Two strings are the brief's own and ship exactly; the rest are
 * checked as the readability gate checks copy: sentence length, grade and
 * typography, with realistic values in the slots.
 */
const brief = fs.readFileSync(path.join(process.cwd(), "docs/inherit-v2-brief.md"), "utf8");
/** The gate grades a block with each registered term read as one plain word, and so does this test. */
const JARGON = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/jargon.json"), "utf8")) as {
  terms: { term: string; aliases?: string[] }[];
}).terms.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])]);
function withTermsReplaced(text: string): string {
  let result = text;
  for (const term of [...JARGON].sort((left, right) => right.length - left.length)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi"), "fact");
  }
  return result;
}
const F508 = { variantName: "NM_000492.3(CFTR):c.1521_1523del (p.Phe508del)", reviewStatus: "practice guideline",
  lastEvaluated: "2004-03-03" };

describe("reviewed carrier evidence copy", () => {
  it("ships the brief's laboratory line and penetrance label character for character", () => {
    expect(brief).toContain(`"${LAB_CONFIRMATION_LINE}"`);
    expect(brief).toContain(`"${PENETRANCE_NOT_ESTABLISHED}"`);
  });

  it("names the variant, the classification, ClinVar's review status and the date, as text", () => {
    expect(reviewedVariantLine("You", F508, "CFTR", "Pathogenic")).toBe(
      "You: NM_000492.3(CFTR):c.1521_1523del (p.Phe508del) in CFTR. ClinVar classifies it as pathogenic "
      + "(review status: practice guideline; last evaluated 3 March 2004).");
    expect(reviewedVariantLine("Another adult", { ...F508, lastEvaluated: null }, "CFTR", "Likely pathogenic"))
      .toContain("(review status: practice guideline; no date recorded).");
  });

  it("writes a date the same way in every time zone and locale", () => {
    expect(writtenDate("2004-03-03")).toBe("3 March 2004");
    expect(writtenDate("2026-12-31")).toBe("31 December 2026");
  });

  it("attributes ClinVar and ClinGen, and never calls a test release ClinVar", () => {
    expect(assertionSourceLine("clinvar-2026-09", "2026-09-28")).toBe(
      "Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.");
    expect(assertionSourceLine("synthetic-e2e-portrait", "2026-09-28")).toBe("Classifications from a test release, not from ClinVar.");
  });

  it("keeps every sentence short, every long block at grade 9 or below, and no straight quote", () => {
    const texts = [
      LAB_CONFIRMATION_LINE,
      PENETRANCE_NOT_ESTABLISHED,
      assertionSourceLine("clinvar-2026-09", "2026-09-28"),
      assertionSourceLine("synthetic-e2e-portrait", "2026-09-28"),
      reviewedVariantLine("fact", { variantName: "fact", reviewStatus: "fact", lastEvaluated: "2004-03-03" }, "fact", "fact"),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/'/);
      for (const sentence of readabilitySentences(text)) expect(wordCount(sentence), sentence).toBeLessThanOrEqual(25);
      if (wordCount(text) >= 15) expect(fleschKincaidGrade(withTermsReplaced(text)), text).toBeLessThanOrEqual(9);
    }
  });
});
