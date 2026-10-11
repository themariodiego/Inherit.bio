import { expect, type Browser, type Page } from "@playwright/test";
import { adminClient } from "./helpers";
import { seedParticipantC, participantCPassword, type ParticipantCMail } from "./participant-c-journey";
import { withEmbryoJourney } from "../scripts/ci-embryo-journey";
import { reviewFixtureSql } from "./helpers/claim-review-fixture";
import { readPendingEmbryoInput } from "../src/lib/embryos/pending-input-read";
import { isUntouchedPendingInput, type PendingEmbryoInput } from "../src/lib/embryos/pending-input";
import type { OwnedLinuxCapability } from "../scripts/owned-linux-runtime";
import { FILE_NOT_ADDED_SENTENCE } from "../src/copy/embryos/detail";
import { STILL_CHECKING_STATUS } from "../src/copy/embryos/index";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/** Complete native row bags; only digests leave SQL, never source bytes or
 * key/cookie/handle material. Caller owns the actual isolated runtime. */
async function pendingBag(cohort: string): Promise<string> {
  if (!UUID.test(cohort)) throw new Error("Exact finalized cohort required");
  const bag = await reviewFixtureSql(`select encode(extensions.digest(convert_to(jsonb_build_object(
    'cohort',(select to_jsonb(c) from public.embryo_cohorts c where c.id='${cohort}'),
    'embryos',(select jsonb_agg(to_jsonb(e) order by e.id) from public.embryos e where e.cohort_id='${cohort}'),
    'subjects',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subjects s where s.cohort_id='${cohort}'),
    'sessions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.embryo_ingest_sessions s where s.cohort_id='${cohort}'),
    'chunks',(select jsonb_agg(to_jsonb(k) order by k.session_id,k.sequence) from public.embryo_ingest_chunks k
      join public.embryo_ingest_sessions s on s.id=k.session_id where s.cohort_id='${cohort}'),
    'fragments',(select jsonb_agg(to_jsonb(f) order by f.session_id,f.sequence,f.sample_ordinal) from public.embryo_ingest_fragments f
      join public.embryo_ingest_sessions s on s.id=f.session_id where s.cohort_id='${cohort}'),
    'files',(select jsonb_agg(to_jsonb(f) order by f.id) from public.genome_files f join public.subjects s on s.id=f.subject_id where s.cohort_id='${cohort}'),
    'qc',(select jsonb_agg(to_jsonb(q) order by q.embryo_id) from public.embryo_qc q join public.embryos e on e.id=q.embryo_id where e.cohort_id='${cohort}'),
    'work',(select jsonb_agg(to_jsonb(w) order by w.id) from public.worker_jobs w where w.cohort_id='${cohort}'
      or w.subject_id in(select id from public.subjects where cohort_id='${cohort}')
      or w.file_id in(select f.id from public.genome_files f join public.subjects s on s.id=f.subject_id where s.cohort_id='${cohort}')
      or(w.source_binding_kind='embryo-ingest-fragment-set' and w.source_binding_id in(select id from public.embryo_ingest_sessions where cohort_id='${cohort}'))),
    'participants',(select jsonb_agg(to_jsonb(p) order by p.set_kind,p.principal_id,p.membership_revision) from public.embryo_participant_sets p where p.cohort_id='${cohort}'),
    'grants',(select jsonb_agg(to_jsonb(g) order by g.grant_id,g.grant_revision) from public.purpose_grants g where g.target_kind='cohort' and g.target_id='${cohort}')
  )::text,'UTF8'),'sha256'),'hex')`);
  if (!/^[0-9a-f]{64}$/u.test(bag)) throw new Error("Complete pending native bag missing");
  return bag;
}

/** Fresh real native finalization at the original embryo origin. One call per
 * provider/viewport; no prior cohort adoption or completed/seeded result.
 * The normal journey still uploads, runs its original worker, verifies its
 * full publication and closes through the original runtime after capture. */
export async function withFinalizedEmbryoEmpty(input: {
  page: Page; browser: Browser; environment: Readonly<Record<string, string | undefined>>;
  ownerEmail: string; parentEmail: string; messages: ParticipantCMail[]; jobsSecret: string;
  operator?: OwnedLinuxCapability;
  capture: (scope: { page: Page; accountId: string; cohortId: string; embryoId: string; subjectId: string;
    nativeSessionId: string; wholeBag: string; current: () => Promise<void>;
    read: () => Promise<PendingEmbryoInput> }) => Promise<void>;
}) {
  if (!input.jobsSecret || new URL(input.page.url()).origin !== "http://localhost:3105")
    throw new Error("Fresh actual embryo origin and jobs caller required");
  let captured = false;
  await withEmbryoJourney(input.environment, async runtime => {
    const journey = await seedParticipantC({ page: input.page, browser: input.browser,
      ownerEmail: input.ownerEmail, parentEmail: input.parentEmail, password: participantCPassword,
      messages: input.messages, jobsSecret: input.jobsSecret, runtime,
      beforeFile: async scope => {
        const embryo = scope.embryos[0];
        const selection = { accountId: scope.owner, cohortId: scope.cohortId,
          embryoId: embryo.id, subjectId: embryo.subject_id };
        const before = await pendingBag(scope.cohortId);
        const read = async () => {
          const actual = await readPendingEmbryoInput(adminClient(), selection);
          expect(isUntouchedPendingInput(actual), "Exact native untouched finalization").toBe(true);
          expect(actual.sessions.map(attempt => attempt.id)).toEqual([scope.nativeSessionId]);
          expect(await pendingBag(scope.cohortId)).toBe(before);
          return actual;
        };
        const current = async () => { await read(); };
        await current();
        // Same genuine owner session, separate page: the original one-use
        // finalization controls and issued handles remain on the upload page.
        const readPage = await scope.ownerPage.context().newPage();
        try {
          await readPage.goto(`/embryos/${embryo.id}`);
          const block = readPage.locator('[data-slot="blocking-state"]');
          await expect(block).toHaveAttribute("data-state", "empty");
          await expect(block).toContainText(FILE_NOT_ADDED_SENTENCE);
          await expect(readPage.getByText(STILL_CHECKING_STATUS, { exact: true })).toHaveCount(0);
          await expect(readPage.getByRole("heading", { level: 1 })).toContainText("Embryo 1");
          for (const selector of ["[data-figure-kind]", "[data-condition-id]", '[data-slot="qc-block"]', '[data-slot="result-gate"]'])
            await expect(readPage.locator(selector)).toHaveCount(0);
          await current();
          await input.capture({ page: readPage, ...selection, nativeSessionId: scope.nativeSessionId, wholeBag: before, current, read });
          await current(); captured = true;
        } finally { await readPage.close(); }
      },
    });
    try { if (!captured) throw new Error("Actual finalized empty capture did not complete"); }
    finally { await journey.closeCoParent(); }
  }, undefined, process.platform, input.operator);
}
