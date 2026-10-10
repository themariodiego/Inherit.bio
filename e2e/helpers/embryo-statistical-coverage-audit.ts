import { expect, type Page } from "@playwright/test";
import { auditContext, watchContext } from "../audited-test";
import { axeViolations } from "../helpers";
import { INSUFFICIENT_COVERAGE_INTRO } from "@/copy/embryos/compare";
import { NO_RANKING_STATEMENT } from "@/copy/embryos/tradeoffs";
import { TEST_STATISTICAL_SCORE_PANEL } from "@/lib/embryos/statistical-coverage";
import type { StatisticalCoverageMeasurement } from "@/lib/embryos/statistical-coverage";

/** Supplemental audits in the already genuine two-parent upload journey.
 * The actual second native worker must finish before any state is asserted;
 * no route/response, result row, reference grant or parent consent is mocked. */
export async function auditNativeStatisticalCoverage(input: { page: Page; cohortId: string;
  embryos: { id: string; sample_ordinal: number }[]; proof: () => Promise<unknown> }) {
  const read = async () => {
    const value = await input.proof() as { jobs: Record<string, unknown>[]; scores: {
      embryo_id: string; condition_id: string; finding: Record<string, unknown>; computation_receipt: {
        producer: string; measurement: { measurement: StatisticalCoverageMeasurement }; };
    }[] };
    expect(value.jobs).toHaveLength(1);expect(value.scores).toHaveLength(input.embryos.length);
    expect(value.jobs[0]).toMatchObject({ status: "done", attempts: 1, output_kind: "embryo.statistical-estimate",
      computation_revision: "embryo-test-score-coverage-v1", claim_token_hash: null, claim_expires_at: null, claimed_by: null });
    expect(value.scores.map(row => row.embryo_id)).toEqual(input.embryos.map(row => row.id));
    for (const row of value.scores) {
      expect(row.condition_id).toBe(TEST_STATISTICAL_SCORE_PANEL.conditionId);
      expect(row.computation_receipt.producer).toBe("embryo-test-score-coverage-v1");
      expect(row.finding).toMatchObject({ kind: "coverage_failure", metric: "score_coverage", required_minimum: 0.8 });
      expect(row.computation_receipt.measurement.measurement).toMatchObject({ matchedVariants: 0, requiredVariants: 10, scoreCoverage: 0 });
    }
    return value;
  };
  const original = await read(), observed = watchContext(input.page.context());
  const targets = [{ route: "/embryos", url: "/embryos" },
    { route: "/embryos/compare", url: `/embryos/compare?cohort=${input.cohortId}` },
    { route: "/embryos/[embryoId]", url: `/embryos/${input.embryos[0].id}` }];
  for (const target of targets) for (const theme of ["light", "dark"] as const) {
    expect(await read()).toEqual(original);
    await input.page.emulateMedia({ colorScheme: theme });observed.origins.clear();observed.urls.length = 0;
    const response = await input.page.goto(target.url);expect(response?.status()).toBe(200);
    await expect(input.page).toHaveURL(url => url.pathname + url.search === target.url);
    const coverage = input.page.locator(`[data-slot="test-statistical-coverage"][data-cohort-id="${input.cohortId}"]`);
    await expect(coverage).toHaveCount(1);await expect(coverage).toHaveAttribute("data-interpretation", "held");
    await expect(coverage).toContainText("Synthetic TEST score coverage");
    await expect(coverage.locator('[data-finding-kind="coverage_failure"]')).toHaveCount(target.route === "/embryos/[embryoId]" ? 1 : input.embryos.length);
    await expect(coverage.locator('[data-slot="coverage-failure"]')).toHaveText(Array(target.route === "/embryos/[embryoId]" ? 1 : input.embryos.length).fill(INSUFFICIENT_COVERAGE_INTRO));
    await expect(coverage.locator('[data-figure-kind="absolute"], [data-figure-kind="interval"], [data-modelled-marker]')).toHaveCount(0);
    await expect(input.page.locator('[data-slot="blocking-state"], [data-slot="result-gate"], [data-slot="cohort-permission"]')).toHaveCount(0);
    if (target.route === "/embryos/compare") await expect(input.page.locator('[data-slot="no-ranking-statement"]')).toHaveText(NO_RANKING_STATEMENT);
    await input.page.waitForLoadState("networkidle");
    expect(await axeViolations(input.page, theme), `${target.route} not-covered (${theme})`).toEqual([]);
    await auditContext(input.page.context(), observed, `${target.route} not-covered (${theme})`);
    expect(await read()).toEqual(original);
  }
  await input.page.emulateMedia({ colorScheme: "light" });
  return { producer: "embryo-test-score-coverage-v1", cohortId: input.cohortId,
    surfaces: targets.map(target => target.route), themes: ["light", "dark"], matched: 0, required: 10,
    interpretation: "held", source: "actual-native-parent-upload-split-statistical-worker-current-read" };
}

import { statisticalFitResultSchema, evaluateStatisticalFitResult, canonicalStatisticalFitPackage,
  statisticalFitPackageDigest, STATISTICAL_FIT_ARTIFACT_SHA256 } from "@/lib/embryos/statistical-fit-contract";
import { MODELLED_MARKER } from "@/lib/figures/contract";
import { WITHIN_FAMILY_NOT_TESTED } from "@/copy/embryos/compare";

/** An additional genuine signed-parent upload and native fitted worker. The
 * full native rows are hashed before only repeated fixed artifacts are removed
 * from the bounded proof; all metadata/result/currentness checks remain. */
export async function auditNativeFittedStatisticalCoverage(input: { page: Page; cohortId: string;
  embryos: { id: string; sample_ordinal: number }[]; proof: () => Promise<unknown> }) {
  const read = async () => {
    const value = await input.proof() as { bindingsCurrent: boolean; fitPackage: unknown;
      wholeRowHashes: { jobs: { id: string; sha256: string }[]; scores: { id: string; sha256: string }[] };
      jobs: Record<string, unknown>[]; scores: {
        id: string; embryo_id: string; condition_id: string; finding: null; coverage_state: string;
        not_covered_reason: string; computation_receipt: {
          producer: string; publication: string; interpretation: string; clinicalPublication: boolean;
          fitPackageDigest: string; reference_receipt: { fit_artifact_sha256: string };
          measurement: { result: unknown; measurement: StatisticalCoverageMeasurement };
        };
      }[]; calls: { embryoId: string; qc: { call_rate: number; contamination_estimate: number | null;
        allelic_dropout_estimate: number | null }; calls: unknown }[] };
    expect(value.bindingsCurrent).toBe(true);expect(value.jobs).toHaveLength(1);expect(value.scores).toHaveLength(input.embryos.length);
    expect(value.jobs[0]).toMatchObject({ status: "done", attempts: 1, output_kind: "embryo.statistical-estimate",
      computation_revision: "embryo-test-statistical-fit-v1", claim_token_hash: null, claim_expires_at: null, claimed_by: null });
    expect(value.wholeRowHashes.jobs.map(row => row.id)).toEqual(value.jobs.map(row => row.id));
    expect(value.wholeRowHashes.scores.map(row => row.id)).toEqual(value.scores.map(row => row.id));
    for (const bag of [value.wholeRowHashes.jobs, value.wholeRowHashes.scores]) {
      expect(new Set(bag.map(row => row.id)).size).toBe(bag.length);
      for (const row of bag) expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(value.scores.map(row => row.embryo_id)).toEqual(input.embryos.map(row => row.id));
    expect(value.calls.map(row => row.embryoId)).toEqual(input.embryos.map(row => row.id));
    const packageDigest = statisticalFitPackageDigest(canonicalStatisticalFitPackage());
    expect(value.fitPackage).toEqual(canonicalStatisticalFitPackage());
    for (const [index, row] of value.scores.entries()) {
      expect(row.condition_id).toBe(TEST_STATISTICAL_SCORE_PANEL.conditionId);
      expect(row.finding).toBeNull();expect(row.coverage_state).toBe("not_covered");
      expect(row.not_covered_reason).toBe("sex_combined_model_unavailable");
      const receipt = row.computation_receipt;
      expect(receipt).toMatchObject({ producer: "embryo-test-statistical-fit-v1", publication: "synthetic-fitted-test-only",
        interpretation: "held", clinicalPublication: false, fitPackageDigest: packageDigest });
      expect(receipt.reference_receipt.fit_artifact_sha256).toBe(STATISTICAL_FIT_ARTIFACT_SHA256);
      const measurement = receipt.measurement.measurement;
      expect(measurement).toMatchObject({ matchedVariants: 8, requiredVariants: 10, scoreCoverage: 0.8 });
      const actual = value.calls[index];expect(actual.qc.call_rate).toBe(1);
      expect(actual.qc.contamination_estimate).toBeNull();expect(actual.qc.allelic_dropout_estimate).toBeNull();
      const evaluated = evaluateStatisticalFitResult({ source: measurement.source, calls: actual.calls,
        qc: { callRate: actual.qc.call_rate, contamination: actual.qc.contamination_estimate,
          alleleDropout: actual.qc.allelic_dropout_estimate } });
      expect(evaluated.ok).toBe(true);
      if (!evaluated.ok) throw new Error("The actual own calls must produce the fixed fitted TEST interval");
      const result = statisticalFitResultSchema.parse(receipt.measurement.result);
      expect(result).toEqual(evaluated.result);expect(result.dropoutMultiplier).toBe("1.500000000");
      expect(Number(result.varianceComponents.missingCoverage)).toBeGreaterThan(0);
      expect(result.withinFamily).toEqual({ status: "not_measured", enabledByDefault: false,
        betaRatio: null, interval: null, familyCount: null, citation: null });
    }
    return value;
  };
  const original = await read(), observed = watchContext(input.page.context());
  const targets = [{ route: "/embryos", url: "/embryos" },
    { route: "/embryos/compare", url: `/embryos/compare?cohort=${input.cohortId}` },
    { route: "/embryos/[embryoId]", url: `/embryos/${input.embryos[0].id}` }];
  for (const target of targets) for (const theme of ["light", "dark"] as const) {
    expect(await read()).toEqual(original);
    await input.page.emulateMedia({ colorScheme: theme });observed.origins.clear();observed.urls.length = 0;
    const response = await input.page.goto(target.url);expect(response?.status()).toBe(200);
    await expect(input.page).toHaveURL(url => url.pathname + url.search === target.url);
    const coverage = input.page.locator(`[data-slot="test-statistical-coverage"][data-cohort-id="${input.cohortId}"]`);
    const count = target.route === "/embryos/[embryoId]" ? 1 : input.embryos.length;
    await expect(coverage).toHaveCount(1);await expect(coverage).toHaveAttribute("data-interpretation", "held");
    await expect(coverage).toHaveAttribute("data-publication", "synthetic-fitted-test-only");
    await expect(coverage).toContainText("Invented fitted TEST model");
    await expect(coverage).toContainText("Every reference observation is invented.");
    await expect(coverage.locator('[data-test-result="fitted"]')).toHaveCount(count);
    await expect(coverage.locator('[data-figure-kind="coverage"][data-figure-basis="observed"]')).toHaveCount(count);
    await expect(coverage.locator('[data-figure-kind="interval"][data-figure-basis="modelled"]')).toHaveCount(count);
    await expect(coverage.locator('[data-claim-block]')).toHaveCount(count * 2);
    await expect(coverage.locator('[data-modelled-marker]')).toHaveText(Array(count).fill(MODELLED_MARKER));
    await expect(coverage.locator('[data-within-family="not_measured"]')).toHaveText(Array(count).fill(WITHIN_FAMILY_NOT_TESTED));
    await expect(coverage.locator('[data-figure-kind="absolute"], [data-figure-kind="relative"], [data-figure-kind="percentile"], [aria-sort]')).toHaveCount(0);
    await expect(input.page.locator('[data-slot="blocking-state"], [data-slot="result-gate"], [data-slot="cohort-permission"]')).toHaveCount(0);
    if (target.route === "/embryos/compare") await expect(input.page.locator('[data-slot="no-ranking-statement"]')).toHaveText(NO_RANKING_STATEMENT);
    await input.page.waitForLoadState("networkidle");
    expect(await axeViolations(input.page, theme), `${target.route} fitted TEST partial (${theme})`).toEqual([]);
    await auditContext(input.page.context(), observed, `${target.route} fitted TEST partial (${theme})`);
    expect(await read()).toEqual(original);
  }
  await input.page.emulateMedia({ colorScheme: "light" });
  return { producer: "embryo-test-statistical-fit-v1", cohortId: input.cohortId,
    surfaces: targets.map(target => target.route), themes: ["light", "dark"], matched: 8, required: 10,
    publication: "synthetic-fitted-test-only", interpretation: "held", clinicalPublication: false,
    withinFamily: "not_measured", source: "actual-native-signed-parent-upload-fitted-worker-current-read",
    wholeRowHashes: original.wholeRowHashes };
}
