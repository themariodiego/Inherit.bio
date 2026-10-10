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


// Every test result is calculated from the unchanged complete invented data;
// constructing a schema fixture grants no native publication authority.
import { statisticalFittedReadSchema, canonicalStatisticalFitPackage, statisticalFitPackageDigest,
  evaluateStatisticalFitResult, STATISTICAL_FIT_ARTIFACT_SHA256, STATISTICAL_FIT_PANEL_SHA256 } from "@/lib/embryos/statistical-fit-contract";
import { TEST_STATISTICAL_SCORE_PANEL, measureEmbryoStatisticalCoverage } from "@/lib/embryos/statistical-coverage";
import { SYNTHETIC_FIT_POPULATION } from "@/lib/embryos/synthetic-statistical-fit";
import { MODELLED_MARKER } from "@/lib/figures/contract";
import { readFileSync } from "node:fs";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "@/lib/embryos/vcf-transport";
import { analyseEmbryoFragment, embryoOrdinalOutcome, type EmbryoSplitRow } from "@/lib/embryos/split-analysis";

function fittedFixture(matched = 8, held = false) {
  const source = { cohort_id: id(1), embryo_id: id(10), subject_id: id(20), file_id: id(30), canonical_build: "GRCh38",
    source_sha256: "b".repeat(64), source_binding_fingerprint: "b".repeat(64), source_publication_revision: 1,
    upload_revision: 1, normalization_source_revision: 1, call_immutability_proof: "exact-staged-calls-v1" };
  const calls = TEST_STATISTICAL_SCORE_PANEL.variants.slice(0, matched).map(row => ({ fileId: source.file_id,
    chrom: row.chrom, pos: row.pos, ref: row.otherAllele, alt: row.effectAllele, genotype: `${row.otherAllele}/${row.effectAllele}` }));
  const measured = measureEmbryoStatisticalCoverage({ panel: TEST_STATISTICAL_SCORE_PANEL, source, calls });
  if (!measured.ok) throw new Error("Invalid own-call fixture");
  const evaluated = evaluateStatisticalFitResult({ source, calls, qc: { callRate: 1, contamination: null, alleleDropout: null } });
  const fitPackage = canonicalStatisticalFitPackage(), fitPackageDigest = statisticalFitPackageDigest(fitPackage);
  const result = held || !evaluated.ok ? null : evaluated.result;
  const finding = held ? null : measured.finding;
  const reason = held ? "embryo_call_rate" : finding ? "insufficient_coverage" : "sex_combined_model_unavailable";
  const expected = { embryoId: id(10), conditionId: "SYNTHETIC:9001", measurement: held ? null : measured.measurement,
    finding, reason, result };
  const receipt = { version: 1, producer: "embryo-test-statistical-fit-v1", job_id: id(2), attempt: 1,
    capture_sha256: "d".repeat(64), condition_id: "SYNTHETIC:9001", source,
    reference_receipt: { singleton: true, version: 1, panel_sha256: STATISTICAL_FIT_PANEL_SHA256,
      panel: TEST_STATISTICAL_SCORE_PANEL, system_identifier: "12345", database_name: "postgres", database_oid: 5,
      server_version: 170006, installed_at: "2026-10-10T00:00:00Z",
      runtime_binding: { kind: "github-browser", project: "sequence", head: "a".repeat(40),
        migrationSha256: "e".repeat(64), configSha256: "f".repeat(64), dbContainerId: "1".repeat(64),
        networkId: "2".repeat(64), owner: id(40), daemonId: "synthetic-daemon", runtimeIdentity: {} },
      fit_artifact: SYNTHETIC_FIT_POPULATION, fit_artifact_sha256: STATISTICAL_FIT_ARTIFACT_SHA256,
      fit_package: fitPackage, fit_package_digest: fitPackageDigest },
    measurement: expected, publication: "synthetic-fitted-test-only", interpretation: "held", clinicalPublication: false,
    fitPackage, fitPackageDigest };
  return statisticalFittedReadSchema.parse({ version: 1, producer: "embryo-test-statistical-fit-v1", jurisdiction: "TEST-LOCAL",
    cohortId: id(1), publicationRevision: 1, jobId: id(2), attempt: 1, captureSha256: "d".repeat(64), interpretation: "held",
    publication: "synthetic-fitted-test-only", clinicalPublication: false,
    rows: [{ embryoId: id(10), sampleOrdinal: 0, conditionId: "SYNTHETIC:9001", conditionName: "Synthetic score coverage",
      coverageState: held ? "quality_not_measurable" : "not_covered", reason, matchedVariants: held ? null : matched,
      requiredVariants: held ? null : 10, scoreCoverage: held ? null : matched / 10, finding, result, receipt }] });
}
function fittedHtml(value = fittedFixture(), embryoId?: string) {
  return renderToStaticMarkup(createElement(StatisticalCoverage, { value, subjectIds, embryoId }));
}
describe("separate native-current fitted TEST display", () => {
  it("uses genuine eight-of-ten own panel calls while retaining every original neutral row and full-file QC", async () => {
    const original = readFileSync("e2e/fixtures/embryo-pair-grch38.vcf", "utf8");
    const file = readFileSync("e2e/fixtures/embryo-pair-fitted-partial-grch38.vcf", "utf8");
    const rows = file.trimEnd().split("\n").filter(line => !line.startsWith("#"));
    expect(rows.filter(line => !line.split("\t")[2].startsWith("synthetic-row-")))
      .toEqual(original.trimEnd().split("\n").filter(line => !line.startsWith("#")));
    const binding = { challenge: "s".repeat(43), revision: 1, build: "GRCh38" as const, sampleCount: 2,
      handles: ["h".repeat(43), "k".repeat(43)] };
    const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([file]), binding));
    expect(chunks).toHaveLength(1);
    const fragments = validateEmbryoVcfChunk(chunks[0], { ...binding,
      resolveHandle: handle => binding.handles.indexOf(handle) });
    expect(fragments.map(fragment => fragment.ordinal)).toEqual([0, 1]);
    for (const fragment of fragments) {
      const own: EmbryoSplitRow[] = [];
      const measured = await analyseEmbryoFragment(new TextEncoder().encode(fragment.vcf), fragment.ordinal, "GRCh38", row => { own.push(row); });
      const qc = embryoOrdinalOutcome(measured);
      // The original second embryo retains its twelve no-calls; all eight added panel rows are called.
      const sitesCalled = [1208, 1196][fragment.ordinal];
      expect(qc.outcome).toBe("passed");expect(qc.qc).toMatchObject({ sites_expected: 1208, sites_called: sitesCalled,
        call_rate: sitesCalled / 1208, qc_verdict: "pass", qc_reasons: [] });
      const source = fittedFixture().rows[0].receipt.source!;
      const calls = own.filter(row => TEST_STATISTICAL_SCORE_PANEL.variants.some(variant => variant.chrom === row[0] && variant.pos === row[1]))
        .map(([chrom, pos, ref, alt, genotype]) => ({ fileId: source.file_id, chrom, pos, ref, alt, genotype }));
      const coverage = measureEmbryoStatisticalCoverage({ panel: TEST_STATISTICAL_SCORE_PANEL, source, calls });
      expect(coverage.ok).toBe(true);
      if (!coverage.ok) throw new Error("The actual parsed fixed-panel calls must remain readable");
      expect(coverage.measurement).toMatchObject({ matchedVariants: 8, requiredVariants: 10, scoreCoverage: 0.8 });
      expect(coverage.measurement.rows.slice(8).map(row => row.state)).toEqual(["not_covered", "not_covered"]);
      const fit = evaluateStatisticalFitResult({ source, calls, qc: { callRate: qc.qc.call_rate, contamination: null, alleleDropout: null } });
      expect(fit.ok).toBe(true);
      if (!fit.ok) throw new Error("The real partial own calls must produce the separate invented TEST interval");
      expect(fit.result.dropoutMultiplier).toBe("1.500000000");expect(Number(fit.result.varianceComponents.missingCoverage)).toBeGreaterThan(0);
      expect(fit.result.withinFamily.enabledByDefault).toBe(false);expect(fit.result.clinicalPublication).toBe(false);
    }
  });
  it("renders calculated partial coverage as OBSERVED and the invented interval as MODELLED in separate attributed blocks", () => {
    const html = fittedHtml(), blocks = html.match(/<section data-slot="claim-block"[\s\S]*?<\/section>/g)!;
    expect(html).toContain("Invented fitted TEST model");expect(html).toContain("Every reference observation is invented.");
    expect(html).toContain('data-publication="synthetic-fitted-test-only"');expect(html).toContain('data-interpretation="held"');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('data-figure-kind="coverage"');expect(blocks[0]).toContain('data-figure-basis="observed"');
    expect(blocks[0]).toContain("OBSERVED own-file coverage");expect(blocks[0]).not.toContain("data-modelled-marker");
    expect(blocks[1]).toContain('data-figure-kind="interval"');expect(blocks[1]).toContain('data-figure-basis="modelled"');
    expect(blocks[1]).toContain('data-provenance="computed:embryos/synthetic-statistical-fit"');
    expect(blocks[1].split(MODELLED_MARKER)).toHaveLength(2);expect(blocks[1]).toContain('data-within-family="not_measured"');
    for (const block of blocks) expect(block).toContain(`data-subject-id="${id(20)}"`);
    expect(html).not.toMatch(/data-figure-kind="(?:absolute|relative|percentile)"|data-exact-marker|aria-sort/);
  });
  it("shows the same complete current own receipt in a selected individual view", () => {
    expect(fittedHtml(fittedFixture(), id(10))).toBe(fittedHtml());
    expect(() => fittedHtml(fittedFixture(), id(99))).toThrow("Own embryo attribution required");
  });
  it.each([0, 7])("keeps %i called positions below the original floor without a numeric fitted interval", matched => {
    const html = fittedHtml(fittedFixture(matched));expect(html).toContain(INSUFFICIENT_COVERAGE_INTRO);
    expect(html).toContain('data-figure-kind="coverage"');expect(html).not.toContain('data-figure-kind="interval"');
    expect(html).not.toContain("data-modelled-marker");
  });
  it("does not turn a QC hold into zero coverage or an invented interval", () => {
    const html = fittedHtml(fittedFixture(8, true));expect(html).toContain("Not measurable");
    expect(html).not.toContain("data-figure-kind");expect(html).not.toContain("data-modelled-marker");
  });
  it.each(["capture", "source-revision", "artifact", "missing-artifact", "basis", "clinical", "sibling", "missing-receipt", "interval"]) (
    "refuses %s before rendering any fitted figure", fault => {
      const value = structuredClone(fittedFixture());
      if (fault === "capture") value.rows[0].receipt.capture_sha256 = "a".repeat(64);
      if (fault === "source-revision") value.rows[0].receipt.source!.source_publication_revision = 2;
      if (fault === "artifact") value.rows[0].receipt.reference_receipt.fit_artifact_sha256 = "a".repeat(64) as never;
      if (fault === "missing-artifact") delete (value.rows[0].receipt.reference_receipt as Partial<typeof value.rows[0]["receipt"]["reference_receipt"]>).fit_artifact;
      if (fault === "basis") value.rows[0].result!.figureBasis.basis = "observed" as never;
      if (fault === "clinical") value.clinicalPublication = true as never;
      if (fault === "sibling") value.rows[0].result!.withinFamily.enabledByDefault = true as never;
      if (fault === "missing-receipt") delete (value.rows[0] as Partial<typeof value.rows[0]>).receipt;
      if (fault === "interval") value.rows[0].result!.interval.reverse();
      expect(() => fittedHtml(value)).toThrow("Current fitted TEST receipt required");
    });
  it("rejects missing own-subject attribution instead of substituting a foreign subject", () => {
    expect(() => renderToStaticMarkup(createElement(StatisticalCoverage, { value: fittedFixture(), subjectIds: new Map() })))
      .toThrow("Own embryo attribution required");
    expect(() => renderToStaticMarkup(createElement(StatisticalCoverage, { value: fittedFixture(), subjectIds: new Map([[id(10), id(99)]]) })))
      .toThrow("Own embryo attribution required");
  });
});
