# Embryo session configuration — 22 September 2026

This draft adds private, service-only database prerequisites. It does not enable
embryo uploads. There is no new HTTP route, Storage writer, worker, publication,
sex caller or result display, and `EMBRYO_INGEST_AVAILABLE` remains false.

## Branch composition

The branch starts at PR #189, `5c853b6`, retaining observed X/Y source calls and
its unqualified evidence arithmetic. It also carries the embryo-only portion
of PR #187: the approved chunk-header exemption, strict Origin/fetch-metadata
checks, their tests and the corresponding register entries. No unrelated UI or
comprehension changes are copied. These changes applied without conflicts.

PR #188's reference-based table build inference is a later integration
prerequisite. Nothing in this patch computes an inferred build. Only the trusted
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
4. An atomic ingest-completion transaction and a `split_cohort_vcf` consumer.
   `finalize_embryo_cohort_ingest_v1` creates the initial cohort/session; it does
   not complete uploaded fragments. No existing transaction enters
   `sanitization_pending` or enqueues that job from an ingest manifest.
5. Whole-cohort publication, cleanup and real browser journeys before activation.
   The current fragment trigger requires a resolved build, while the register
   describes retaining sanitized unknown-build fragments pending a decision.
   That ordering requires its own explicit implementation and verification.

A chromosomal-sex result still needs the assay profile, calibration and reviewed
quality limits described in `docs/design/chromosomal-sex-result.md`. No generic
threshold or display conclusion is supplied by this configuration work. No
acceptance row changes, and no production permission is enabled.
