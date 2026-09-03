import { describe, expect, it } from "vitest";
import fixtures from "./readability-fixtures.json";
import {
  fleschKincaidGrade,
  normalizeForReadability,
  readabilityCounts,
  readabilitySentences,
  wordCount,
} from "./readability";

describe("readability scorer", () => {
  it("normalizes opaque scientific tokens before scoring", () => {
    expect(normalizeForReadability("rs123 BRCA1 25 mg chr20:10")).toBe(
      "fact fact fact fact fact",
    );
  });

  it("counts words, sentences, and syllables deterministically", () => {
    expect(readabilityCounts("The cat sat. The dog ran.")).toEqual({
      sentence: 2,
      word: 6,
      syllable: 6,
    });
  });

  it("splits sentence boundaries without dropping questions", () => {
    expect(readabilitySentences("This is clear. Is it useful? Yes!")).toHaveLength(3);
  });

  it("counts contractions as one word", () => {
    expect(wordCount("This doesn't predict your future.")).toBe(5);
  });

  it("matches every committed calibration fixture", () => {
    for (const fixture of fixtures.cases) {
      expect(
        Math.abs(fleschKincaidGrade(fixture.text) - fixture.expectedGrade),
        `${fixture.id} drifted from the pinned scorer`,
      ).toBeLessThanOrEqual(fixtures.tolerance);
    }
  });
});
