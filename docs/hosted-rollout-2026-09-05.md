# Hosted rollout — 2026-09-05

## Verified deployment and schema parity

At 20:17 UTC, `https://www.inherit.bio/` returned HTTP 200. The Vercel
production alias was READY at main commit
`a4ef677ca7d0fa3deff3651802c0afab62f758e9` (PR 51), deployment
`dpl_FCGxh1Gk9cEAkAU1GM3XEPuRzMHB`. This checks deployment identity and
homepage availability, not authenticated end-to-end acceptance.

The hosted Supabase project is **Inherit**, ref `zuvloczwgrayonqabnss`.
Its migration history stopped at `adult_subject_invitation_runtime` while
production already contained five later migrations. The exact committed
main files below were applied in order through the migration API:

| Committed migration | Recorded hosted version |
| --- | --- |
| `20260903100000_report_taxonomy_and_evidence_rubric.sql` | `20260905201548` |
| `20260903120000_family_sharing_runtime.sql` | `20260905201600` |
| `20260903190000_independent_login_per_account.sql` | `20260905201602` |
| `20260903200000_genome_files_runs_of_homozygosity.sql` | `20260905201604` |
| `20260905103317_embryo_cohort_runtime.sql` | `20260905201607` |

The API records application-time versions; the migration names and SQL were
matched to committed sources. Each call returned success, and a subsequent
history read confirmed all five names. Unmerged ingest chunk/session
migrations were not applied to hosted Inherit.

## Preflight and post-application checks

- Preflight: 151 published report templates, no drafts or PGS-backed
  templates; 40 established, 79 moderate and 32 preliminary labels.
  The evidence enum had only its intended report-template dependency.
- Preflight: no embryo drafts, cohorts, embryo records or print-right rows;
  no existing legal artifacts using the seven new sharing/embryo keys.
  This matters because the migration includes default/backfill semantics.
- Preflight: no transaction older than one minute; report templates occupied
  647,168 bytes. No user genome contents were read or exported for preflight.
- Postflight: 119 emerging and 32 preliminary templates, all estimate /
  single-locus; exactly 119 evidence-relabel changelog rows retained the
  relabel trail. This was a real taxonomy change, not merely additive DDL.
- All six ROH columns exist. Existing uploads were not reprocessed.
- `finalize_embryo_cohort_v1` is executable by service_role, not anon or
  authenticated; the embryo forbidden-column event guard is enabled.
- No ordinary public table has row-level security disabled.
- No uploaded genomes, consent records or user accounts were deleted.
  No full reference seed, application configuration or email change ran.

## Remaining security notices

The hosted security advisor at 20:20 UTC returned **127 INFO, 2 WARN and
0 ERROR** notices. The INFO notices concern RLS-enabled tables without
policies; these include intentionally service-only stores and must not be
opened merely to silence an advisor.

1. [Authenticated SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable):
   `public.job_time_stats(text)` intentionally exposes a timing aggregate,
   with an empty search path, not raw jobs. Its exact count, percentile and
   window contract were compared against the brief and corrected in PR 55
   below. The intentionally callable aggregate may still produce this notice;
   the notice is not treated as proof of a clean or broken implementation.
2. [Leaked-password protection is disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
   No auth setting was changed during schema rollout.

## Acceptance boundary

The full-resolution ledger remains **16 of 65 requirements verified**.
Schema parity and a successful deployment do not verify Family workflows,
embryo ingest/worker/unwind, all upload paths, or human comprehension gates.
Hosted templates still number 151; the 162-template local seed is not proof
that all local content has shipped. The later scoped content rollouts below
cover the existing 151 reports, not the absent 11 Medicines reports.

## Content parity audit

A read-only per-field MD5 comparison against pilot integration commit
`247734f22b969207d7d305ceaef5675a3bdcbe8d` found 33 differing titles,
138 differing summaries, and 275 differing genotype-interpretation strings
across 138 of the 151 hosted templates. These are content drift counts,
not counts of scientific errors. Hashes were computed separately over each
plain string, with interpretations keyed by rsID and genotype; unrelated
timestamps and JSON object ordering cannot create these differences.

The 11 absent local templates are the Medicines single-position reports.
Their absence must not be hidden by a claim of completed deployment. The
existing-template copy drift was subsequently resolved below; full seeding
was not used because it republishes templates and touches reference data.

PR 53 was subsequently verified live: production deployment
`dpl_ALWPFNauzvT8oZwPt8YdmpwFXTPc`, READY at main
`6b254abba490cac024e95f9213250f41f8f0e839`.

## PR 52 and PR 54 rollouts

PR 52 merged after full CI run `33990005379` passed on integrated head
`984b605e5aaaaa168946e34886f6c14ac3083e54`; merge commit
`503b4afc5db9d66980c5097acd7c332111154e0b`.
The exact committed `20260905195248_prs_coverage_only_api.sql` was then
applied through the migration API. Hosted read-back verified RLS remains
enabled and ownership policy unchanged; authenticated table-wide SELECT
is false, all four internal numeric fields are unreadable, matched counts
remain readable, anon has no column SELECT, and service-role computation
can still read its stored numbers. No stored computation was deleted.

PR 54 merged after full CI run `33990146804` passed on
`247734f22b969207d7d305ceaef5675a3bdcbe8d`; merge commit
`a9fbfc6b5aa703a52bf11864cf3025443b71ef03`. Production was subsequently
READY at that merge commit, deployment
`dpl_DeR1Jy7JLwnPiNq5PnmyseRpiLnh`.

At 20:38 UTC, one guarded transaction updated the exact three pilot
templates' citation contexts and the reviewed taste summary/rs1726866
interpretations. It recorded one public correction changelog entry.
Postflight confirmed all three contexts with actual source-read dates,
unchanged emerging labels and original publication dates, and 151 total
templates. Full before/expected-after public-template snapshots and SQL
were archived in the task-owned `study-context-rollout-2026-09-05` directory
outside the repository. A rollback-only test proved exact postimages,
idempotent replay, one history row, and refusal of editorial drift.

## Existing-template copy parity completed

A second guarded transaction published previously merged copy from main
`a9fbfc6b5aa703a52bf11864cf3025443b71ef03` into 149 of the 151 existing
published templates. The other two already matched. This changed only
titles, summaries, genotype interpretation prose, citations and modification
timestamps. Structural variant identity, genotype keys, category, evidence,
layer, score IDs, original publication dates and review/compliance fields
were compared and preserved. No additional template or reference row was
seeded and no user genome or consent record was changed.

The transaction compared exact preimages under non-waiting row locks and
checked complete expected postimages before returning. Local rollback-only
verification covered 151 public-template fixtures, 149 exact updates,
zero-write replay, one changelog row and refusal of concurrent editorial
drift. The preimages, expected rows and SQL are archived in task-owned
`reviewed-copy-rollout-2026-09-05` outside the repository. Hosted postflight
compared all 151 rows' four content fields against committed source JSON:
**151 compared, zero mismatches**. There remain 119 emerging and 32
preliminary labels, three study-context panels, one taste-correction entry
and one copy-publication entry.

This is deployment of reviewed repository copy, not new scientific
validation of every legacy association. The absent Medicines content,
validated polygenic risk and complete upload lifecycles remain separate.

## PR 55 timing correction

PR 55 merged after full CI run `33990743833` passed at head
`1eb4a945e01f9fe2e8a549b5568073448f06ef67`; merge commit
`a2823a6478b8e76c072054f88a3c62a6c2e95329`. Hosted preflight found no
dependent database objects on the function. The exact committed
`20260905202657_job_timing_privacy.sql` was applied through the migration
API, then read back as `TABLE(n_bucket text, p50_seconds integer,
p95_seconds integer)`, with anon execution denied and authenticated/service
execution retained. The empty sample returns only `<20` and two null
percentiles. Root independently repeated the 38 new pgTAP assertions in
the isolated timing database with no failures and rollback.

Production is READY at that merge commit, deployment
`dpl_7R8KKFJzt8LFrVo5Z9qCCqYWEEsS`. The public changelog HTML was also
read back and contains both the taste correction and reviewed-copy
publication entries. This does not replace authenticated browser checks.
No password-protection setting was changed and no extra user-facing gate
was added by the timing correction.

## PR 56 personal report takeaways

PR 56 merged after full CI `33992392637` passed at exact head
`dc2ed7f9a555719d85d96bb1df149131bc7050a5`; merge commit
`3f6050c1912b7dc7b2f4f0e61f0c074e6d0d3b0b`. Production alias
`www.inherit.bio` resolves to READY deployment
`dpl_22PvYJXjp11C2Dr93CGnQyQuNHPe` at that merge, with no alias error.
This code-only rollout uses the three already published study contexts;
no hosted seed, migration, permission change or external genetic-data call
was added. Root's final local production-browser run passed 13 tests with
zero failures, skips or retries, including upload-to-takeaway, filtering,
source details, cross-account absence, report-library and Overview checks.
Production deployment verification is not an authenticated production
genetic-file test.

## PR 57 disabled embryo-ingest foundation

Root verified and applied the four exact migrations reviewed at `cdd6e0a`
to the hosted Inherit project after preflight found zero ingest sessions,
cohorts and fragments. Hosted history records the following versions:

| Migration | Hosted version |
| --- | --- |
| Chunk reservations | `20260905214320` |
| Session lifecycle | `20260905214322` |
| HTTP authorization | `20260905214324` |
| Unwind runtime | `20260905214326` |

Postflight verified 111 registered purge stores, RLS and no client grants
on the new tables, zero client-executable privileged embryo functions, and
the exact 24-hour terminal-contact constraint. No user data or ingest was
added. The foundation remains disabled; this is not ingest enablement and
does not advance the recorded whole-plan count of 16/65.

CI `33993182906` passed 1,578 unit, 712 SQL and 131 browser assertions/tests
with no skips or retries. PR 57 merged at
`d02b7096570407f714716b91e094b8fe74e9c70f`. Production deployment
`dpl_98UNSdFNQ5k9XRaMm3ADve8vHGkc` is READY at that exact SHA, with
`www.inherit.bio` assigned. The homepage returned HTTP 200; anonymous
reports access returned HTTP 307 to sign-in. Error/fatal runtime counts
returned no rows during the brief post-deploy window; that is not long-run
assurance. Advisors reported 131 INFO, two existing WARN and zero ERROR
findings. Existing job-timing and password-setting notes remain unchanged.
