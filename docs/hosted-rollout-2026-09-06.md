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

## PR68: SLC45A2 correction and rendered-claim collection

Reviewed head `a632ac3005bb91cce8f1656491771cc89cc6a7b9` passed complete CI
`34005278651`: 1,983 unit tests in 128 files, 812 database assertions across
22 suites and 142 production-build browser tests, with no skips or retries.
The browser suite completed at `2026-09-06T02:11:41Z`. Existing assertions,
gates and access restrictions were not weakened.

PR68 merged as `7308b0627167bb91043c5e6f369cb7a02606f101`. Production
deployment `dpl_9DeCGjSrcDn2DMPusANZXk16wsy5` is READY at that exact merge,
with both `inherit.bio` and `www.inherit.bio` aliases. Next.js build time was
about 27 seconds, from epoch milliseconds `1788660769603` to `1788660796820`.

### Exact one-report publication

The existing `skin-uv-sensitivity-slc45a2` report was corrected at
`2026-09-06T02:13:45.821783Z`. Only `summary`, `variants`, `citations` and the
transaction-assigned `updated_at` changed. Identity, title, locus, allele
keys, evidence, layer, status, publication dates and access metadata remain
unchanged. This repairs the reversed pigment association; it does not add
an ancestry inference, a heterozygote midpoint or a personal sunlight limit.

The exact template object is bound to SHA-256
`b16d453f7e716a188e107ee1b865c662de570e5d9be507b079afd805f717c6ba` by
`docs/sources/reviews/batch-04/slc45a2-independent-review.md`. That is an
independent agent source review, not human clinical sign-off.

All live seed fields matched the main-branch preimage before publication.
The update used full-row pre/postimages, short lock/statement timeouts,
an exact target count, drift refusal, zero-write replay and bidirectional
comparison of every unrelated catalog row. No custom catalog triggers
were present. Operational publication review by agent
`/root/report_science_coverage` independently approved the package and
reproduced all six temporary-clone checks: exact update, replay, title drift,
metadata drift, missing target and post-publication drift. The local shared
catalog had 163 rows; those tests preserved all 162 unrelated local rows.
They did not reset or mutate any public local table.

Publication SQL SHA-256:
`8a1856dae00a121d95f63fc4a2efef78b8b4c0e0e1d196b6a84a22b1002ffebb`.
Approved full-row JSON SHA-256:
`0355598e5680555faec76598aac76b6f2e27e161ee5bd9512cbcfe1c71eb4fe7`.

Fresh hosted readback proved the complete postimage (excluding its assigned
update timestamp). Hosted catalog count remained 162. The full-row fingerprint
of the other 161 reports remained `10d8a8e4aa11ae7b5497104f4e53d6cf`.
The existing all-file processing-state fingerprint remained
`b43e5a371344cb59431833188cf8d856`, using the same file-field formula above.
No user file, genotype, account, consent, mail or historical publication was
changed. No new-report/evidence-relabel changelog event was invented for
this ordinary correction.

### Actual rendered verification

The existing signed-in report library located the SLC45A2 report after
turning off the results-only filter; it was not among that account's covered
results. Its actual report link loaded the detail page with heading
“Skin response to UV light”. A read-only DOM check confirmed the complete
approved public summary verbatim, all three PMID links (29974532, 18483556,
32966160), three source dates of `2026-09-06` and all four study-context labels
for each source. No personal genotype was exported or exposed for this check.

The deployment-scoped error/fatal count scan from `2026-09-06T02:13:16Z`
through `2026-09-06T02:14:57Z` returned no entries. This is a bounded smoke
check, not a first-hour or long-term monitoring claim. Database, deployment
and verification skills guided the exact-row publication and separate live
rendered check; no telemetry service was added.

Full-plan acceptance remains **18/65**. Actual DOM collection and independent
capture planning are merged, but canonical content population, production
claim wrapping, complete renderer integration and the final claims gate
remain unfinished. No acceptance credit is added by this release receipt.

## PR69 — source-linked report explanations

PR69 (`https://github.com/themariodiego/Inherit.bio/pull/69`) merged reviewed
head `8cbece97a1a9a66fbc4953eafc60c180889b2677` as
`bcfa35cb9be5691b7f7e99290dd91f6c4e3e86f8` on 2026-09-06.
Complete CI `34007333353` passed 2,017 unit tests in 132 files, 812 database
assertions in 22 suites, and 143 browser cases. The runner explicitly reported
no browser skips or retries; browser execution took 6.7 minutes. No existing
reveal/leak assertion was weakened.

Production deployment `dpl_2oJGbPYJ5eXDjw91ErfPd9rEQBKU` is READY at that
exact merge on both `inherit.bio` and `www.inherit.bio`. It built from epoch
milliseconds `1788663514046` to `1788663542012` (about 28 seconds).
The deployment URL is `inherit-f92hiwp8q-mariodiego.vercel.app`.

The preview deployment was READY but its `/science` request returned HTTP 500.
Its runtime logs identify missing Supabase URL/key configuration in middleware,
before page rendering. Preview credentials were not populated or copied from
production. Preview build success is therefore not claimed as a working preview
flow. The full production-build browser suite and the separate live checks
below provide the actual renderer verification.

### Live report-to-source navigation

Using the existing signed-in browser session, a read-only check of the four
report detail routes inspected only public explanation registration and source
links, never personal result text or genotypes:

| Report | Registered paragraphs | Reference links |
| --- | ---: | ---: |
| COMT | 9 | 10 |
| BDNF | 12 | 14 |
| FAAH | 5 | 6 |
| SLC45A2 | 13 | 16 |

All four summaries were registered, all 46 reference links had exactly one
target, and every page linked to `/science#sources`. The complete set of 39
observed claim IDs matched the reviewed four-report scope. Exact-text matching
in the production renderer prevents changed hosted prose from borrowing these
canonical citations.

Clicking SLC45A2's `Source 4` reached
`#claim-source-dataset:ensembl-vep-rs16891982`; its source record appeared at
163.25 pixels from the viewport top with the official Ensembl URL and source
date `2026-09-06`. Clicking `About these sources` reached `/science#sources`.
The actual Science page displayed all 11 canonical sources with their exact
URLs and dates, and the explicit four-report/not-complete-catalog scope.
A public-page screenshot was visually checked in the existing dark theme.

The deployment-scoped error/fatal count check over
`2026-09-06T02:59:02Z` through approximately `03:00:47Z` returned no entries.
This is a short smoke-check interval, not sustained monitoring. No source
catalog publication, schema change, real file deletion/reprocessing, consent
change, credential export or email send was required by this release.

The Next.js and deployment skills guided server-rendered integration,
commit-bound CI/deployment checks and separate hosted verification. Browser
verification used the connected browser because the browser CLI was absent.
The investigation skill identified the preview configuration failure; it was
not treated as a passed renderer check.

Whole-plan acceptance remains **18/65**. The canonical four-report renderer and
real email capture adapter are delivered; full catalog/source migration,
all-channel claim coverage, validated polygenic risk results and the remaining
Family/Embryo, legal, privacy and usability requirements are not complete.

## PR70 — Copilot output assertions and exact stream assembly

PR70 merged reviewed head `bd830695e307f32a975cfa0733ff25878d5dbae1`
as `f8c43bb7ffac3dec1233ffc7f86c8ebf3c11381c`.
Complete CI `34009298500` finished successfully at 2026-09-06T03:48:17Z:
**2,086 unit tests in 133 files, 812 database assertions in 22 suites,
and 207 browser cases**. Browser time was 9.8 minutes; the runner explicitly
confirmed no skips and no retries. This includes all 64 new completion cases,
the final usability corrections, and the unchanged earlier refusal tests.
The superseded-head CI run was cancelled, not counted as passing evidence.
Post-merge main CI `34009931957` also completed successfully at the exact
merge SHA (rechecked during the invitation-flow implementation).

Production `dpl_HEGnV6PunNctYfGh7Voi9VMsT5VG`
(`inherit-4w57kk9ap-mariodiego.vercel.app`) is READY at the exact merge.
Both `inherit.bio` and `www.inherit.bio` are aliases of that deployment.
Build start/ready milliseconds are `1788666534992` / `1788666562501`
(27.5 seconds).

Hosted smoke checks:

- Both public domains return HTTP 200 for `/auth/sign-in`.
- The existing authenticated browser session loads `/copilot/me`, showing
  the subject-scoped heading and the no-provider setup instructions. No
  provider was configured and no model request was made.
- An unauthenticated `POST /api/chat` with an empty messages array returns
  HTTP 401, the plain Unauthorized body, private/no-store caching,
  no-sniff, no-framing and same-origin referrer protections.
- The error/fatal count query after more than a minute from READY returned
  no matching entries for 03:49:22–03:50:44 UTC. This is a short smoke window,
  not long-running monitoring or proof of a live model conversation.

Preview `dpl_DWe2zzrd35w6s3DDvNc9uKmLHp2T` builds READY but still returns
500 on sign-in. Its middleware logs explicitly identify missing Supabase
URL/key configuration. This repeats PR69's preview-environment gap, not a
passed preview flow. Production credentials were not copied into preview.

D-095 is repaired in the shipped self/adult chat path. The actual route now
checks model-authored assertions, preserves legitimate conditional and
uncertainty explanations, and reconstructs each streamed text part without
inserting whitespace inside its tokens. Existing refusal strings replace
the whole answer and all tool parts when a check fails. These deterministic
regressions do not prove detection of every natural-language paraphrase.

Whole-plan acceptance remains **18/65**. G4.8 remains NO: the complete A.9
80-case evaluation, family/cohort tools and inherited scope flows, and live
release evaluation are still required. The source-linked report and email
work does not acquire further acceptance credit from this release.

The AI SDK and Next.js guidance informed message assembly; deployment and
observability guidance informed exact-revision and post-READY checks.
No hosted schema/data mutation, real-user file operation, credential export,
real email, new telemetry integration or genome-bearing model call occurred.

## PR71 — invitation review, refusal, notices and cleanup

PR71 merged at `2026-09-06T07:23:36Z` as
`e9778f8d5e5847deeb5b3d057f7c25ba67b418da`. The exact reviewed head was
`98ee24bd938b0a9475b529c1cea544008a7170a0`; full CI `34018132773` passed:
2,202 unit tests in 139 files, 1,044 database assertions in 30 suites,
30 independent-session lock checks, and 213 browser cases without skips or
retries. Main integration run `34019023140` also completed successfully,
confirmed through the run API on 2026-09-06.

### Hosted schema and preservation

The six SQL files were read from that exact Git revision and applied in order
to Inherit (`zuvloczwgrayonqabnss`). The hosted tool assigns its own versions:

| Canonical migration | Hosted version |
| --- | --- |
| `20260906045637_rights_invitation_binding` | `20260906071746` |
| `20260906051253_invitation_refusal_transaction` | `20260906071749` |
| `20260906053451_invitation_terminal_mail` | `20260906071751` |
| `20260906055142_refused_invitation_draft_cleanup` | `20260906071753` |
| `20260906061029_invitation_transition_guards` | `20260906071755` |
| `20260906064136_refused_evidence_write_fence` | `20260906071757` |

Every migration returned success; the hosted ledger confirms all six.
Read-only comparison found all 45 changed function bodies, identity arguments,
security modes, search paths and role privileges equal to the tested local
database. None is executable by anon or authenticated. The private refusal
implementation remains unavailable to service_role; its public facade calls
the bounded private authority wrapper.

The terminal notice table has RLS and no direct read grant for anon,
authenticated or service_role. All 13 statement locks and 13 row fences are
enabled. The receipt shape constraint is validated. The notice store occupies
slot 8 of its declared target; the complete store register has 113 entries.
No terminal notice row was created by the rollout.

Before and after: three genome files, two subjects, two accounts, and 162
published templates. Full genome-file row fingerprint remains
`7fe71092052ae3cd2a9c0de735f574db`; published-template full-row fingerprint
remains `f7fa3f9ccbc9fd54c715fbadaef2f6a7`. These are sorted JSON-row MD5
comparison receipts, not genetic file content hashes. No real genome was
deleted or reprocessed, and no real invitation or mail fixture was created.

Security advisors returned 133 informational RLS-without-policy notices and
two warnings: the existing authenticated `job_time_stats` definer and disabled
leaked-password protection. No changed function appears in that warning set.
The new private notice table's no-policy entry is intentional: bounded
privileged functions mediate access. This is not a claim that the whole project
has no security warnings. References: [function execution advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
[RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

### Production verification

Deployment `dpl_23r8rERkNjnPmUeaF9GZAzWgngc6`,
`inherit-4wwvjbf2m-mariodiego.vercel.app`, is production READY at the exact
merge; `inherit.bio` and `www.inherit.bio` are both assigned, with no alias
error. The build took about 46 seconds. It was built from main with production
configuration, not promoted from the unverified preview environment.

Fresh signed-out Chromium contexts checked both public domains at 390px:
entry GET 200; invalid fragment cleared; Continue disabled; explanatory link
status present; no horizontal overflow or page errors; no-store, no-referrer
and restricted CSP headers; HEAD 200 without a cookie; malformed refusal 404;
session without rights 404. There was no real token in these requests.

The post-READY error/fatal runtime count query returned no rows for this exact
production deployment. This is a short smoke-check interval, not sustained
monitoring. Valid acceptance, refusal, notice delivery and physical cleanup
are covered by synthetic production-build CI tests with a loopback mail
provider; they were not repeated on real production invitations or genomes.

Whole-plan acceptance stays **18/65**. G5.4 is still NO: active-key rotation,
quotas, the adult URL-token migration, future-person routes and the complete
rights-purpose contract remain unfinished. Real-jurisdiction acceptance is
still disabled. Supabase and deployment guidance informed the role checks,
schema-first rollout and exact-revision verification; browser verification
used the installed repository Playwright setup because agent-browser was not
installed. No credentials were copied or new telemetry integration added.
