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
