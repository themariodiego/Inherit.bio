import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatisticalCoverage } from "./statistical-coverage";
import { statisticalCoverageReadSchema } from "@/lib/embryos/statistical-read";
import { INSUFFICIENT_COVERAGE_INTRO } from "@/copy/embryos/compare";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(matched = 2) {
  return statisticalCoverageReadSchema.parse({ version: 1, producer: "embryo-test-score-coverage-v1",
    jurisdiction: "TEST-LOCAL", cohortId: id(1), publicationRevision: 1, jobId: id(2), attempt: 1,
    captureSha256: "d".repeat(64), interpretation: "held", rows: [{ embryoId: id(10), sampleOrdinal: 0,
      conditionId: "SYNTHETIC:9001", conditionName: "Synthetic score coverage", coverageState: "not_covered",
      reason: matched < 8 ? "insufficient_coverage" : "sex_combined_model_unavailable",
      matchedVariants: matched, requiredVariants: 10, scoreCoverage: matched / 10,
      finding: matched < 8 ? { schema_version: 2, figure_basis: { version: 1, basis: "observed" },
        kind: "coverage_failure", metric: "score_coverage", measured_value: matched / 10,
        required_minimum: 0.8, display_copy_id: "embryo.result.insufficient-coverage" } : null }] });
}
const subjectIds = new Map([[id(10), id(20)]]);
describe("honest synthetic statistical coverage surface", () => {
  it("attributes the original insufficient-coverage copy and full denominator to the actual own subject", () => {
    const html = renderToStaticMarkup(createElement(StatisticalCoverage, { value: fixture(), subjectIds }));
    expect(html).toContain("Synthetic TEST score coverage");expect(html).toContain('data-interpretation="held"');
    expect(html).toContain("It gives no medical interpretation.");
    expect(html).toContain(`data-subject-id="${id(20)}"`);expect(html).toContain(INSUFFICIENT_COVERAGE_INTRO);
    expect(html).toContain('data-figure-kind="coverage"');expect(html).toContain('data-finding-kind="coverage_failure"');
    expect(html).not.toMatch(/data-figure-kind="(?:absolute|relative|interval|percentile)"|data-modelled-marker|aria-sort/);
  });
  it("keeps inclusive-floor model absence nonnumeric rather than rendering a positive estimate", () => {
    const html = renderToStaticMarkup(createElement(StatisticalCoverage, { value: fixture(8), subjectIds }));
    expect(html).toContain("No population figure");expect(html).toContain('data-finding-kind="none"');
    expect(html).not.toContain('data-figure-kind="coverage"');expect(html).not.toContain('data-modelled-marker');
  });
  it("does not substitute a zero count for a genuine QC hold", () => {
    const value = fixture();Object.assign(value.rows[0], { coverageState: "quality_not_measurable",
      reason: "embryo_call_rate", matchedVariants: null, requiredVariants: null, scoreCoverage: null, finding: null });
    const html = renderToStaticMarkup(createElement(StatisticalCoverage, { value, subjectIds }));
    expect(html).toContain("Not measurable");expect(html).not.toContain('data-figure-kind="coverage"');
    expect(html).not.toContain(INSUFFICIENT_COVERAGE_INTRO);
  });
  it.each(["missing-subject", "foreign-embryo"])("refuses %s without an attribution fallback", fault => {
    expect(() => renderToStaticMarkup(createElement(StatisticalCoverage, { value: fixture(),
      subjectIds: fault === "missing-subject" ? new Map() : subjectIds,
      embryoId: fault === "foreign-embryo" ? id(99) : undefined }))).toThrow("Own embryo attribution required");
  });
});
