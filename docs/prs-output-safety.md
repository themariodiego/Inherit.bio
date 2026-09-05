# Score output boundary

The current score engine produces internal partial weighted sums and an
analytic allele-frequency reference. It has no validated personal reference,
uncertainty or applicable absolute-risk model. Complete position coverage is
not evidence that a score is calibrated.

## Current behavior

- `src/lib/genome/prs-output.ts` is the shared chat/export boundary. Queries
  read matched-position counts, not raw scores, z-scores or percentiles.
  Serialization is an explicit allowlist and discards unexpected fields.
- Counts describe positions usable by the calculation, not complete assay
  coverage or risk. Missing or invalid counts and denominators remain null.
- `prs.json` is identified by `manifest.prs_format = coverage-only-v1` and
  retains file provenance, metadata and an unavailable-reference reason.
  Unvalidated numeric scores are deliberately omitted and this is disclosed.
- The migration `20260905195248_prs_coverage_only_api.sql` removes table-wide
  and column SELECT grants from PUBLIC, anon and authenticated. Only
  authenticated identity, matched-count and timestamp reads remain, under
  the existing ownership RLS. Wildcards, hidden-column filters and direct
  numeric reads are rejected. Service-role computation retains its access;
  no source or stored computation is deleted.
- Chat genotype/gene queries also omit legacy rsID-wide clinical labels and
  unbound frequency fields. These are not personal allele-specific evidence.
- No auth, consent, sensitive-report reveal or subject-scope gate is loosened.

## Verification

`src/lib/genome/prs-output.test.ts` exercises the real loader functions with
query doubles: explicit fields and ownership filters, complete/zero/missing
coverage, malformed reference counts, query errors and short-page export
pagination. It also pins both application call sites to those loaders.

`supabase/tests/prs_output_privileges.sql` exercises authenticated owner,
other account, anonymous and service roles against Postgres. The export
browser test plants legacy sentinel numbers, verifies actual REST denial
and coverage access, downloads the ZIP and checks the numbers are absent.

## Remaining science and product work

This correction does not add validated polygenic reports or substantially
broaden the evidence catalog. Required next work remains:

1. Versioned, reviewed source claims: exact variant identity, measured trait,
   comparison, population, effect model, uncertainty and access/review dates.
   Test contradictory studies, duplicate citations and unsupported genotypes.
2. Plain-language thematic takeaways with traceable report links. Test that
   repeated loci and overlapping studies do not become independent evidence;
   no sum of associations or mixed-layer health score is permitted.
3. Callable reference/no-call and quality provenance. Test absent VCF entries
   separately from explicit reference calls, missing calls, filtered calls
   and imputed dosage. Locus/build/strand must be bound before interpretation.
4. A validated score pipeline and applicable reference models. Benchmark
   scoring against published reference outputs; test allele matching,
   missingness, ancestry applicability, uncertainty, calibration and the
   condition-specific high-penetrance suppression contract across every
   subject and every output surface. Ancestry adjustment alone is not proof
   of predictive portability or absolute-risk calibration.
5. Semantic Copilot validation beyond numeral provenance. A coverage count
   must never be repurposed as risk or rank; more adversarial semantic tests
   and reviewed claim-level output generation remain necessary.

The original scientific, legal, access and full-project acceptance gates
remain in force. No acceptance requirement is marked complete by this slice.
