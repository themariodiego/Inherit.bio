# ADR 0035: Embryo VCF configuration — the server reads the build from the header

- Status: Accepted (owner decision, 28 September 2026); register entries only.
  No route is built.
- Date: 2026-09-28
- Builds on ADR 0020 (embryo ingest) and ADR 0034 (embryo sex and estimates);
  changes neither

## Context

Before any embryo chunk can be sent, the browser needs three things for a VCF:

- the genome build;
- a server-issued transport challenge;
- the challenge's revision.

`src/lib/embryos/vcf-transport.ts` writes these into the regenerated header of
every chunk, and the chunk route checks them. The rules the fix must respect:

- **The browser may not declare the build.** `genome-build-inference-v1`
  forbids an unsolicited client declaration.
- **The writer exists, but nothing can reach it.**
  `private.configure_embryo_ingest_session_v1` records format and build once
  (`docs/embryo-session-configuration.md`). No registered request carries a
  VCF's header-derived build to it.
- **Nothing hands the browser the challenge or its tokens.**
  `cohort-created-v1` deliberately withholds the challenge. No response issues
  the one-time nonces or the CSRF token that the mapping and completion
  requests require.

On 28 September the owner chose that the browser sends the VCF header and the
server works out the build.

## Decision

1. **A new endpoint, `api.embryo-ingest-configure`,** at
   `POST /api/embryo-ingest/[session]/configure`, for VCF only. Laboratory
   tables keep the mapping endpoint and its build challenge.
2. **The request carries only what decides the build.** Its closed body has
   four fields:
   - `format: "vcf"`;
   - `buildEvidence`: the source's `##fileformat`, `##reference` and
     `##contig` lines, verbatim, at most 64 lines of at most 512 characters;
   - `sampleCount`: the number of sample columns;
   - `nonce`.

   Sample names, the `#CHROM` line, `##SAMPLE`, `##PEDIGREE`, `##source` and
   every other meta line are forbidden. They can name people or laboratories,
   and the build does not need them.
3. **The server decides the build, in memory.**
   - It uses only the product parser's header rule
     (`buildFromHeader` in `src/lib/genome/parsers/vcf.ts`).
   - It accepts exactly one of GRCh37 or GRCh38.
   - An absent, conflicting or unknown build is terminal:
     - the attempt is marked failure-pending, and `attemptFailure` is
       dispatched;
     - the response is `build_unknown`, directing to `embryos.request-data`.
   - Position-based inference stays with laboratory tables, as its contract's
     `applicability` says.
   - The submitted lines are zeroized and never persisted, hashed or logged.
4. **The sample count must equal the cohort's immutable embryo count,** and
   that count is at least two. Otherwise:
   - one sample answers `cohort_single_sample`;
   - any other mismatch is the same terminal attempt failure.

   Names are never compared, because they never arrive.
5. **On success, the server does three things:**
   - it records format and build through
     `private.configure_embryo_ingest_session_v1`;
   - it issues one random transport challenge and a random positive revision,
     stored hash-only;
   - it answers with the new `embryo-vcf-transport-v1`.

   That response carries:
   - the build, challenge and revision;
   - the one-time completion nonce;
   - the upload-session-bound `X-Inherit-CSRF` token that
     `api.embryo-ingest-complete` requires.
6. **The first nonce comes with the upload session.** The embryo branch of
   `upload-session-v1` gains `operationNonce`, a one-time nonce for exactly one
   configure or mapping-inspection request, and `configureRoute`. Each later
   nonce arrives in the response it follows.
7. **Order of building.** The owner's decision and ADR 0020 both put the
   Storage write fence, the deletion acknowledgement and the terminal purge
   before any route that accepts embryo bytes. The configure route accepts no
   genotype bytes, but it opens the flow that leads to them. So it is built
   with the chunk and completion routes, after those safeguards.
   Everything stays test-jurisdiction only; production stays off (decision of
   27 September).

## Consequences

- `docs/route-register.json` gains the route, the response contract, the two
  `upload-session-v1` fields and a `vcfConfiguration` clause under
  `policyResolvers.embryo-ingest-session-v1`. `scripts/route-register-correspondence.test.ts`
  counts the route among the registered-but-unbuilt, as it counts the three
  existing ingest endpoints.
- `docs/embryo-session-configuration.md` item 1 is answered for VCF. Tables
  still need their token presentation, which the mapping endpoint's responses
  can carry in the same way.
- Nothing changes at runtime. `EMBRYO_INGEST_AVAILABLE` stays false.
