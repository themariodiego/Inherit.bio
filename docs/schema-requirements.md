# Inherit v2 schema requirements

Status: binding implementation checklist

This document translates `docs/route-register.json`, `docs/retention.md`, and
the accepted ADRs into database work. Those sources remain authoritative when
this checklist and a registered contract differ.

## Platform baseline

- Target the linked Supabase project **Inherit** (`zuvloczwgrayonqabnss`).
- Use Node.js 22 or later. Current Supabase client releases no longer support
  Node.js 20 after 2026-06-30.
- Create migrations with the repository-pinned Supabase CLI, never by inventing
  a timestamp. Apply and test them locally before a linked push.
- Do not specify extension versions. Supabase ignores pinned extension versions
  from 2026-08-05.
- Do not modify the `realtime` schema. It is platform-locked.
- Treat new `public` tables as unavailable to the Data API until explicit
  privileges are granted. RLS and SQL privileges are independent checks.

## Global database rules

1. Every table in `public` has RLS enabled in the migration that creates it.
   Revoke all default privileges from `anon` and `authenticated`, then grant
   only the operations required by a registered route.
2. A `TO authenticated` policy is never sufficient by itself. Each policy
   binds the current principal, target, lifecycle, purpose, relationship, and
   authorization revision required by the route register.
3. Every UPDATE policy has both `USING` and `WITH CHECK`. An UPDATE path also
   has the SELECT policy PostgreSQL requires.
4. User-controlled JWT metadata is not authorization input. Account roles and
   revisions live in server-owned rows or trusted app metadata and are re-read
   for sensitive operations.
5. Application clients never receive the service-role key. Browser code uses
   only the publishable key and the exact permitted RLS surface.
6. Privileged functions live in the unexposed `private` schema, set an empty
   `search_path`, schema-qualify every reference, revoke EXECUTE from `PUBLIC`,
   `anon`, and `authenticated`, and grant only the exact service or machine
   role that calls them. A security-definer function is allowed only where a
   named contract requires the RLS bypass and the function performs its own
   principal/session/revision checks.
7. Views over protected data use `security_invoker = true` or remain in an
   unexposed schema with no client grant.
8. Tables, functions, triggers, constraints, indexes, policies, grants, and
   storage policies must be reproducible from a clean `supabase db reset`.
9. Add pgTAP tests under `supabase/tests/` for anon and authenticated allow/deny
   behavior, cross-account denial, stale-revision denial, and mutation denial.
10. Migration tests preserve every baseline row and stable-column checksum.
    V2 migrations are additive until the explicit legacy-retirement phase.

## Identity and subject graph

Required stores include `profiles`, `subjects`, `subject_principals`,
`subject_account_bindings`, `subject_relationships`, `family_pairs`, and the
registered claimant-principal stores.

- `subjects.subject_class` has exactly `self`, `other_adult`, `minor`, and
  `embryo`. Product creation rejects minors before an Auth user or source row
  exists; retained legacy-minor rows are frozen and unreadable pending purge.
- A self/adult subject has at most one current account binding. An embryo has a
  cohort binding and no adult demographic row.
- Principal IDs are random and immutable. Contact values, account IDs, and
  token hashes never substitute for a principal.
- Relationship, subject binding, jurisdiction, and lifecycle revisions are
  non-null monotonic integers included in authorization fingerprints.
- The baseline `user_id` columns remain during backfill. Assertions prove each
  migrated row resolves to the correct account-owned self subject before any
  new read path is enabled.

## Legal artifacts, signatures, attestations, and grants

Required stores include `consent_artifacts`, `consent_signatures`,
`subject_consents`, `attestations`, `attestation_contradictions`,
`purpose_grants`, `directional_grants`, invitation tables, reviewed-evidence
tables, and donor-attribution tables.

- Artifact keys, versions, effective dates, bodies, and SHA-256 values are
  immutable. A signature points to the exact committed version and hash.
- Consent, attestation, and evidence are distinct facts. No generic boolean can
  replace a case-specific artifact or reviewed evidence reference.
- A purpose grant is exactly one purpose. Wildcards and family-wide implicit
  grants are forbidden.
- `purpose_grants` is the base row. `directional_grants` is its mandatory
  direction extension. Both use the same `grant_id` and database-generated
  `grant_revision`; neither row authorizes anything without the other.
- Create, reaffirm, and revoke lock and write or terminalize both grant rows in
  one transaction. Deferred integrity checks reject orphan, duplicate, and
  revision-mismatched pairs.
- The direction row contains the exact data-subject principal, recipient
  principal, optional recipient account, relationship or pair ID, and all
  relevant revisions. Requests cannot choose or swap those endpoints.
- A no-account Path-B principal is the signer and data subject. The immutable
  current uploader/grantee account principal is the recipient. Individual
  result grants are limited to `reports.monogenic`, `reports.polygenic`,
  `ancestry`, and `copilot.local`; `family.heritability` is only for an explicit
  multi-subject output.

## Embryo cohorts and results

Required stores include cohort drafts, cohorts, embryos, participant-set and
authority bindings, ingest sessions/fragments/handles, QC, findings, figures,
variant rows, disposition proposals, Record-Key rights/hashes, claims,
corrections, suppressions, and notices listed in the purge registry.

- Cohort finalization resolves exactly one registered basis case. Persist all
  five independent participant sets and their revisions; an identified donor
  can appear only in the separate attribution-principal set.
- True two-parent finalization requires both exact parent artifacts and forbids
  a single-parent basis artifact. Each single-authority case requires exactly
  its registered artifact and reviewed evidence.
- `embryos` stores a unique zero-based `sample_ordinal` per cohort and a neutral
  server-generated display label. No source sample/lab/cycle label is stored.
- Embryo genetic tables accept only chromosomes 1–22. BEFORE-write triggers
  normalize and reject all other contigs even for privileged writers.
- No embryo demographic, sex, karyotype, proxy, rank, composite, grade, or
  recommendation column exists.
- Allowed condition IDs and model bindings equal
  `data/embryo/allowed_conditions.json`. The initially empty registry is a
  deliberate unavailable state: it produces no numeric embryo finding.
- Stored result documents validate recursively against the exact eight-key
  `EmbryoFinding` leaf and its registered child graph before insert/update.
- QC thresholds, coverage failures, within-family validation, natural-frequency
  rendering inputs, citations, and model revisions are stored explicitly; no
  renderer recomputes or invents a value.
- Disposition, Record-Key, transfer, claim, correction, and withdrawal writes
  lock and re-resolve the current basis, all participant sets, grants,
  lifecycle, key revision, and claimant revision before any side effect.

## Files, variants, storage, and downloads

- `genome_files` binds one subject or one cohort, never both. The persistent
  source publication tuple records structural validation, source hash, build,
  canonical build, publication state, and authorization revisions.
- Ordinary subject inputs prove one logical sample before publication. Embryo
  input is sanitized through bounded same-origin chunks; only the autosomal
  canonical source can reach persistent Storage.
- Storage object names are random handles. Database joins, not key prefixes,
  select objects for reads or purge.
- Client upload authority permits only one create-only staging insert. It grants
  no list/read/update/upsert/final-key access. Final objects are server-only.
- Downloads and exports use revocable chunk sessions. Each range read rechecks
  the originating authenticated `session_id`, principal graph, target,
  lifecycle, grant, publication, and authorization revisions.
- Storage policies are tested separately from table RLS. Any future upsert path
  must deliberately grant and test INSERT, SELECT, and UPDATE together.

## Chats, model settings, and generated artifacts

- Chats have an immutable server-derived scope and target binding. The request
  body cannot select a scope.
- Paired turns share one immutable authorization and source fingerprint. A
  refusal writes no half-turn. Stale contributor, grant, cohort, donor, or
  transport state invalidates the complete dependent pair chain.
- Model endpoint credentials and keys remain encrypted server-only data with no
  Data API grant. Raw model input/output is never persisted.
- Cohort context, completion, and history findings use the exact recursively
  closed `EmbryoFinding` graph. Refusal and unavailable branches structurally
  contain zero findings.
- Export manifests are exhaustive, subject-partitioned, and bound to a locked
  principal graph snapshot. Generated archives expire under
  `export.generated-artifact-24h`.

## Jobs, retention, and audit

- Worker rows store the registered output kind, source-binding kind, complete
  length-prefixed authorization fingerprint, computation revision, claim
  lease, retry state, and stable idempotency key.
- Every one of the 49 retention IDs is assigned exactly once to the disjoint
  execution registry. Scheduled rows use the 52 stable phase IDs and the
  `(retention_row_id, phase_id, phase_revision)` identity.
- Purge manifests use only the 25 registered manifest classes, 33 ordered
  targets, and 108 uniquely classified stores. Workers never infer targets
  from caller input or object prefixes.
- `legal_audit_log` contains coded fields and random audit-principal IDs only.
  Live account/subject links are separately encrypted and can be crypto-shred.
- The sole private append function serializes on one database lock, rejects
  caller-supplied sequence/timestamps, allocates `seq`, and sets database-owned
  `occurred_at >= previous.occurred_at` before hashing the row.
- The sole private retention function verifies the complete chain and monotonic
  sequence/time invariant, checkpoints one contiguous fully expired prefix,
  deletes only that prefix, and appends a new coded invocation event. Direct
  UPDATE/DELETE/TRUNCATE on the ledger is unavailable to application roles.

## Migration sequence

Create each file with `corepack pnpm exec supabase migration new <name>`.
Preserve this dependency order even when the CLI timestamp differs:

1. `subjects_and_principals`
2. `legal_artifacts_and_consents`
3. `v2_backfill`
4. `embryo_cohorts_and_authority`
5. `legal_audit_chain`
6. `worker_jobs_v2`
7. `rls_and_privileged_functions`
8. `storage_and_download_sessions`
9. `chat_scope_and_context`
10. `ancestry_regions`
11. `retention_dispositions`
12. `claims_corrections_and_appeals`
13. `rate_limits_and_abuse_controls`
14. `exports_and_generated_artifacts`
15. `reference_registries_and_constraints`

Before a linked push: run a clean reset, pgTAP/RLS tests, migration data-loss
checks, generated TypeScript type diff, database advisors, and the canonical
schema/store coverage gate. A linked production push is not permitted while
any of those checks fail.
