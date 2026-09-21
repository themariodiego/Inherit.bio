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

   **That last sentence points at the wrong directory, corrected 21 September
   2026.** `src/app/api/jobs/` holds maintenance endpoints, not queue
   consumers: nothing under `src/` reads `public.worker_jobs` at all, and the
   only mentions of it there are generated type references. The consumer that
   exists is `worker/src/index.ts`, a Tier-3 self-host worker that polls
   `public.worker_jobs` over a **direct Postgres connection** with
   `for update skip locked` rather than through PostgREST - which is why the
   private `claim_worker_job_v1` and `enqueue_worker_job_v1` need no public
   door and the queue is not unreachable the way the cohort-finalize
   transaction was. Its claim query filters `kind = 'annotate_vcf'` as a
   literal (`worker/src/index.ts:36`), so it handles exactly one of the nine
   registered kinds. `split_cohort_vcf` therefore needs either that filter
   widened with a second handler beside it, or its own consumer in the
   Cloudflare preparation-worker container - and in neither case a route.
3. **The browser sanitiser**, and the `EMBRYO_INGEST_AVAILABLE` flag, which
   is `false` at `src/copy/embryos/upload.ts:33` and pinned false by
   `src/lib/embryos/upload-flow.test.ts:155` and
   `src/copy/embryos/embryos.test.ts:243`. E2 steps 3–5 sit behind it.

**Two primitives these routes need are also already built, and are easy to
mistake for ones that are not.** The chunk contract requires an
`X-Inherit-CSRF` token bound to the upload session and a one-time chunk
nonce, and the mapping contract requires a one-time mapping-inspection nonce.
`src/lib/embryos/operation-token.ts` mints and verifies the CSRF half —
`CSRF_HEADER`, `OPERATION_HEADER`, `mintEmbryoOperation`,
`readEmbryoOperation`, `verifyEmbryoOperation`, with the sealed envelope
under its own digest context so a family token never reads as an embryo one —
and four shipped routes already consume it: `record-key-cards`,
`embryos/[id]/disposition`, `cohorts/[id]/restrict` and
`invitations/accept`. This is **not** the unbuilt token `docs/acceptance-matrix.md`
records against `/api/browse/region`, which has no minting presentation;
the embryo domain has its own and it is in production use.

**"Exactly these" was too strong, and this paragraph said it for four days
before the tokens were read against the primitive.** Corrected 21 September
2026, in the same session that wrote it. Of the three tokens named above,
one is built, one is buildable and one is not:

- **The CSRF token is built**, as described: sixteen modules name
  `X-Inherit-CSRF` and four routes verify it.
- **The mapping-inspection nonce is buildable**, but not today's envelope
  unchanged. It is a body field, not a header, and the register binds it to
  "upload session and challenge" — and the challenge is server-issued and
  server-stored, so a server can mint a token bound to it. What it needs is
  two new members: `EmbryoOperation` has no ingest operation and
  `EmbryoOperationTargetKind` has no ingest-session target, and both unions
  are closed.
- **The chunk nonce is neither**, and decision 9 below records why.

**"An extension, not a redesign" was still too easy, corrected the same day.**
Two things it missed, both found by reading the schema before starting the
chunk route rather than during it.

First, the unions are not the only closed set.
`public.embryo_operation_nonces.target_kind` carries a CHECK constraint over
`account`, `cohort_draft`, `cohort`, `embryo`, `rights_session` and `form`, so
an ingest-session target needs a **migration** as well as the two TypeScript
members. (`operation` does not: it is regex-constrained to `^[a-z_]{3,40}$`.)
Worth noting in passing that the database already allows `form`, which the
TypeScript union does not — the two sets have been out of step in the other
direction the whole time.

Second, and it matters more: **for the chunk route nothing would consume the
token anyway.** `verifyEmbryoOperation` checks the sealed envelope — signature,
expiry, and an exact match on account, session, operation and target — but
one-time-ness comes from `consume_embryo_operation_nonce_v1` recording the
hash, and that is called by the cohort lifecycle and the invitation guards,
never by `reserve_embryo_ingest_chunk_v1` or
`commit_embryo_ingest_chunk_v1`, neither of which takes a nonce at all. The
four shipped embryo routes are one-time because the RPC each one calls
consumes the token it passes; the chunk route has no such RPC.

So the register's `X-Inherit-CSRF` "bound to the upload session" is buildable
on the chunk route as a **session-bound token with a ten-minute lifetime** —
which is real cross-site protection and worth having — but not as a *one-time*
one, without either a nonce parameter on both chunk RPCs or a separate
consume call that would not share their transaction. That is a smaller version
of decision 9's problem and belongs to the same owner decision.

**And the mapping route needs more than a token, which the paragraph above
this one also got wrong.** The Context says what remains is "three routes
wiring a substrate that is finished and tested". That holds for the chunk and
complete routes. It does not hold for `api.embryo-ingest-mapping`: its
challenge store, `public.embryo_mapping_challenges`, **has no writer**.
Checked on 21 September - no function in any migration carries `challenge` in
its name, and no `insert` into that table exists anywhere in `supabase/` or
`src/`. The table is created by
`20260831224126_reference_registries_and_constraints.sql`, given a retention
order by `20260831224119_retention_dispositions.sql`, and deleted from by
`20260905203457_embryo_ingest_unwind_runtime.sql`. Created, retained, purged,
never populated.

A route could write it directly through the admin client - four routes already
do that for other tables (`jobs/research-refresh`, `jobs/research-publish`,
`files/[id]/process`), so it is within the house pattern and this is a genuine
choice rather than a blocked path. But the register asks the mapping route to
"store only a CSPRNG challenge-id hash, random revision, column count and
expiry and zeroize the submitted copy", to "rotate the challenge and nonce in
every nonterminal branch", and to dispatch the attemptFailure unwind "before
any session due-target or fragment delete". Those are transactional
invariants, and every other ingest write in this schema is a `security
definer` function for exactly that reason. So the mapping route is one new
database object plus two union members, not wiring, and it should be built
after the chunk and complete routes rather than first.

The header rule
the mapping route enforces is built too: `src/lib/genome/parsers/pgt-table.ts`
already reports the header cells that name a sex, gender or karyotype column,
which is the refusal this ADR's §10 requires before any row, audit log or
object write.

Recorded because the cost of the stale sentence is a session spent building
eight RPCs that are already deployed, and because the corrected scope changes
what the remaining work is: three routes wiring a substrate that is finished
and tested, one job executor, and a flag.

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

9. **The chunk request is identified by what it carries, not by a nonce.**
   `docs/route-register.json` makes `X-Inherit-Chunk-Nonce` a required header
   on `api.embryo-ingest-chunk`, "bound to session, sequence, declared
   content-length and chunk sha256". Reading the deployed functions on
   21 September 2026 established that no such token can be built here, and
   that all four of those bindings are already enforced without one.

   **Three of the four cannot be expressed.** The repository's only nonce
   primitive is `private.consume_embryo_operation_nonce_v1(p_nonce text,
   p_account_id uuid, p_session_id uuid, p_operation text, p_target_kind
   text, p_target_id uuid)`; it has no parameter that can carry a sequence
   number, a byte count or a content hash, and the sealed envelope in
   `src/lib/embryos/operation-token.ts` carries those same six fields and no
   more. **The fourth is worse than inexpressible**: a token bound to the
   chunk's sha256 can only be minted once the browser holds the bytes, so
   minting it needs a prior round trip carrying that hash — and that round
   trip is `private.reserve_embryo_ingest_chunk_v1`, the call the token would
   be protecting. Neither chunk RPC takes a nonce, and neither calls the
   consumer; the only callers of it are the cohort lifecycle and the
   invitation guards.

   **The intent was real, and the repository contradicts itself about it.**
   Recorded because the evidence cuts both ways and a later reading will find
   it: `src/lib/embryos/ingest-http.ts:106` tells a caller to invoke
   `readIngestChunk` "only after live authority and **the two operation
   tokens** have passed", which is the clearest sign that someone did intend a
   second token on the chunk path. But `src/lib/embryos/guards.ts:14`, the
   module holding "the checks every embryo route runs before it reads a body
   ... in one place so the order and the answers cannot drift between routes",
   describes **"the one operation token per request"** - and that is the
   convention all four shipped embryo routes follow, through `csrfOperation`.
   So the second token exists in one comment, on an unbuilt path, and was
   never reconciled with the shipped convention beside it or expressed in any
   primitive. That is what "an intent the design never reached" looks like
   from the inside, and the ingest-http sentence should be corrected by
   whichever change settles this.

   **All four bindings are enforced structurally, on every call.**
   `public.embryo_ingest_chunks` has `(session_id, sequence)` as its primary
   key. `sequence` must equal `embryo_ingest_sessions.expected_next_sequence`
   and no other reservation may be outstanding. `byte_count` is checked
   against `declared_capacity_bytes`, the 200,000,000-byte session cap and
   the 50-chunk cap. And a retry at an existing sequence whose sha256 differs
   does not merely fail the request: it calls
   `private.mark_embryo_ingest_failure_v1(session, 'chunk')` and fails the
   whole session. A replay of the identical bytes is an idempotent resume
   that allocates no new capacity and no new objects. Authority itself is
   re-established per request by `public.authorize_embryo_ingest_request_v1`,
   which matches `id`, `account_id`, `originating_session_id`, `cookie_hash`
   and `origin` in one predicate before taking any lock, and re-runs
   `private.embryo_ingest_binding_failure_v1`, so a revoked auth session or a
   stale cohort revision fails the chunk. That is strictly stronger than a
   nonce, which would refuse one request and leave the session alive.

   **The register is not edited here, and this decision does not authorise
   editing it.** The header stays declared and the divergence is recorded in
   `docs/route-divergence.json` under `unreadRequiredHeaders`, where
   `scripts/route-gate.ts` check 4d compares it in both directions — the same
   treatment check 4b gives the unhashable attestation fields, and for the
   same reason: the register goes on saying what it wants, and the ledger says
   why nothing serves it. Choosing between dropping the header and designing a
   nonce primitive that can bind a sequence and a content hash is the owner's;
   this records that the chunk route can be built correctly today either way,
   because the protection the header names is already in the database.

   `api.evidence-chunk` declares the same header and is **not** covered by
   this decision. That subsystem has tables but no chunk table, no reserve or
   commit RPC and no `src/lib/evidence`, so the mechanism that makes the nonce
   redundant here has no counterpart there yet. Its row in the ledger says so.

## Alternatives rejected

- **Per-embryo visibility before terminal publication**: killed by
  `canonical-source-publication-v1` — an early column is an existence
  signal about the others.
- **A subject-style direct Storage upload for cohort bytes**: killed by
  ADR 0016 — embryo bytes are transport-only through the bounded
  same-origin sanitiser.
- **A per-chunk one-time nonce** (`X-Inherit-Chunk-Nonce`, still declared in
  the register): killed by decision 9 — three of its four bindings cannot be
  expressed by any primitive here, the fourth cannot be minted before the
  round trip it would protect, and all four are already enforced by
  `public.embryo_ingest_chunks` with a stronger consequence.
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

- Part E0 (Platform) builds against this decision; part E2 then replaces the
  terminal with steps 3–5 and this ADR moves to Accepted. **This bullet read
  "the eight RPCs, the nine routes, the sanitiser, the worker, the mail
  templates" until 21 September 2026**, which had been wrong since the 5th for
  the same reason the Context was, and was left standing when the Context
  itself was corrected earlier the same day. What remains of E0 is the list in
  the Context: the three ingest routes, the `split_cohort_vcf` executor, the
  browser sanitiser and `EMBRYO_INGEST_AVAILABLE`. Every RPC named there is
  deployed. The route half is dated rather than stated, because it moves:
  measured against the register at main `42f5da9` on 21 September 2026, four
  of the nine registered `api.embryo-*` endpoints have an implementation
  (`embryo-cohort-drafts`, `record-key-cards`, `withdraw`, `disposition`) and
  five do not — the three ingest routes, plus `api.embryo-cohorts` and
  `api.embryo-record-key-cards-rights`. The Context's "three registered routes
  with no directory" counts directories, not routes: `api.embryo-cohorts`
  shares a directory with the `[id]` routes beneath it and still has no
  `route.ts`, and `api.embryo-record-key-cards-rights` sits under
  `/api/rights/`, which holds only `activate`.
- Pinned today by `src/copy/upload/errors.test.ts`,
  `src/lib/genome/parsers/{sniff,pgt-table}.test.ts`,
  `src/lib/genome/ingest-limits.test.ts`, `src/lib/embryos/upload-flow.test.ts`,
  `src/components/embryo/embryo.test.ts` and `e2e/embryos.spec.ts`.
