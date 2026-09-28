# Embryo session configuration — 22 September 2026

This draft adds private, service-only database prerequisites. It does not enable
embryo uploads. There is no new HTTP route, Storage writer, worker, publication,
sex caller or result display, and `EMBRYO_INGEST_AVAILABLE` remains false.

## Branch composition

Written on 22 September on top of PR #189, which retained observed X/Y source
calls. It landed on 27 September directly on `main`, without #189. ADR 0034
withdrew the standalone embryo sex result, and `main` still discards X and Y
records at ingest. Nothing in this patch reads them. The embryo-only portion of
PR #187 (the approved chunk-header exemption, strict Origin/fetch-metadata
checks, their tests and register entries) was already on `main`. The migration
was re-dated to `20260927120000` so that it sorts after every migration already
applied.

PR #188's reference-based table build inference is separate. Nothing in this
patch computes an inferred build. Only the trusted
server parser or inference boundary may supply the format, canonical build and
evidence category to these private procedures. A browser declaration is not
that boundary, and these procedures are not exposed through PostgREST.

## What is implemented

- Configuration checks the exact account, auth session, cookie hash, Origin,
  cohort and ingest revision before mutation. It reuses the live consent,
  participant, handle, jurisdiction and revocation authorizer.
- Format and configuration identity become write-once. An unresolved table
  build remains null until its separate bounded decision is accepted. Identical
  retries preserve the original identity; a changed operation cannot adopt it.
- Challenges store a random token's hash, random revision, fixed expiry, column
  count and authority bindings. No source header, label, example, candidate set
  or derivative of source text is accepted. At most one challenge is pending.
- Decisions retain only unique canonical field/index pairs or the canonical
  build. Challenge kind selects the accepted shape. Nonce consumption and the
  state transition share a transaction. Expired or stale real challenges return
  the exact failure-pending envelope for the existing unwind dispatcher.
- Database triggers prevent changing configured format/build, challenge identity,
  expiry or resolved decisions. The original 24-hour session and due phase stay
  intact. A pending attempt still reserves capacity.

The caller generates and temporarily retains a challenge token across an
uncertain database response. An exact issuance retry uses the same token and
nonce; it does not create a fresh deadline. The database keeps only their hashes.

## Verification and remaining work

The pgTAP file adds success, credential denial, wrong cohort, replay, changed
identity, expired challenge, unknown build, revocation, malformed mapping,
immutability and unchanged-due-phase checks. A planted lock-contention error
checks transactional rollback; it is not a two-backend race measurement.
These database tests have not run locally. CI must execute them before this
migration can be called verified. No hosted database was changed.

The inherited transport/header checks and the route gate tests pass locally:
175 tests across five files. Lint, the route gate and readability also pass.
The existing six in-app withdrawal decision belongs to PR #187; this branch
changes only its embryo portion and leaves task-depth measurements untouched.

The next source-accepting work must supply all of the following:

1. A registered client presentation for the mapping and completion operation
   tokens and transport descriptor. The current cohort response deliberately
   omits the transport challenge and has no operation-token field. This patch
   does not invent an additional HTTP response field.
   **Registered for VCF on 28 September (ADR 0035).** `api.embryo-ingest-configure`
   takes the source's `##fileformat`, `##reference` and `##contig` lines and its
   sample count. It answers `embryo-vcf-transport-v1` with the server-derived
   build, the transport challenge and revision, the completion nonce and the
   CSRF token. The first nonce arrives as `operationNonce` in the embryo branch
   of `upload-session-v1`. Nothing is built yet, and tables still need their
   own token presentation.
   **Built for VCF on 28 September, TEST-LOCAL only.** The route is
   `src/app/api/embryo-ingest/[session]/configure/route.ts`. Its one
   transaction is `configure_embryo_vcf_ingest_v1`, in migration
   `20260929110000_embryo_vcf_configure_route.sql`:
   - It records format and build through
     `private.configure_embryo_ingest_session_v1`.
   - It stores the challenge, the completion nonce and the CSRF token as
     SHA-256 digests only, and clears the raw challenge minted with the
     session. A trigger makes all of them write-once.
   - It draws the random revision.
   - `authorize_embryo_ingest_request_v1` now returns `challengeHash`, never a
     raw challenge. A chunk route compares the digest of the challenge its
     header carries.
   - The three tokens are sealed embryo operation tokens bound to the account,
     the auth session and the upload session. They expire at the session's
     fixed deadline (`mintIngestSessionOperation`).
   - `POST /api/embryo-cohorts` now returns `operationNonce`, `configureRoute`
     and `expiresAt`. `chunkRoute` and `completeRoute` wait for their routes.
2. The bounded mapping endpoint and client orchestration, including independent
   parser/header validation before these private writes. The handler must also
   validate the offered candidates in memory: persisted canonical index pairs
   prove neither that a choice was offered nor what a discarded header meant.
   A protocol for that validation must respect the ban on persisting source
   headers and their derivatives. The VCF/table sanitizer
   generators already exist; their existence is not a complete upload flow.
3. The physical-write fence, Storage acknowledgements and terminal unwind.
   `prepare_embryo_ingest_unwind_v1` only prepares a manifest. Its final comment
   explicitly says no Storage ACK or terminal graph-purge RPC exists. Its
   upload-staging manifest must use the recorded bucket rather than the old
   `genomes-staging` literal (D-130).
   **The metadata write fence exists since 28 September**
   (`20260928100000_embryo_ingest_write_fence.sql`); see item 1 of
   `docs/embryo-ingest-unwind-runtime.md` for what it proves and what it does
   not. The Storage acknowledgement, D-130 and the terminal unwind remain.
4. An atomic ingest-completion transaction and a `split_cohort_vcf` consumer.
   `finalize_embryo_cohort_ingest_v1` creates the initial cohort/session; it does
   not complete uploaded fragments. No existing transaction enters
   `sanitization_pending` or enqueues that job from an ingest manifest.
   **Completion exists, 2026-09-28; the consumer does not yet.**
   `private.complete_embryo_ingest_v1` (door `public.complete_embryo_ingest_v1`,
   `20260930120000_embryo_ingest_completion.sql`) reruns the shared door and
   `private.embryo_ingest_binding_failure_v1`, requires the completion nonce the
   configure step issued (`issued_completion_nonce_hash`), every chunk `stored`,
   the exact ordinal set and every fragment's write intent `landed` under the
   fence (the landing record for either backend), then locks the manifest digest on the
   session, enqueues exactly one
   `split_cohort_vcf` job bound to it and marks `sanitization_pending`, in one
   transaction. A refusal uses `private.mark_embryo_ingest_failure_v1` and keeps
   everything for the unwind. The unwind planner now admits that one job and
   still refuses any other job on the cohort. No route calls it;
   `supabase/tests/embryo_ingest_completion.sql` covers it.
   **The consumer's first half exists, 2026-09-28.**
   `20260930121000_embryo_split_worker.sql` adds claim, check, renew, fragment
   read authority, stage, finish and fail for `split_cohort_vcf` only, behind
   `private.embryo_split_config` (off by default). Each call reruns the binding
   check and recomputes the manifest digest. `src/lib/embryos/split-worker.ts`
   names each fragment by (session, sequence, ordinal). It gets its landed
   identity from `read_embryo_split_fragment_v1` under the live claim, and
   reads it through a reader seam. The R2 implementation,
   `split-fragment-reader.ts`, sits over `readEmbryoFragment`
   (`docs/embryo-fragment-storage.md`). The worker re-verifies size and
   SHA-256, revalidates and parses each fragment with the product VCF parser,
   stages that embryo's own called genotypes and records its QC outcome from
   `qc-policy.ts`. The results are worker-only pending rows
   (`private.embryo_split_ordinals`, `private.embryo_split_variants`). Nothing is
   published. `pnpm worker:embryo-split` is operator-started and TEST-LOCAL.
   Laboratory tables end with the closed `format` code.
5. Whole-cohort publication, cleanup and real browser journeys before activation.
   The current fragment trigger requires a resolved build, while the register
   describes retaining sanitized unknown-build fragments pending a decision.
   That ordering requires its own explicit implementation and verification.

ADR 0034 (27 September) allows X and Y calls to be read only to work out a
registered serious sex-linked condition, and none is registered. This
configuration work supplies no threshold or display conclusion. No acceptance
row changes, and no production permission is enabled.
