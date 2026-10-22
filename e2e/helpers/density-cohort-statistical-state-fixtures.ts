import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import { STATISTICAL_COHORT_DENSITY_NATIVE_SOURCES, statisticalCohortDensityRecipe,
  checkedStatisticalCohortBags, statisticalCohortBagSchema, type StatisticalCohortDensityRecipe } from "../../scripts/density-cohort-statistical-states";
import { publishedCohortBagSchema } from "../../scripts/density-cohort-publication-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import type { DensityStateFixture } from "./density-current-capture";
import { cohortBagSql } from "./density-cohort-publication-state-fixtures";
import { INSUFFICIENT_COVERAGE_INTRO, WITHIN_FAMILY_NOT_TESTED } from "../../src/copy/embryos/compare";
import { NO_RANKING_STATEMENT } from "../../src/copy/embryos/tradeoffs";

type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
type Bags = ReturnType<typeof statisticalCohortBagSchema.parse>;
type NativeFacts = { publication: unknown; statisticalProof: unknown; completeNativeBags: Bags;
  completeFirstHistoryBags: Bags | null; recipe: StatisticalCohortDensityRecipe };
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** These states run the existing native producers. The original first
 * journey and its exact one distinct fitted continuation remain mandatory. */
export function realStatisticalCohortDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  actualMessages: { to: string | string[]; html?: string }[]; jobsSecret: string;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; cohortId: string; nativeSnapshot: NativeFacts }) => Promise<unknown>;
}): DensityStateFixture[] {
  assert(input.origin === "http://localhost:3105", "Original owned native embryo app required");
  if (STATISTICAL_COHORT_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-cohort-statistical-state-fixtures.ts";
  const sourceSha256 = digest(fs.readFileSync(path.join(input.root, sourcePath)));
  const sources = [sourcePath, ...STATISTICAL_COHORT_DENSITY_NATIVE_SOURCES, "scripts/density-cohort-statistical-states.ts",
    "e2e/helpers/density-cohort-publication-state-fixtures.ts"]
    .map(name => ({ name, sha256: digest(fs.readFileSync(path.join(input.root, name))) }));
  const assertSource = () => { for (const source of sources)
    assert(digest(fs.readFileSync(path.join(input.root, source.name))) === source.sha256, "Native statistical journey or full-row reader changed"); };
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = statisticalCohortDensityRecipe(row); if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        assertSource();
        await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
          assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "Exact composed native source required");
          for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
            "INHERIT_UPLOAD_SIGNING_JWK", "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID",
            "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT"])
            assert(environment[name] === process.env[name], "Native parent, worker and SQL caller must share actual admission");
          const { localE2eProject } = await import("../../scripts/local-e2e-project");
          assert(localE2eProject(environment).projectId === "sequence"
            && localE2eProject(process.env).projectId === "sequence", "Original disposable native project required");
          assert(input.jobsSecret.length > 0 && input.jobsSecret === environment.JOBS_SECRET, "Actual app mail/jobs caller required");
          if (operator) {
            const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
            for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
              assert(process.env[name] === value, "Native whole-row reader requires actual owned daemon and scratch");
          }
          const { withEmbryoJourney } = await import("../../scripts/ci-embryo-journey");
          const { seedParticipantC, participantCPassword } = await import("../participant-c-journey");
          const { participantCPublication } = await import("../../scripts/comprehension/participant-c-seed");
          const { auditNativeStatisticalCoverage, auditNativeFittedStatisticalCoverage } = await import("./embryo-statistical-coverage-audit");
          const { auditPublishedEmbryoSurfaces } = await import("./embryo-published-audits");
          const { provePublishedQcCrossSurface } = await import("./embryo-qc-cross-surface");
          const { reviewFixtureSql } = await import("./claim-review-fixture");
          const context = await input.browser.newContext({ baseURL: input.origin, viewport, deviceScaleFactor: 1,
            colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
          const page = await context.newPage();
          const readBag = async (cohortId: string) => {
            assertSource(); return JSON.parse(await reviewFixtureSql(cohortBagSql(cohortId))) as unknown;
          };
          try {
            await withEmbryoJourney(environment, async runtime => {
              const first = await seedParticipantC({ page, browser: input.browser, ownerEmail: "participant-c@e2e.local",
                parentEmail: "participant-c-parent@e2e.local", password: participantCPassword,
                messages: input.actualMessages, jobsSecret: input.jobsSecret, runtime });
              try {
                const firstPublication = participantCPublication(await first.readPublication(), first.owner, first.cohortId);
                await auditPublishedEmbryoSurfaces({ page, ownerId: first.owner, cohortId: first.cohortId, read: first.readPublication });
                await provePublishedQcCrossSurface({ page, ownerId: first.owner, cohortId: first.cohortId, read: first.readPublication });
                expect(participantCPublication(await first.readPublication(), first.owner, first.cohortId)).toEqual(firstPublication);
                const firstBefore = publishedCohortBagSchema.parse(await readBag(first.cohortId));
                await runtime.runStatisticalWorker(first.cohortId);
                await auditNativeStatisticalCoverage({ page, cohortId: first.cohortId, embryos: first.embryos,
                  proof: () => runtime.statisticalProof(first.cohortId) });
                const firstAfter = checkedStatisticalCohortBags(firstBefore, await readBag(first.cohortId));
                const captureActual = async (journey: typeof first, publication: unknown, before: unknown,
                  proof: () => Promise<unknown>, firstHistory: Bags | null) => {
                  // The unchanged audit has validated the complete native
                  // producer. These exact full outputs must not advance again.
                  const originalProof = await proof();
                  const originalBags = checkedStatisticalCohortBags(before, await readBag(journey.cohortId));
                  const target = row.route.id === "embryos.detail" ? `/embryos/${journey.embryos[0].id}`
                    : row.route.id === "embryos.compare" ? `/embryos/compare?cohort=${journey.cohortId}` : row.route.path;
                  expect((await page.goto(target))?.status()).toBe(200); await page.emulateMedia({ colorScheme: "light" });
                  const observe = async () => {
                    assertSource();
                    const statisticalProof = await proof(), completeNativeBags = statisticalCohortBagSchema.parse(await readBag(journey.cohortId));
                    const completeFirstHistoryBags = firstHistory === null ? null
                      : statisticalCohortBagSchema.parse(await readBag(first.cohortId));
                    expect(statisticalProof, "The entire validated native current result and receipt remain exact").toEqual(originalProof);
                    expect(completeNativeBags, "All complete source, parent, worker, score, receipt and QC rows remain exact").toEqual(originalBags);
                    expect(completeFirstHistoryBags, "The complete first owned terminal graph cannot change during second capture").toEqual(firstHistory);
                    await assertStatisticalSurface(page, row, journey.cohortId, journey.embryos, recipe);
                    return input.observeState(row, page, sourceSha256, { accountId: journey.owner, cohortId: journey.cohortId,
                      nativeSnapshot: { publication, statisticalProof, completeNativeBags, completeFirstHistoryBags, recipe } });
                  };
                  await observe(); await capture({ page, observe }); await observe();
                };
                if (recipe === "uncovered") {
                  await captureActual(first, firstPublication, firstBefore, () => runtime.statisticalProof(first.cohortId), null);
                } else {
                  await runtime.withFittedJourney(first.cohortId, async fitted => {
                    const second = await seedParticipantC({ page, browser: input.browser, ownerEmail: "fitted-test@e2e.local",
                      parentEmail: "fitted-test-parent@e2e.local", password: participantCPassword,
                      messages: input.actualMessages, jobsSecret: input.jobsSecret, runtime: fitted, fittedSeed: "partial" });
                    try {
                      const publication = participantCPublication(await second.readPublication(), second.owner, second.cohortId);
                      await auditPublishedEmbryoSurfaces({ page, ownerId: second.owner, cohortId: second.cohortId, read: second.readPublication });
                      await provePublishedQcCrossSurface({ page, ownerId: second.owner, cohortId: second.cohortId, read: second.readPublication });
                      const before = publishedCohortBagSchema.parse(await readBag(second.cohortId));
                      await fitted.runStatisticalWorker(second.cohortId);
                      await auditNativeFittedStatisticalCoverage({ page, cohortId: second.cohortId, embryos: second.embryos,
                        proof: () => fitted.statisticalProof(second.cohortId) });
                      await captureActual(second, publication, before, () => fitted.statisticalProof(second.cohortId), firstAfter);
                    } finally { await second.closeCoParent(); }
                  });
                }
                expect(statisticalCohortBagSchema.parse(await readBag(first.cohortId))).toEqual(firstAfter);
              } finally { await first.closeCoParent(); }
            }, undefined, process.platform, operator);
          } finally { await context.close(); }
        });
        assertSource();
      },
    } satisfies DensityStateFixture];
  });
}

async function assertStatisticalSurface(page: Page, row: DensityStateCase, cohortId: string,
  embryos: { id: string; subject_id: string; sample_ordinal: number }[], recipe: StatisticalCohortDensityRecipe) {
  const count = row.route.id === "embryos.detail" ? 1 : embryos.length;
  const selected = row.route.id === "embryos.detail" ? [embryos[0]] : embryos;
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator('[data-slot="blocking-state"], [data-slot="result-gate"], [data-slot="cohort-permission"], [data-slot="consent-required"], [data-slot="stage-read-failed"]')).toHaveCount(0);
  const coverage = page.locator(`[data-slot="test-statistical-coverage"][data-cohort-id="${cohortId}"]`);
  await expect(coverage).toHaveCount(1); await expect(coverage).toHaveAttribute("data-interpretation", "held");
  await expect(coverage.locator('li[data-embryo-id]')).toHaveCount(count);
  for (const embryo of selected) {
    const entry = coverage.locator(`li[data-embryo-id="${embryo.id}"]`);
    await expect(entry).toHaveCount(1); await expect(entry).toHaveAttribute("data-coverage-state", "not_covered");
    await expect(entry).toContainText(`Embryo ${embryo.sample_ordinal + 1}`);
    for (const block of await entry.locator("[data-claim-block]").all()) await expect(block).toHaveAttribute("data-subject-id", embryo.subject_id);
  }
  const observed = coverage.locator('[data-figure-kind="coverage"][data-figure-basis="observed"]');
  await expect(observed).toHaveCount(count);
  await expect(observed.locator('[data-slot="figure-value"]')).toHaveText(Array(count)
    .fill(recipe === "uncovered" ? "read 0 of the 10 positions this needs" : "read 8 of the 10 positions this needs"));
  if (recipe === "uncovered") {
    await expect(coverage).toContainText("This invented reference tests file coverage. It gives no medical interpretation.");
    await expect(coverage.locator('[data-finding-kind="coverage_failure"]')).toHaveCount(count);
    await expect(coverage.locator('[data-slot="coverage-failure"]')).toHaveText(Array(count).fill(INSUFFICIENT_COVERAGE_INTRO));
    await expect(coverage.locator('[data-figure-kind="interval"], [data-modelled-marker]')).toHaveCount(0);
  } else {
    await expect(coverage).toHaveAttribute("data-publication", "synthetic-fitted-test-only");
    await expect(coverage).toContainText("Every reference observation is invented. This tests the maths and what you see on screen. It gives no medical interpretation.");
    await expect(coverage.locator('[data-test-result="fitted"][data-finding-kind="none"]')).toHaveCount(count);
    await expect(coverage.locator('[data-claim-block]')).toHaveCount(count * 2);
    await expect(coverage.locator('[data-figure-kind="interval"][data-figure-basis="modelled"]')).toHaveCount(count);
    await expect(coverage.locator('[data-modelled-marker]')).toHaveText(Array(count).fill("MODELLED"));
    await expect(coverage.locator('[data-slot="observed-test-coverage"]')).toHaveText(Array(count)
      .fill("OBSERVED own-file coverage. Missing positions remain in the full score denominator."));
    await expect(coverage.locator('[data-slot="modelled-test-interval"]')).toHaveText(Array(count)
      .fill("MODELLED invented-control probability and range. This is not a clinical result."));
    await expect(coverage.locator('[data-within-family="not_measured"]')).toHaveText(Array(count).fill(WITHIN_FAMILY_NOT_TESTED));
  }
  await expect(coverage.locator('[data-figure-kind="absolute"], [data-figure-kind="relative"], [data-figure-kind="percentile"], [aria-sort]')).toHaveCount(0);
  if (row.route.id === "embryos.compare")
    await expect(page.locator('[data-slot="no-ranking-statement"]')).toHaveText(NO_RANKING_STATEMENT);
}
