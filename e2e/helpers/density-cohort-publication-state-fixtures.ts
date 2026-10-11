import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import { COHORT_DENSITY_NATIVE_SOURCES, isPublishedCohortDensityState, publishedCohortBagSchema } from "../../scripts/density-cohort-publication-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import type { DensityStateFixture } from "./density-current-capture";

type PublicCohortFacts = { publication: unknown; completeNativeBags: unknown };
type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Root supplies a fresh admitted disposable namespace for each callback.
 * The unchanged native helper itself refuses prior jobs/parts, uncertain
 * workers, foreign source mounts and unrestored configuration. A caller
 * cannot reuse a completed cohort or clear its history to satisfy this. */
export function realPublishedCohortDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  actualMessages: { to: string | string[]; html?: string }[];
  jobsSecret: string;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; cohortId: string; nativeSnapshot: PublicCohortFacts }) => Promise<unknown>;
}): DensityStateFixture[] {
  assert(input.origin === "http://localhost:3105", "The original native journey's exact disposable app is required");
  // Isolated Main lacks the Core journey. Its complete census must remain
  // HOLD, rather than filling these four states with an old seeded fixture.
  if (COHORT_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-cohort-publication-state-fixtures.ts";
  const sourceSha256 = digest(fs.readFileSync(path.join(input.root, sourcePath)));
  const composed = COHORT_DENSITY_NATIVE_SOURCES.map(name => ({ name,
    sha256: digest(fs.readFileSync(path.join(input.root, name))) }));
  const assertSource = () => {
    for (const source of composed)
      assert(digest(fs.readFileSync(path.join(input.root, source.name))) === source.sha256, "Native journey composition changed");
  };
  return densityCapturePlan(input.register, []).states.filter(isPublishedCohortDensityState).map(row => ({
    routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
    withState: async ({ viewport }, capture) => {
      assertSource();
      await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
        assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "The native fixture must read this composed checkout");
        // The existing Auth and SQL readers bind their process-wide caller.
        // A separately supplied environment cannot point them at old data.
        for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
          "INHERIT_UPLOAD_SIGNING_JWK", "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID",
          "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT"])
          assert(environment[name] === process.env[name], "The original readers and owned journey require the same admitted caller");
        const { localE2eProject } = await import("../../scripts/local-e2e-project");
        assert(localE2eProject(environment).projectId === "sequence"
          && localE2eProject(process.env).projectId === "sequence", "The original disposable native project is required");
        assert(input.jobsSecret.length > 0 && input.jobsSecret === environment.JOBS_SECRET,
          "The actual app jobs caller is required for its original mail worker");
        if (operator) {
          const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
          for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
            assert(process.env[name] === value, "The original SQL reader requires the actual owned daemon and scratch");
        }
        const { withEmbryoJourney } = await import("../../scripts/ci-embryo-journey");
        const { seedParticipantC, participantCPassword } = await import("../participant-c-journey");
        const { participantCPublication } = await import("../../scripts/comprehension/participant-c-seed");
        const { auditPublishedEmbryoSurfaces } = await import("./embryo-published-audits");
        const { provePublishedQcCrossSurface } = await import("./embryo-qc-cross-surface");
        const { reviewFixtureSql } = await import("./claim-review-fixture");
        const context = await input.browser.newContext({ baseURL: input.origin, viewport,
          deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), nonce = randomUUID();
        try {
          await withEmbryoJourney(environment, async runtime => {
            const journey = await seedParticipantC({ page, browser: input.browser,
              ownerEmail: `cmp-t6-${nonce}@e2e.local`, parentEmail: `cmp-t6-${nonce}-parent@e2e.local`,
              password: participantCPassword, messages: input.actualMessages, jobsSecret: input.jobsSecret, runtime });
            try {
              const { owner, cohortId, readPublication } = journey;
              const current = async () => participantCPublication(await readPublication(), owner, cohortId);
              const original = await current();
              await auditPublishedEmbryoSurfaces({ page, ownerId: owner, cohortId, read: readPublication });
              await provePublishedQcCrossSurface({ page, ownerId: owner, cohortId, read: readPublication });
              expect(await current()).toEqual(original);
              const target = row.route.id === "embryos.detail" ? `/embryos/${original.embryos[0].id}`
                : row.route.id === "embryos.compare" ? `/embryos/compare?cohort=${cohortId}` : row.route.path;
              expect((await page.goto(target))?.status()).toBe(200);
              await page.emulateMedia({ colorScheme: "light" });
              await expect(page.locator("main h1")).toHaveCount(1);
              await expect(page.locator('[data-slot="result-gate"], [data-slot="cohort-permission"], [data-slot="blocking-state"], [data-slot="consent-required"], [data-slot="jurisdiction-unavailable"], [data-slot="stage-read-failed"]')).toHaveCount(0);
              // Whole native rows are hashed before any transport. These
              // public proofs contain neither genome bytes nor parent keys.
              const readBags = async () => {
                const value: unknown = JSON.parse(await reviewFixtureSql(cohortBagSql(cohortId)));
                return publishedCohortBagSchema.parse(value);
              };
              const beforeBags = await readBags();
              const observe = async () => {
                assertSource();
                const publication = await current(), completeNativeBags = await readBags();
                expect(publication).toEqual(original);
                expect(completeNativeBags, "all native parent/source/job/QC rows stay exact around capture").toEqual(beforeBags);
                await assertPublishedSurface(page, row.route.id, cohortId, original.embryos[0].sample_ordinal);
                return input.observeState(row, page, sourceSha256, { accountId: owner, cohortId,
                  nativeSnapshot: { publication, completeNativeBags } });
              };
              await observe(); await capture({ page, observe });
              expect(await current()).toEqual(original); expect(await readBags()).toEqual(beforeBags);
            } finally { await journey.closeCoParent(); }
          }, undefined, process.platform, operator);
        } finally { await context.close(); }
      });
      assertSource();
    },
  } satisfies DensityStateFixture));
}

export function cohortBagSql(cohort: string): string {
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(cohort), "Actual cohort UUID required");
  const c = `'${cohort}'::uuid`;
  const tables = {
    cohort: `select to_jsonb(r) row from public.embryo_cohorts r where r.id=${c}`,
    embryos: `select to_jsonb(r) row from public.embryos r where r.cohort_id=${c}`,
    subjects: `select to_jsonb(r) row from public.subjects r where r.cohort_id=${c}`,
    files: `select to_jsonb(r) row from public.genome_files r where r.subject_id in(select subject_id from public.embryos where cohort_id=${c})`,
    qc: `select to_jsonb(r) row from public.embryo_qc r where r.embryo_id in(select id from public.embryos where cohort_id=${c})`,
    scores: `select to_jsonb(r) row from public.embryo_scores r where r.embryo_id in(select id from public.embryos where cohort_id=${c})`,
    variants: `select to_jsonb(r) row from public.embryo_variants r where r.embryo_id in(select id from public.embryos where cohort_id=${c})`,
    jobs: `select to_jsonb(r) row from public.worker_jobs r where r.cohort_id=${c}`,
    sessions: `select to_jsonb(r) row from public.embryo_ingest_sessions r where r.cohort_id=${c}`,
    basis: `select to_jsonb(r) row from public.embryo_basis_bindings r where r.cohort_id=${c}`,
    participants: `select to_jsonb(r) row from public.embryo_participant_sets r where r.cohort_id=${c}`,
    parentHistory: `select to_jsonb(r) row from public.consent_signatures r where (r.target_kind='cohort' and r.target_id=${c}) or (r.target_kind='cohort_draft' and r.target_id in(select draft_id from public.embryo_cohorts where id=${c}))`,
    grants: `select to_jsonb(r) row from public.purpose_grants r where r.target_kind='cohort' and r.target_id=${c}`,
    attestations: `select to_jsonb(r) row from public.attestations r where r.target_kind='cohort_draft' and r.target_id in(select draft_id from public.embryo_cohorts where id=${c})`,
    operationHistory: `select to_jsonb(r) row from public.embryo_operation_nonces r where (r.target_kind='cohort' and r.target_id=${c}) or (r.target_kind='cohort_draft' and r.target_id in(select draft_id from public.embryo_cohorts where id=${c})) or (r.target_kind='embryo' and r.target_id in(select id from public.embryos where cohort_id=${c}))`,
    futurePersonProfiles: `select to_jsonb(r) row from public.future_person_identity r where r.embryo_id in(select id from public.embryos where cohort_id=${c})`,
    principals: `select to_jsonb(r) row from public.subject_principals r where r.id in(select principal_id from public.embryo_participant_sets where cohort_id=${c})`,
    profiles: `select to_jsonb(r) row from public.profiles r where r.id in(select account_id from public.subject_principals where id in(select principal_id from public.embryo_participant_sets where cohort_id=${c})) or r.id in(select owner_account_id from public.embryo_cohorts where id=${c})`,
    sources: `select to_jsonb(r) row from private.embryo_canonical_sources r where r.cohort_id=${c}`,
    parts: `select to_jsonb(r) row from private.embryo_canonical_parts r where r.session_id in(select id from public.embryo_ingest_sessions where cohort_id=${c})`,
    memberships: `select to_jsonb(r) row from private.embryo_canonical_source_parts r where r.file_id in(select file_id from private.embryo_canonical_sources where cohort_id=${c})`,
  };
  return `select jsonb_build_object(${Object.entries(tables).map(([name, sql]) => `'${name}',
    (select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(convert_to(
      coalesce(jsonb_agg(row order by row::text collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'))
      from (${sql}) complete_rows)`).join(",")});`;
}

async function assertPublishedSurface(page: Page, routeId: string, cohortId: string, ordinal: number) {
  if (routeId === "embryos.index") {
    const card = page.locator(`[data-slot="cohort-card"][data-cohort-id="${cohortId}"]`);
    await expect(card).toHaveCount(1); await expect(card).toHaveAttribute("data-cohort-status", "active");
    await expect(card.locator('[data-slot="embryo-label"]')).toHaveText(["Embryo 1", "Embryo 2"]);
    await expect(card.locator('[data-slot="analysis-state"]')).toHaveCount(0);
  } else if (routeId === "embryos.upload") {
    const { UPLOAD_COMPLETE_SENTENCE } = await import("../../src/copy/embryos/upload");
    const complete = page.locator('[data-slot="upload-complete"]');
    await expect(complete).toHaveAttribute("data-state", "complete");
    await expect(complete).toHaveAttribute("data-cohort-id", cohortId);
    await expect(complete.getByRole("status")).toHaveText(UPLOAD_COMPLETE_SENTENCE);
    await expect(page.locator('[data-slot="upload-flow"], [data-slot="file-form"], [data-stage="processing"]')).toHaveCount(0);
  } else if (routeId === "embryos.compare") {
    await expect(page.locator('[data-slot="qc-table"] thead th[data-embryo-id]')).toHaveCount(2);
    await expect(page.locator('[data-slot="no-ranking-statement"]')).toBeVisible();
    await expect(page.locator('[aria-sort], table th button')).toHaveCount(0);
    await expect(page.locator('[data-figure-kind="absolute"], [data-figure-kind="interval"]')).toHaveCount(0);
  } else {
    await expect(page.getByRole("heading", { level: 1, name: `Embryo ${ordinal + 1}`, exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="qc-verdict"]')).toHaveAttribute("data-verdict", "pass");
    await expect(page.locator('[data-figure-kind="absolute"], [data-figure-kind="interval"]')).toHaveCount(0);
  }
}
