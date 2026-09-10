import { describe, expect, it } from "vitest";
import { reportCoverage, reportMethod, summarizeReportCalls, unavailablePolygenicCount, validSourceReadDate } from "./report-evidence";
import { resolveTemplate, type ReportTemplate } from "./reports";

const template: ReportTemplate = {
  slug: "fixture", category: "basic-traits", title: "Fixture", summary: "Fixture",
  evidence: "preliminary", pgs_id: null, citations: [],
  variants: Array.from({ length: 5 }, (_, i) => ({
    rsid: i + 1, gene: "GENE", chrom: 1, pos38: i + 1, ref: "A", alt: "C",
    interpretations: { AA: "Fixture reading" },
  })),
};

describe("report method identity", () => {
  it("counts unavailable polygenic scores, not useful single-position reports", () => {
    expect(unavailablePolygenicCount([])).toBe(0);
    expect(unavailablePolygenicCount(Array.from({ length: 151 }, () => ({ ...template, estimate_kind: "single_locus" })))).toBe(0);
    expect(unavailablePolygenicCount([
      template,
      { ...template, layer: "variant_call" },
      { ...template, layer: "estimate", estimate_kind: "polygenic_score", pgs_id: "PGS000001" },
      { ...template, pgs_id: "PGS000002" },
    ])).toBe(2);
    // Broken model identity must not quietly suppress an unavailable-score notice.
    expect(unavailablePolygenicCount([{ ...template, estimate_kind: "polygenic_score", pgs_id: null }])).toBe(1);
    expect(unavailablePolygenicCount([{ ...template, estimate_kind: "single_locus", pgs_id: "invalid" }])).toBe(1);
    expect(unavailablePolygenicCount([{ ...template, layer: "variant_call", pgs_id: "PGS000001" }])).toBe(0);
  });

  it("does not describe a position-based template as a polygenic score", () => {
    expect(reportMethod(template)).toBe("position-association");
    expect(reportMethod({ ...template, estimate_kind: "single_locus" })).toBe("position-association");
    expect(reportMethod({ ...template, layer: "variant_call", category: "pharmacogenomics" })).toBe("guideline-position");
    expect(reportMethod({ ...template, layer: "variant_call" })).toBe("specific-position");
  });
  it("requires a valid model identifier and a consistent estimate kind", () => {
    expect(reportMethod({ ...template, pgs_id: "PGS000001" })).toBe("polygenic-score");
    expect(reportMethod({ ...template, pgs_id: "PGS000001", estimate_kind: "single_locus" })).toBe("unavailable");
    expect(reportMethod({ ...template, estimate_kind: "polygenic_score" })).toBe("unavailable");
    expect(reportMethod({ ...template, pgs_id: "../../elsewhere" })).toBe("unavailable");
  });
});

describe("report call accounting", () => {
  it("partitions all resolver states without counting a conflicting call as interpreted", () => {
    const report = resolveTemplate(template, (rsid) => ["A/A", "A/A", "--", "A/G", undefined][rsid - 1]);
    expect(summarizeReportCalls(report, new Set([2]))).toEqual({
      interpreted: 1, conflicting: 1, "no-call": 1, unrecognized: 1, unavailable: 1,
    });
  });
  it("keeps conflicts distinct even when the loader removes the stored call", () => {
    const report = resolveTemplate(template, () => undefined);
    expect(summarizeReportCalls(report, new Set([1, 2]))).toEqual({
      interpreted: 0, conflicting: 2, "no-call": 0, unrecognized: 0, unavailable: 3,
    });
  });
  it("does not count reference-panel or unrelated conflicts as subject coverage", () => {
    const report = resolveTemplate(template, () => "A/A");
    expect(summarizeReportCalls(report, new Set([999])).interpreted).toBe(5);
    expect(summarizeReportCalls({ ...report, variants: [] }, new Set())).toEqual({
      interpreted: 0, conflicting: 0, "no-call": 0, unrecognized: 0, unavailable: 0,
    });
  });
  it("counts repeated positions once even when their entries resolve differently", () => {
    const report = resolveTemplate(template, () => "A/A");
    const repeated = { ...report, variants: [report.variants[0], { ...report.variants[0], outcome: { status: "unrecognized" as const, genotype: "AA" } }] };
    expect(summarizeReportCalls(repeated, new Set())).toEqual({ interpreted: 1, conflicting: 0, "no-call": 0, unrecognized: 0, unavailable: 0 });
    expect(summarizeReportCalls(repeated, new Set([1]))).toEqual({ interpreted: 0, conflicting: 1, "no-call": 0, unrecognized: 0, unavailable: 0 });
  });
});

describe("one coverage figure for a report, wherever it is shown", () => {
  it("does not count a position the subject's files disagree about as read", () => {
    const report = resolveTemplate(template, () => "A/A");
    // The outcome the surfaces used to count is still `genotyped`: the
    // disagreement lives in the conflict set, not in the resolved outcome, so
    // a rule that reads only the outcome counts this position as read. The
    // report page never showed it, and the list did.
    expect(report.variants.every((entry) => entry.outcome.status === "genotyped")).toBe(true);
    expect(reportCoverage(template, report, new Set([2, 3]))).toEqual({ read: 3, needed: 5 });
    expect(reportCoverage(template, report, new Set())).toEqual({ read: 5, needed: 5 });
  });
  it("counts a position once however many template entries name it", () => {
    const report = resolveTemplate(template, () => "A/A");
    const twice = { ...template, variants: [template.variants[0], { ...template.variants[0] }] };
    expect(reportCoverage(twice, { ...report, variants: [report.variants[0], report.variants[0]] }, new Set()))
      .toEqual({ read: 1, needed: 1 });
  });
});

describe("source-read dates", () => {
  it("retains actual recorded dates without borrowing the deployment date", () => {
    expect(validSourceReadDate("2026-09-04")).toBe("2026-09-04");
    expect(validSourceReadDate("2024-02-29")).toBe("2024-02-29");
  });
  it.each([undefined, "", "2026-02-29", "2026-09-31", "yesterday", "2026-09-04T12:00:00Z"])("refuses an absent or invalid date: %s", (value) => {
    expect(validSourceReadDate(value)).toBeNull();
  });
});
