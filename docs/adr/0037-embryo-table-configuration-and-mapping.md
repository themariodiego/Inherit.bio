# ADR 0037: Embryo laboratory tables — configure, mapping questions and token rotation

- Status: Accepted (owner decisions, 16 October 2026); built TEST-LOCAL only.
  Production stays off.
- Date: 2026-10-16
- Builds on ADR 0020 (embryo ingest) and ADR 0035 (embryo VCF configuration).
  It amends ADR 0035 point 1, which kept tables off the configure route.

## Context

A laboratory table could not be ingested. The register named
`api.embryo-ingest-mapping`, but three things were missing:

- **No build for a table.** The configure route took VCF only, and nothing
  said where a table's build comes from.
- **No tokens after the mapping step.** The register's PUT answered an empty
  204, so after a column decision the browser had no next nonce and no
  transport challenge.
- **No handler.** Nothing in `src/` called
  `private.create_embryo_mapping_challenge_v1` or
  `private.resolve_embryo_mapping_challenge_v1`.

On 16 October the owner decided two things (`docs/protocol/decisions.md`):

- **Build.** The configure step records a table session as `pgt_table`. Its
  build comes from the file header when the header states one
  (`explicit-header`). Otherwise the session is `decision-required`, and the
  mapping route asks GRCh37, GRCh38 or unknown before any chunk. `unknown` ends
  the upload. Tables do not use position-based build inference in this
  release, and table chunks are refused until the build is resolved.
- **Token rotation.** `pgt-mapping-challenge-v1` and a 200 PUT decision
  response carry the next operation nonce and the transport challenge,
  following the VCF configure response. The session CSRF header rule is
  unchanged.

## Decision

1. **Configure takes a table.** `POST /api/embryo-ingest/[session]/configure`
   reads `{ format: "pgt_table", buildEvidence, nonce }`. `buildEvidence` holds
   only the table's own `##reference=` and `##contig=` preamble lines, at most
   64 lines of at most 512 characters. Any other line is refused before any
   write. The server reads them with the product's header rule
   (`buildFromHeaderLines`):
   - exactly one build → `explicit-header`;
   - none or conflicting → `decision-required`, with no build recorded.

   The answer, `embryo-table-configuration-v1`, carries only the one nonce for
   the mapping inspection. The transaction is
   `configure_embryo_table_ingest_v1`.
2. **The mapping POST inspects the header once.** The browser drops every
   forbidden sex, gender, karyotype or proxy column before any byte leaves it,
   and sends the bounded header copy: at most 128 cells of at most 80
   characters. The server repeats header detection and the mapping plan in
   memory. It refuses a forbidden column, a header that is not a table, or a
   plan with no column left, terminally, before any write except the failure
   mark. It records only the canonical locus kind, `rsid` or `chrom-pos`. No
   header text is stored. Then exactly one branch of `pgt-mapping-challenge-v1`
   answers:
   - `columns` when one to four decisions remain;
   - `build` when the header resolves and the build is `decision-required`;
   - `transport` when nothing is left to decide.
3. **The mapping PUT decides.** A column decision is checked against the
   offered candidates through `private.resolve_embryo_mapping_challenge_v1`.
   Every challenge, column or build, is issued by the new
   `private.issue_embryo_table_challenge_v1`. The earlier
   `private.create_embryo_mapping_challenge_v1` consumes the inspection nonce
   itself, so it cannot issue the build question that follows a column
   decision in the decide transaction. It stays uncalled. A
   build decision of `unknown` marks the attempt failure-pending, dispatches
   the unwind and answers `build_unknown`. Every 200 carries the next nonce:
   - the build branch, when a build question still follows;
   - or the transport branch: build, challenge, revision, completion nonce
     and CSRF token.
4. **Tokens rotate as the owner decided.** Each challenge stores the digest of
   the one nonce that may decide it (`decision_nonce_hash`). The transport
   challenge, completion nonce and CSRF token are stored as digests only, in
   the same transaction that issues them. The mapping requests carry no CSRF
   header, as configure carries none. `api.embryo-ingest-complete` still
   requires it.
5. **Chunks wait for the build.** A `pgt_table` chunk whose build is
   unresolved, whose transport is not issued, or whose locus kind is not
   recorded answers `embryo-ingest-chunk-v1.mappingRequired` (409) before its
   body is read, without marking the attempt.
6. **rsID loci come from the shipped reference.** An rsID-keyed table is
   placed on the build through `data/ref/build-discriminating-sites.json`.
   That is the attributed coordinate reference the repository already holds:
   61,617 autosomal sites. An rsID outside it refuses the chunk closed rather
   than guess a position. A table's own coordinates never pass through it.
7. **The worker reads table fragments.** The `split_cohort_vcf` job keeps its
   name and claims `vcf` and `pgt_table` attempts. A table fragment is
   revalidated by the closed table record rule. It stages called bases with no
   reference or alternate allele. A passing embryo's source is published as
   `embryo-autosomal-source.tsv` of type `pgt_table`. QC, publication, dates
   and cleanup are the VCF's own.

## Readings where the register and decisions were silent

These were chosen to fit the two decisions and the existing register. They
are recorded so a reviewer can overturn any one of them.

- **Where a table "states" a build.** A table has no `##fileformat` line. The
  configure route reads its `##reference=` and `##contig=` preamble lines with
  the VCF header rule. Nothing else in a table is read as build evidence.
- **The configure answer for a table** is a new closed contract,
  `embryo-table-configuration-v1`, with only `nonce`. A table's transport
  comes later, from the mapping route. The text of
  `upload-session-v1.operationNonce` now names configure for a VCF or a table.
- **The mapping POST is always called once for a table,** even when nothing
  needs deciding. This keeps one place that records the locus kind and issues
  the transport.
- **The locus kind is stored as one canonical value** on the session
  (`table_locus`), so the chunk route can apply the same rule without any
  header text.

## Consequences

- Migration `20261016120000_embryo_table_mapping_route.sql` adds the table
  configure, inspect, decide and locus doors, the two digest columns, their
  write-once triggers, the table staging rule and table publication.
  `supabase/tests/embryo_table_mapping_route.sql` covers it. Its production
  release is guarded like every embryo migration.
- Migration `20261016195000_embryo_table_call_hash.sql` lets the call fence
  hash a table call, which has no reference allele. Before it, the fence
  refused every table call at publication, so no table source could publish.
  A reference allele still hashes exactly as before.
  `supabase/tests/embryo_table_call_hash.sql` covers it. Its production
  release is guarded too.
- `docs/route-register.json` gains the table body and answer on configure, the
  three `pgt-mapping-challenge-v1` branches, a 200 decision answer, a
  `tableConfiguration` resolver clause and the table notes on chunks, worker and
  completion. `scripts/route-register-correspondence.test.ts` counts one fewer
  unbuilt entry (26 → 25).
- The upload page asks the column and build questions in the browser.
  `e2e/embryo-ingest-journey.spec.ts` drives a synthetic table through both
  questions to native publication. That journey runs only in the isolated CI
  runtime.
- Nothing changes in production. `EMBRYO_INGEST_AVAILABLE` stays false, and
  every embryo route keeps its jurisdiction gate.
