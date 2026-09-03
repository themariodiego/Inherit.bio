import { describe, expect, it } from "vitest";
import { NATURAL_FREQUENCY_FLOOR } from "./contract";
import {
  PERCENTAGE_POINTS_GLOSS,
  chooseDenominator,
  differencePercentagePoints,
  formatPercent,
  intervalSentence,
  naturalFrequency,
  percentileSentence,
  pointSentence,
  renderNaturalFrequencyPair,
} from "./natural-frequency";

describe("chooseDenominator", () => {
  it("picks the smallest ladder step where both counts are ≥ 1 and distinct", () => {
    expect(chooseDenominator([0.12, 0.09])).toBe(100); // 12 vs 9
    expect(chooseDenominator([0.004, 0.002])).toBe(1000); // 4 vs 2
    expect(chooseDenominator([0.0004, 0.0002])).toBe(10000); // 4 vs 2
  });

  it("lets values that are the same at display precision share a count", () => {
    // At 100 both round to 4, but they differ by 0.002 < 0.5/100 = 0.005, so they
    // are "the same" at that precision and may share the integer.
    expect(chooseDenominator([0.043, 0.041])).toBe(100);
    expect(chooseDenominator([0.5, 0.5])).toBe(100);
  });

  it("moves up the ladder when values differ by display precision but collide", () => {
    // 0.044 and 0.036 differ by 0.008 ≥ 0.5/100 yet both round to 4 at 100, so the ladder climbs.
    expect(chooseDenominator([0.044, 0.036])).toBe(1000); // 44 vs 36
  });

  it("returns null when even a million is too coarse", () => {
    expect(chooseDenominator([0.0000004, 0.0000002])).toBeNull();
    expect(chooseDenominator([0])).toBeNull();
  });

  it("handles a single value", () => {
    expect(chooseDenominator([0.12])).toBe(100);
    expect(chooseDenominator([0.003])).toBe(1000);
  });

  it("refuses an empty list", () => {
    expect(() => chooseDenominator([])).toThrow();
  });
});

describe("naturalFrequency and the pair sentence", () => {
  it("reads about N in D with en-GB grouping", () => {
    expect(naturalFrequency(0.12, 100)).toEqual({ count: 12, denominator: 100, text: "about 12 in 100" });
    expect(naturalFrequency(0.0043, 1000).text).toBe("about 4 in 1,000");
    expect(naturalFrequency(0.5, 1000000).text).toBe("about 500,000 in 1,000,000");
  });

  it("renders both figures on one denominator", () => {
    expect(renderNaturalFrequencyPair(0.12, 0.09, "people like you", "men aged 40 to 49")).toBe(
      "About 12 in 100 people like you. About 9 in 100 men aged 40 to 49.",
    );
    expect(renderNaturalFrequencyPair(0.004, 0.002, "people like you", "women aged 30 to 39")).toBe(
      "About 4 in 1,000 people like you. About 2 in 1,000 women aged 30 to 39.",
    );
  });

  it("honours an imposed block denominator", () => {
    expect(renderNaturalFrequencyPair(0.12, 0.09, "a", "b", 1000)).toBe(
      "About 120 in 1,000 a. About 90 in 1,000 b.",
    );
    expect(renderNaturalFrequencyPair(0.12, 0.09, "a", "b", null)).toBe(NATURAL_FREQUENCY_FLOOR);
  });

  it("falls to the floor string below one in a million", () => {
    expect(renderNaturalFrequencyPair(0.0000004, 0.0000002, "a", "b")).toBe(NATURAL_FREQUENCY_FLOOR);
  });
});

describe("formatPercent", () => {
  it("rounds by magnitude: two significant figures, one decimal, whole", () => {
    expect(formatPercent(0.00043)).toBe("0.043%");
    expect(formatPercent(0.023)).toBe("2.3%");
    expect(formatPercent(0.1234)).toBe("12%");
  });

  it("groups large numerals and handles the 9.96 edge without printing 10.0%", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.0996)).toBe("10%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("sentences", () => {
  it("writes percentiles as a clamped whole-number sentence", () => {
    expect(percentileSentence(80.4)).toBe("higher than about 80 of every 100 people like you");
    expect(percentileSentence(0)).toBe("higher than about 1 of every 100 people like you");
    expect(percentileSentence(100)).toBe("higher than about 99 of every 100 people like you");
  });

  it("uses the §2.6 wording for point and range", () => {
    expect(pointSentence(0.12)).toBe("Your estimated risk is 12%.");
    expect(intervalSentence(0.12, 0.08, 0.17)).toBe("It could reasonably be 8.0% to 17%.");
  });

  it("widens a range so it always brackets its point", () => {
    expect(intervalSentence(0.2, 0.08, 0.17)).toBe("It could reasonably be 8.0% to 20%.");
  });

  it("reports differences in percentage points with the fixed gloss", () => {
    expect(differencePercentagePoints(0.12, 0.09)).toEqual({
      points: expect.closeTo(3, 10) as number,
      text: "3.0 percentage points higher",
    });
    expect(differencePercentagePoints(0.09, 0.12).text).toBe("3.0 percentage points lower");
    expect(differencePercentagePoints(0.0123, 0.01).text).toBe("0.2 percentage points higher");
    expect(PERCENTAGE_POINTS_GLOSS).toBe("(percentage points, not percent)");
  });
});
