# Hosted rollout — 2026-09-06

## PR65: result input quality and source attribution

Candidate: `76bb28da321b93b717f5771e61424e2eab7f18d1`.
Full CI: `34001194730` passed: 1,754 units in 121 files, 812 database
assertions in 22 suites, and 139 browser tests with no skips or retries.
PR65 merged as `16c01b71fdda862d9a1fd23153a6f618e2a255a7`.
Production is verified below. G4.6 is accepted; full-plan acceptance is 18/65.
This closes the input-quality requirement, not the embryo workflow or the
validated-polygenic-report requirements.

The original CI `34000286737` passed build, unit, database and policy gates,
but had two browser failures and eight tests not run. Page-wide claim-block
assertions were corrected without removing the original result requirements;
each new quality block is now checked independently. Whole-genome testing also
found and fixed the exclusion of readable unnamed SNPs from input read counts.
The report-matching rsID requirement and original parser outputs are unchanged.
The corrected candidate passes 1,754 units, typecheck, scoped lint and all 12
cases in both affected production-browser suites, without skips or retries.
Independent read-only review found no blocker.

### Additive database rollout

Supabase project: Inherit, `zuvloczwgrayonqabnss`.

- Source migration: `20260905231110_result_input_provenance.sql`.
- Exact SQL SHA256: `effbce2578e9be0d1c63c369d73de52ab8f23a6b188a0036cc4737408cf4b803`.
- Hosted history: `20260906003053`, `result_input_provenance`.
- Applied only after this candidate's full CI database step passed.
- Preflight: zero processing files, zero long transactions and no preexisting
  candidate columns or function. Existing file and catalog fingerprints matched
  the earlier read-only preflight.

Post-DDL verification:

- All three files remain. Status, build, variant count and processing timestamps
  are unchanged: fingerprint `c63eaffb1df68f8a74e10c8b52f2db35` before and after.
- All 162 template rows are unchanged: full-row catalog fingerprint
  `2b6b3be4c5f4bc1e7fea05111992c4ec` before and after.
- The new JSON snapshot, text digest and UUID run token are nullable and NULL
  on every historical file. No backfill or rerun was performed.
- RLS remains enabled. Authenticated INSERT and UPDATE privileges on all three
  columns are false. The guard is an invoker function with an empty search path;
  anon and authenticated EXECUTE are false.
- The trigger is enabled and the completion constraint is validated.
- Hosted security advisors: 132 INFO, two existing WARN, zero ERROR. Warnings
  concern an existing signed-in SECURITY DEFINER capability and disabled leaked
  password protection, not the new invoker guard. These are not claimed fixed.

The migration creates no new data store or retention clock. No real file was
deleted or reprocessed, no genotype was read for deployment verification, and
no email was sent.

### Production and authenticated verification

- Deployment `dpl_9dtafK9XAAtDNYLbSwjbnQVaYUvg` is READY, target production,
  at exact merge SHA `16c01b71fdda862d9a1fd23153a6f618e2a255a7`.
  Its verified alias list contains both `inherit.bio` and `www.inherit.bio`.
- The existing signed-in account's two file rows still expose two Delete
  buttons and two report links after a reload. Neither Delete button was used.
- The library retains 26 covered statistical-estimate links and four covered
  Medicines links when each layer's With results filter is enabled. These
  layers are not summed into a mixed headline.
- Both layers now expose a shared visible source-provenance section. Historical
  files state that read rate and coordinate-conversion facts were not recorded;
  they do not acquire invented measurements. The external/unverified origin
  explanation is present and supported report links remain usable.
- A covered Medicines detail renders all six required headings in order, two
  source records and an attributed quality-coverage figure. The
  provenance section has no details element or hidden content. Historical
  unknowns and the external-origin explanation are present.
- The UI checks collected only availability/count/structure booleans, not
  personal genotypes or raw source content. The signed-in session was reused
  in its existing browser without copying authentication material.
- A deployment-scoped error/fatal log scan from `2026-09-06T00:38:30Z` through
  the immediate checks returned no matching rows. This is a short smoke check,
  not a long-term operational assurance.

### G4.6 acceptance scope

`docs/result-input-provenance.md` inventories all eight result surfaces and
their exact checked/contributing file bindings. Full CI exercises self-upload,
report, browser, ancestry, Family and Portrait contracts. Closed embryo
DTO/loader and actual QC detail/comparison renderer tests prove the additive
source facts; they do not assert that the unfinished embryo writer or consent
journey is enabled. Historical missing source facts remain explicitly unknown,
and independently supported results remain available. No other G gate is
promoted by this release.
