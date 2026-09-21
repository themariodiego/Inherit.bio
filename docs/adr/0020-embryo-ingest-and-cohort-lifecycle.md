# ADR 0020: Embryo ingest and cohort lifecycle: ordinal identity, whole-cohort publication, no file until the parties have signed

- Status: Proposed (becomes Accepted when the ingest routes, the browser sanitiser and the `split_cohort_vcf` worker exist)
- Date: 2026-09-04
- G7.1 name: "embryo ingest and cohort lifecycle"
- Related: ADR 0016 (transport and closed formats), ADR 0003 (no imputation), ADR 0019

## Context

An embryo file arrives from a laboratory as a multi-sample VCF, one VCF per
embryo, a genotype table, or a zip of those (`brief:379`, ADR 0016). The
brief's consent standard for such a file is evidentiary, not declarative
(`brief:383`, `brief:1722-1735`): both genetic parents evidenced in their
own accounts, the insurance disclosure and the Future Person Charter
acknowledged, and only then a file. The register binds the ingest session
(`embryo-ingest-session-v1`), the request body of a cohort draft
(`closed-embryo-cohort-draft-v1`), the header rule for laboratory tables
(`genetic-file-ingest-v1.pgtTable`) and the publication invariant
(`canonical-source-publication-v1`). None of the routes, the migration's
RPCs, the sanitiser or the worker exists yet (design §10, part E0).

**That last sentence was true on 4 September and has been wrong since the
5th.** Measured against the Inherit project's live catalogue on 21 September
2026, and against `supabase/migrations/` in the same pass: the E0 **database
layer is built and deployed**. Every ingest table exists with row-level
security on — `embryo_ingest_sessions` (33 columns), `embryo_ingest_chunks`,
`embryo_ingest_fragments`, `embryo_ingest_unwinds`,
`embryo_ingest_delete_objects`, `embryo_fragment_handle_maps`,
`embryo_mapping_challenges` and `embryo_operation_nonces` — and so do the
RPCs that drive them: `create_embryo_ingest_session_v1`,
`reserve_embryo_ingest_chunk_v1`, `commit_embryo_ingest_chunk_v1`,
`freeze_embryo_ingest_session_v1`, `mark_embryo_ingest_failure_v1`,
`finalize_embryo_cohort_ingest_v1`, `prepare_embryo_ingest_unwind_v1`,
`bind_embryo_fragment_object_v1`, `consume_embryo_operation_nonce_v1` and the
public `authorize_embryo_ingest_request_v1`. Two of this ADR's own
sanitisation rules are enforced in the database as triggers:
`reject_embryo_demographics` and `embryo_forbidden_columns_guard`. They
arrived in `20260905191141_embryo_ingest_chunk_reservations.sql`,
`20260905192551_embryo_ingest_session_lifecycle.sql` and
`20260905202656_embryo_ingest_http_authorization.sql` — **one day after this
ADR was written** — and nothing came back to amend the sentence above.
Repository and production agree; this is a stale document, not schema drift.

**What is genuinely missing, measured the same day**, and it is smaller than
the paragraph above implies:

1. **The three ingest routes.** `docs/route-register.json` registers
   `api.embryo-ingest-mapping` (`/api/embryo-ingest/[session]/mapping`),
   `api.embryo-ingest-chunk` (`.../chunks/[sequence]`) and
   `api.embryo-ingest-complete` (`.../complete`). `src/app/api/` has no
   `embryo-ingest` directory. The library layer they would consume already
   exists and is unit-tested: `src/lib/embryos/ingest-session.ts`,
   `ingest-http.ts`, `ingest-binding.ts`, `ingest-lines.ts`,
   `vcf-transport.ts`, `table-transport.ts`, `source-labels.ts`,
   `projection.ts` and `qc-policy.ts`.
2. **The `split_cohort_vcf` executor.** The job *kind* is registered — it is
   in the `worker_jobs` kind list at
   `20260831224034_worker_jobs_v2.sql:124`, and
   `supabase/tests/job_timing_privacy.sql` proves its timing disclosure — but
   nothing executes it. `src/app/api/jobs/` ships five routes (`retention`,
   `annotation-refresh`, `mail`, `research-refresh`, `research-publish`) and
   none of them is for ingest. A registered kind with no executor is a job
   that can be enqueued and never run.
3. **The browser sanitiser**, and the `EMBRYO_INGEST_AVAILABLE` flag, which
   is `false` at `src/copy/embryos/upload.ts:33` and pinned false by
   `src/lib/embryos/upload-flow.test.ts:155` and
   `src/copy/embryos/embryos.test.ts:243`. E2 steps 3–5 sit behind it.

Recorded because the cost of the stale sentence is a session spent building
eight RPCs that are already deployed, and because the corrected scope changes
what the remaining work is: two surfaces and a flag, on top of a data layer
that is finished.

## Decision

1. **Ordinal identity over laboratory labels.** An embryo is `Embryo n` by
   its `sample_ordinal`. Source sample labels, column headers and file
   names are used only transiently in bounded memory to associate rows;
   they are never persisted, logged, rendered or exported
   (`docs/canonical-artifacts.md`, the sex-safe identity row). `sniffV2`
   returns a VCF's sample names for the browser's ephemeral handle map and
   the narrow `sniff` wrapper drops them.
2. **Whole-ordinal publication after partial failure.** `split_cohort_vcf`
   continues past an embryo that fails quality, and nothing about any
   embryo is visible before the terminal transaction publishes every
   ordinal at once, each either published or failed with its closed reason
   (A.10, `brief:2222`). A pre-publication failure keeps no genetic data
   and invalidates every Record Key Card of the upload.
3. **No parental substitution, no imputation.** A finding is computed from
   the embryo's own called genotypes only (`brief:2241`; ADR 0003 by name;
   the brief's "parental substitution" and "conclusion-laundering"
   anti-patterns).
4. **Either parent restricts the whole cohort.** A `delete` on the
   withdrawal link or the landing's destructive action dispatches the
   whole-cohort restriction: access ends on the next query, derived rows
   within 60 seconds, sources within 7 days (`docs/retention.md`).
5. **Retention follows disposition.** Stored or unknown: 24 months from
   the later of added or last analysed, renewable by every disposition
   authority; donated or discarded: 90 days; transferred: until the date
   on the Record Key Card (`docs/retention.md`, A.13(c)).
6. **The empty registry is a deliberate unavailable state**, not a bug:
   with `data/embryo/allowed_conditions.json` empty no condition is scored,
   and every surface says so in one sentence.
7. **The refusals have one home.** Every A.6 code and sentence lives once
   in `src/copy/upload/errors.ts` (`brief:2196-2209`), re-exported at the
   brief's path `src/lib/genome/ingest-errors.ts`. Today the uploader's
   browser preflight and the quality footers consume it; the file
   processor's server-side re-sniff (`brief:2194`) and the embryo ingest
   routes consume it when E0 wires them. The subject uploader refuses a
   cohort-shaped source — a laboratory table or a VCF with several samples
   — with the register's `subject_source_not_single_sample` sentence and a
   link to the Embryo flow, and a PDF with the letter. `sniffV2` names BAM/CRAM, PDF, single- and multi-sample VCF, the
   four consumer arrays and a laboratory table in that order; the table
   rule is exact equality after normalisation against
   `data/ref/lab-tables/column-synonyms.json`, three of six fields, and a
   mapping plan of at most four neutral column decisions.
8. **Until E0 exists, the flow tells the truth.** `/embryos/upload` renders
   its first two steps — the three questions and whose embryos these are —
   screen by screen so that no screen carries more than five interactive
   elements of its own (X6.1's seven on the repository's basis, less the
   shell's search button and desktop attribution link): the first two
   questions share a screen, the four illustrated options and the four
   bases are actions, "No" and "A PDF report only" end the flow on the
   brief's sentences, and every other path ends on "Inherit cannot take
   embryo files on this site yet." with the letter to the laboratory. `EMBRYO_INGEST_AVAILABLE` is false, nothing is persisted
   and no request leaves the page. The second parent's contact email, the
   Tier-2 signature block and the file are not asked for until a draft
   can be created: collecting a contact or a typed legal name that nothing
   records is a false affordance.

## Alternatives rejected

- **Per-embryo visibility before terminal publication**: killed by
  `canonical-source-publication-v1` — an early column is an existence
  signal about the others.
- **A subject-style direct Storage upload for cohort bytes**: killed by
  ADR 0016 — embryo bytes are transport-only through the bounded
  same-origin sanitiser.
- **A PDF stored "for the record"** (`brief:379`, acceptance 27
  `brief:485`): killed by ADR 0016 and the canonical PDF row — no OCR, no
  estimate from a report, ever.
- **All three questions on one screen**: killed by X6.1 — ten interactive
  elements where at most seven may be; and one question per screen with
  Back and Continue on every screen was killed by the same cap once the
  shell's two persistent controls were counted (CI run 33924630411).
- **Rendering all five steps with the file step disabled**: killed by the
  no-dead-control rule (`docs/protocol/decisions.md`) — a disabled control
  that will never enable on this deployment is a promise.
- **Collecting the co-parent's email before a draft exists**: rejected in
  this slice for the reason in point 8; it returns with `api.embryo-cohort-drafts`.

## Consequences

- Part E0 (Platform: the eight RPCs, the nine routes, the sanitiser, the
  worker, the mail templates) builds against this decision; part E2 then
  replaces the terminal with steps 3–5 and this ADR moves to Accepted.
- Pinned today by `src/copy/upload/errors.test.ts`,
  `src/lib/genome/parsers/{sniff,pgt-table}.test.ts`,
  `src/lib/genome/ingest-limits.test.ts`, `src/lib/embryos/upload-flow.test.ts`,
  `src/components/embryo/embryo.test.ts` and `e2e/embryos.spec.ts`.
