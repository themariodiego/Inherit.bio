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

## PR67: three behavior-report source corrections

Reviewed head `1c2b1c70d67293579a88f4e03cc4269867e1e884` passed full CI
`34003548461`: 1,851 unit tests in 124 files, 812 database assertions in
22 suites, and 142 browser tests with no skips or retries. The three new
browser cases ingest an explicitly synthetic VCF and verify actual report
calls, source context, citation dates and the existing sensitive-result opt-in.
Independent scientific verification and exact source-object hashes are in
`docs/sources/reviews/batch-02/independent-correction-review.md`.

PR67 merged as `1a2f8a494f2d483d1803190ad58380ff67f333ae`.
Production deployment `dpl_mw5CLhiRnxmB6zvdGbH5aVtW5dgb` is READY at that
exact commit, with `inherit.bio` and `www.inherit.bio` verified in its alias
list. The Next.js build took about 32 seconds.

### Exact catalog publication

The following existing public report objects were updated at
`2026-09-06T01:32:47.811873Z`:

- `stress-anxiety-comt-rs4680`: distinguish enzyme findings and the particular
  personality study from an unsupported personal stress or anxiety advantage.
- `mood-stress-resilience-bdnf-rs6265`: distinguish cell experiments from human
  outcomes and explain the older positive review and larger nonconfirmation.
- `problem-substance-use-faah-rs324420`: restore the combined drug-or-alcohol
  questionnaire outcome and avoid unsupported heterozygote or brain-level claims.

All seed fields in the pre-publication objects matched the existing live
catalog before writing. A short, table-locked transaction checks full old
rows, accepts an already-correct new row as a no-write replay, refuses other
drift and verifies full new rows except their changed `updated_at` timestamp.
Only title, summary, interpretations within variants, citations and
`updated_at` change. Slugs, coordinates, genotype keys, evidence levels,
categories, original publication dates and compliance fields remain unchanged.

- Publication SQL SHA256:
  `55a91dc93a8b18245f0209f74c7023302ba8ef262896527ab9e7e840f3c94a9c`.
- Local approved before/after JSON SHA256:
  `ed564176ac6872fdbfe8d913374a3831e50aedebdacc5858f501dcd12cf5f2b9`.
- Independent read-only rollout review by `report_evidence_implementation`
  found no blocking defect on 2026-09-06. This is an agent review, not a
  clinical sign-off.
- Six local SQL checks passed: exact publication, zero-write replay, title
  drift refusal, metadata drift refusal, missing-target refusal and drift
  after publication refusal. Each used a temporary catalog clone and rolled
  back; no public local table was mutated or database reset.
- A separate hosted read verified all three exact new rows and a catalog
  total of 162. The other 159 full rows retained fingerprint
  `47d3bea9ddf35bf787de6e3981464663` before and after.
- All three source files remain. A digest over ID, status, build, variant
  count and processing start/finish timestamps was unchanged:
  `b43e5a371344cb59431833188cf8d856`. No individual file metadata was exported.

No file, account, evidence tier, consent, email queue or changelog row was
modified. These are corrections to existing reports, not new reports,
evidence relabels or withdrawals. No new gate was added to result access.

### Rendered verification and boundaries

After production publication, the existing signed-in library showed the
corrected BDNF title and summary. Following its actual link opened the revised
detail with all three expected PubMed links, three `2026-09-06` source-read
dates and all four study-context fields for each source. The file did not
cover this position; this live check establishes the catalog-to-page path,
not a personal genotype result. No reveal action or file deletion was used.
The three covered-result paths were instead verified using the synthetic
fixture in the full production-build CI browser suite.

A deployment-scoped error/fatal count scan from `2026-09-06T01:32:00Z` through
the immediate checks returned no matching entries. This is only a short
smoke check, not long-term monitoring. Deployment and database skills guided
the bounded rollout; full-story verification kept catalog publication and
actual page rendering separate from a green preview build.

Full-plan acceptance remains **18/65**. The source inventory and registry
validator are foundations, not a complete rendered claim gate; G1.11 and
G4.7 remain unaccepted.
