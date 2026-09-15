import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGIONAL_AIMS, REGIONAL_CONFUSABLE } from "../../src/lib/genome/regional-admixture";
import { REGIONAL_FIXTURES, buildRegionalVcf, estimateRegionalFixture } from "../../e2e/fixtures/generate-regional-aims-vcf";

describe("independent synthetic seven-region browser fixtures", () => {
  it.each(REGIONAL_FIXTURES)("$name regenerates exactly and exercises its intended strict reporting branch", async fixture => {
    const stored = readFileSync(`e2e/fixtures/${fixture.name}`, "utf8");
    expect(buildRegionalVcf(fixture.seed, fixture.weights)).toBe(stored);
    const result = await estimateRegionalFixture(stored);
    expect(result.markersUsed).toBe(REGIONAL_AIMS.length);
    expect(result.fit.converged).toBe(true);
    expect(result.reporting.merged).toBe(fixture.merged);
    const above = REGIONAL_CONFUSABLE.filter(code => result.proportions![code] > 0.1).length;
    if (fixture.merged) expect(above).toBeGreaterThanOrEqual(2);
    else expect(above).toBeLessThan(2);
  });
});
