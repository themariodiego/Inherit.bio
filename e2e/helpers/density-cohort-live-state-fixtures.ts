import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import { COHORT_DENSITY_NATIVE_SOURCES } from "../../scripts/density-cohort-publication-states";
import { cohortLiveDensityRecipe, liveCohortDensitySchema, type LiveCohortDensity } from "../../scripts/density-cohort-live-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import type { DensityStateFixture } from "./density-current-capture";
import { cohortBagSql } from "./density-cohort-publication-state-fixtures";
import { EMBRYO_STATUS, ROLE_YOU, STILL_CHECKING_STATUS, waitingForResultsBody } from "../../src/copy/embryos/index";
import { PROCESSING_HEADING, PROCESSING_SENTENCE } from "../../src/copy/embryos/upload";

type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
type LiveCohortFacts = { context: LiveCohortDensity; publication: unknown | null };
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Capture at the existing producer's real callback boundary. Nothing runs
 * before Root admits a fresh native runtime for this state and viewport. */
export function realLiveCohortDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  actualMessages: { to: string | string[]; html?: string }[]; jobsSecret: string;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; cohortId: string; nativeSnapshot: LiveCohortFacts }) => Promise<unknown>;
}): DensityStateFixture[] {
  assert(input.origin === "http://localhost:3105", "Original native journey's disposable app required");
  if (COHORT_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-cohort-live-state-fixtures.ts";
  const sourceSha256 = digest(fs.readFileSync(path.join(input.root, sourcePath)));
  const sources = [...COHORT_DENSITY_NATIVE_SOURCES, "e2e/helpers/density-cohort-publication-state-fixtures.ts"]
    .map(name => ({ name, sha256: digest(fs.readFileSync(path.join(input.root, name))) }));
  const assertSource = () => {
    for (const source of sources)
      assert(digest(fs.readFileSync(path.join(input.root, source.name))) === source.sha256, "Native journey or full-row reader changed");
  };
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const phase = cohortLiveDensityRecipe(row); if (!phase) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        assertSource();
        await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
          assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "Exact composed checkout required");
          for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
            "INHERIT_UPLOAD_SIGNING_JWK", "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID",
            "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT"])
            assert(environment[name] === process.env[name], "Native readers and owned journey must use the same admitted caller");
          const { localE2eProject } = await import("../../scripts/local-e2e-project");
          assert(localE2eProject(environment).projectId === "sequence"
            && localE2eProject(process.env).projectId === "sequence", "Original native project required");
          assert(input.jobsSecret.length > 0 && input.jobsSecret === environment.JOBS_SECRET, "Actual app mail worker caller required");
          if (operator) {
            const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
            for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
              assert(process.env[name] === value, "SQL reader requires the actual owned daemon and scratch");
          }
          const { withEmbryoJourney } = await import("../../scripts/ci-embryo-journey");
          const { seedParticipantC, participantCPassword } = await import("../participant-c-journey");
          const { participantCPublication, EMBRYO_PUBLISHED_FILE_SELECT } = await import("../../scripts/comprehension/participant-c-seed");
          const { adminClient } = await import("../helpers");
          const { reviewFixtureSql } = await import("./claim-review-fixture");
          const context = await input.browser.newContext({ baseURL: input.origin, viewport, deviceScaleFactor: 1,
            colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
          const page = await context.newPage(), nonce = randomUUID(), ownerEmail = `cmp-t6-${nonce}@e2e.local`;
          try {
            await withEmbryoJourney(environment, async runtime => {
              let attempted = false, completed = false, captured = false, capturedCohort: string | undefined;
              const atBoundary = async (cohortId: string) => {
                assert(!captured && !capturedCohort, "Exactly one actual lifecycle capture required");
                capturedCohort = cohortId;
                const read = async () => {
                  assertSource();
                  const value: unknown = JSON.parse(await reviewFixtureSql(liveContextSql(cohortId, ownerEmail, phase)));
                  const facts = liveCohortDensitySchema.parse(value);
                  assert(facts.phase === phase && facts.cohortId === cohortId, "Exact native requested phase required");
                  let publication: unknown | null = null;
                  if (phase === "analysis-pending") {
                    const admin = adminClient();
                    const cohort = await admin.from("embryo_cohorts").select("id,owner_account_id,status,publication_revision,uploaded_at")
                      .eq("id", cohortId).single();
                    const embryos = await admin.from("embryos").select("id,subject_id,sample_ordinal,status")
                      .eq("cohort_id", cohortId).order("sample_ordinal");
                    expect(cohort.error).toBeNull(); expect(embryos.error).toBeNull(); expect(embryos.data).toHaveLength(2);
                    const files = await admin.from("genome_files").select(EMBRYO_PUBLISHED_FILE_SELECT)
                      .in("subject_id", embryos.data!.map(embryo => embryo.subject_id));
                    expect(files.error).toBeNull(); expect(files.data).toHaveLength(2);
                    publication = participantCPublication({ cohort: cohort.data, embryos: embryos.data,
                      files: files.data, proof: await runtime.proof(cohortId) }, facts.ownerId, cohortId);
                  }
                  return { context: facts, publication } satisfies LiveCohortFacts;
                };
                const before = await read();
                const target = row.route.id === "embryos.detail" ? `/embryos/${before.context.embryos[0].id}`
                  : row.route.id === "embryos.compare" ? `/embryos/compare?cohort=${cohortId}` : row.route.path;
                // Keep the uploader's original live processing panel. Other
                // views use real native navigation to this exact cohort.
                if (row.route.id !== "embryos.upload") expect((await page.goto(target))?.status()).toBe(200);
                const observe = async () => {
                  const nativeSnapshot = await read();
                  expect(nativeSnapshot, "complete native pending source, parent and job rows remain exact").toEqual(before);
                  await assertLiveSurface(page, row, before.context);
                  return input.observeState(row, page, sourceSha256, { accountId: before.context.ownerId, cohortId, nativeSnapshot });
                };
                await observe(); await capture({ page, observe });
                expect(await read()).toEqual(before); captured = true;
              };
              const journey = await seedParticipantC({ page, browser: input.browser, ownerEmail,
                parentEmail: `cmp-t6-${nonce}-parent@e2e.local`, password: participantCPassword,
                messages: input.actualMessages, jobsSecret: input.jobsSecret,
                runtime: { proof: runtime.proof, runWorker: async cohortId => {
                  assert(!attempted, "No retry or duplicate worker attempt permitted"); attempted = true;
                  if (phase === "processing") await atBoundary(cohortId);
                  await runtime.runWorker(cohortId); completed = true;
                  if (phase === "analysis-pending") await atBoundary(cohortId);
                } },
              });
              try {
                assert(attempted && completed && captured && capturedCohort === journey.cohortId,
                  "Capture and unchanged original worker must both complete on the same genuine cohort");
                participantCPublication(await journey.readPublication(), journey.owner, journey.cohortId);
              } finally { await journey.closeCoParent(); }
            }, undefined, process.platform, operator);
          } finally { await context.close(); }
        });
        assertSource();
      } } satisfies DensityStateFixture];
  });
}

function liveContextSql(cohortId: string, ownerEmail: string, phase: "processing" | "analysis-pending") {
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(cohortId), "Actual cohort UUID required");
  assert(/^cmp-t6-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}@e2e\.local$/.test(ownerEmail), "Actual closed fresh owner required");
  const c = `'${cohortId}'::uuid`, full = cohortBagSql(cohortId).replace(/;$/, "");
  const bags = {
    pendingOrdinals: `select to_jsonb(r) row from private.embryo_split_ordinals r where r.session_id in(select id from public.embryo_ingest_sessions where cohort_id=${c})`,
    pendingVariants: `select to_jsonb(r) row from private.embryo_split_variants r where r.session_id in(select id from public.embryo_ingest_sessions where cohort_id=${c})`,
    writeIntents: `select to_jsonb(r) row from private.embryo_ingest_write_intents r where r.session_id in(select id from public.embryo_ingest_sessions where cohort_id=${c})`,
    inputFragments: `select to_jsonb(r) row from public.embryo_ingest_fragments r where r.session_id in(select id from public.embryo_ingest_sessions where cohort_id=${c})`,
    directions: `select to_jsonb(r) row from public.directional_grants r where r.grant_id in(select grant_id from public.purpose_grants where target_kind='cohort' and target_id=${c})`,
    drafts: `select to_jsonb(r) row from public.embryo_cohort_drafts r where r.id in(select draft_id from public.embryo_cohorts where id=${c})`,
    splitConfig: "select to_jsonb(r) row from private.embryo_split_config r",
    objectConfig: "select to_jsonb(r) row from private.embryo_ingest_object_config r",
  };
  return `select jsonb_build_object('phase','${phase}','cohortId',c.id,'ownerId',c.owner_account_id,
    'ownerMatches',exists(select 1 from auth.users u where u.id=c.owner_account_id and u.email='${ownerEmail}' and u.deleted_at is null),
    'cohortStatus',c.status,'publicationRevision',c.publication_revision,
    'embryos',(select jsonb_agg(jsonb_build_object('id',e.id,'subjectId',e.subject_id,'sampleOrdinal',e.sample_ordinal,'status',e.status) order by e.sample_ordinal) from public.embryos e where e.cohort_id=c.id),
    'jobId',w.id,'sessionId',s.id,'sessionWorkerJobId',s.worker_job_id,'jobSourceBindingId',w.source_binding_id,
    'jobStatus',w.status,'jobAttempts',w.attempts,'sessionStatus',s.status,
    'analysisGrants',(select count(*) from public.purpose_grants g where g.target_kind='cohort' and g.target_id=c.id and g.purpose='embryo.analysis'),
    'allSplitJobs',(select count(*) from public.worker_jobs where kind='split_cohort_vcf'),
    'bags',(${full}),${Object.entries(bags).map(([name, sql]) => `'${name}',
      (select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(convert_to(
        coalesce(jsonb_agg(row order by row::text collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'))
        from (${sql}) complete_rows)`).join(",")})
    from public.embryo_cohorts c join public.worker_jobs w on w.cohort_id=c.id and w.kind='split_cohort_vcf'
      join public.embryo_ingest_sessions s on s.id=w.source_binding_id and s.worker_job_id=w.id and s.cohort_id=c.id
    where c.id=${c};`;
}

async function assertLiveSurface(page: Page, row: DensityStateCase, facts: LiveCohortDensity) {
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator('[data-figure-kind], [data-claim-block], [data-compare-surface], [data-slot="qc-table"], [data-slot="qc-verdict"], [data-slot="result-gate"], [aria-sort]')).toHaveCount(0);
  if (row.route.id === "embryos.upload") {
    const processing = page.locator('[data-stage="processing"]'); await expect(processing).toHaveCount(1);
    await expect(processing.getByRole("heading", { name: PROCESSING_HEADING, exact: true })).toBeVisible();
    await expect(processing.getByRole("status")).toHaveText(PROCESSING_SENTENCE);
    await expect(page.locator('[data-slot="upload-complete"], [data-slot="file-form"], [data-slot="record-key-card"]')).toHaveCount(0);
  } else if (row.route.id === "embryos.index") {
    const card = page.locator(`[data-slot="cohort-card"][data-cohort-id="${facts.cohortId}"]`);
    await expect(card).toHaveCount(1); await expect(card).toHaveAttribute("data-cohort-status", "ingesting");
    await expect(card.locator('[data-slot="cohort-state"]')).toHaveText(STILL_CHECKING_STATUS);
    await expect(card.locator('[data-slot="embryo-state"]')).toHaveText([EMBRYO_STATUS.pending, EMBRYO_STATUS.pending]);
    for (const verdict of [EMBRYO_STATUS.qc_pass, EMBRYO_STATUS.qc_marginal, EMBRYO_STATUS.qc_fail])
      await expect(card).not.toContainText(verdict);
  } else {
    const blocking = page.locator('[data-slot="blocking-state"]'); await expect(blocking).toHaveCount(1);
    await expect(blocking).toHaveAttribute("data-state", row.state);
    await expect(blocking).toContainText(facts.phase === "processing" ? STILL_CHECKING_STATUS : waitingForResultsBody(ROLE_YOU));
    if (row.route.id === "embryos.detail")
      await expect(page.getByRole("heading", { level: 1, name: `Embryo ${facts.embryos[0].sampleOrdinal + 1}`, exact: true })).toBeVisible();
  }
}
