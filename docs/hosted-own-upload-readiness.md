# Hosted own-upload rollout prerequisites

## Current checkpoint: PR79 public own-upload verified; WGS streaming remains local · 8 September 2026

PR79 merged as **`1697723b2909800de380f0fadb8f8afa14555777`**. Production
`dpl_8Y1uzqwrLUj9g7THzC1UrEjaWmug` became READY at **13:11:40.297 UTC** on all
six aliases. Persistent production settings are
`INHERIT_CANONICAL_UPLOADS_PAUSED=false`, `INHERIT_PAUSE_LEGACY_UPLOADS=true`
and `INHERIT_NORMALIZATION_DIRECT_DATABASE=true`. Canonical admission is enabled;
legacy issuance remains paused. Verified caps are **24 MiB raw/decoded per file,
128 MiB per account and two active uploads**.

CI **`34228275512`** passed **3,261 units across 203 files, 83 fresh migrations,
2,049 SQL assertions across 55 files, 30 independent lock checks and 232 browser
cases in 15.0 minutes**, zero skips/retries.

The genuinely abandoned upload's scheduled phase completed at
**12:58:20.741655 UTC**, **50.367195 seconds** after real lease expiry at
12:57:30.374460 UTC. Its original fixed deadline, **14:27:30.374461 UTC**, was
unchanged. The manifest is complete and exact Storage/session/staging residuals
are zero. This is actual scheduled removal, separate from the previously proved
21.430137-second scheduled derivative retry and the synchronous fast path.

A fresh **native public upload** prepared **425 bytes / five variants** at
**13:12:34.326917 UTC**, with **zero analyses initially**. Only the traits choice
was enabled and generated. The native bitter-taste report showed `rs1726866`
**A/A** and correctly stated **one of two positions covered**, with `rs713598`
missing. Authenticated application download returned exactly 425 bytes and
SHA-256 `3a7d4c51e5fea9a241909c24f83433b601289ad3f032128c87c6dd229128b361`.
Real application DELETE returned **204 at 13:17:27 UTC**; independent checks at
**13:18:46 UTC** found file, variants, observations, analysis, normalization and
Storage-ledger counts zero while preserving the account. **No native JavaScript
confirmation-button success is claimed** for deletion.

Receipts: parent task `work/current-retention-release/production-pr79/`, including
`deployment.json`, `ci.json`, `ordinary-capacity-applied.json`,
`abandoned-scheduled-phase.json`, `abandoned-scheduled-result.json`,
`public-prepared.json`, `public-download-and-deletion.json` and
`public-deletion-residuals.json`. Earlier checkpoints remain historical evidence
and are superseded only for current production/pending status.

The next WGS streaming implementation is **local, unreleased work**: 79 focused
TypeScript/helper/parser tests and 108 SQL assertions pass, but there is **no
actual VCF-capacity/browser proof or hosted migration** for it yet. Do not
attribute it to PR79 or infer full WGS support from the current synthetic cases.
Approved scope remains existing full-size WGS results first, then raw
FASTQ/BAM/CRAM, targeting **100 genomes/month** and **one-month originals**.
Those workload/retention targets are not enabled; **no additional spending is
authorized**. Whole-plan acceptance remains **19/65**.

## Earlier checkpoint: PR78 deployed; staging cleanup proof was pending · 8 September 2026

PR78 merged as **`4f925509e9980d376d313e88e9dd4ba9614091d5`**. Production
`dpl_3Zry7EHxbTj1k8mam2GYNb16NvPs` became READY at **12:32:04.915 UTC**.
CI **`34224538704`** passed **3,261 unit tests, 82 fresh migrations, 2,041 SQL
assertions across 55 files, 30 independent lock checks and 232 browser cases**,
with zero skips/retries. **New uploads remain paused.**

The actual scheduled retry fault proof completed exact synthetic derivative
cleanup in **21.430137 seconds**, within the immutable 60-second deadline:
revocation at 12:13:20.476012 UTC, completion at 12:13:41.906149 UTC,
`completedWithinDeadline: true`, four deleted manifest members and zero
exact-grant residuals. The original source remained available during that purge.
The source was subsequently deleted separately; the 12:19:03 UTC independent
check found file, variant, observation, analysis, normalization and Storage
residuals zero, with the test account preserved. This is scheduler-owned retry
proof, distinct from the earlier 69.557 ms synchronous revocation. It does not
establish every derivative scope or all retention deadlines.

The compatible staging-retention correction was applied at **12:46:27 UTC**
(hosted version `20260908124627`), with owner, ACL and security settings
unchanged. Its source fingerprint matches the reviewed migration. PR79 remains
unmerged: CI `34227457189` exposed an older account-deletion fixture that moved
only the deadline while leaving the upload lease live. The fixture now expires
only that synthetic lease, preserves its fixed deadline and every assertion,
and passes **98 focused SQL checks** across account deletion, upload retention
and finalization. Full CI must pass again before merge.
A real abandoned synthetic upload was issued at **12:27:30.374461 UTC**, with
lease expiry **12:57:30.37446 UTC** and original fixed cleanup deadline
**14:27:30.374461 UTC**. It received actual Storage bytes but was neither
finalized nor processed. **Actual scheduled removal is still awaited**; do not
claim a completed cleanup or move the original deadline while waiting.

Evidence is retained in parent task
`work/current-retention-release/production-594e885/scheduled-fallback-completion.json`,
`scheduled-fallback-residuals.json`, `scheduled-proof-source-deletion-residuals.json`
and `work/current-retention-release/abandoned-synthetic-upload-receipt.json`.
Earlier checkpoints below remain historical evidence and are superseded only
for current production/pending status. The explicit Family-withdrawal issue
concerned **complete chat turns and their dependent history after explicit
withdrawal**, not Portrait-result deletion; global pause remains deliberately
non-destructive.

Full-plan acceptance remains **19/65**. Approved next scope remains full-size
existing WGS results first, then raw FASTQ/BAM/CRAM, targeting **100 genomes per
month** and **one-month original retention**, with **no additional spending
authorized**. Those targets are not enabled formats or verified throughput.

## Earlier checkpoint: PR76 merged and deployed with new uploads paused · 8 September 2026

PR76 merged at **11:14:32 UTC** as
`594e885cf94f087d4010db6795c035149ec880a5`. Its tree is byte-identical to the
verified `9f079ba` source. Production deployment
`dpl_HJCAo11MiZ7yMXVrFPRb5De7vTBM` became READY at **11:15:31 UTC** and owns all
six public/project aliases, including `inherit.bio` and the main-branch alias.
**New canonical uploads remain paused.** Native production inspection confirmed
the retained synthetic file is prepared with one million variants and its report
listing and source-backed A/C detail with 1/1 coverage are correct; this does not
prove that new public upload admission is enabled.

Final-head CI `34217097810` passed at 11:06:05 UTC: **3,261 unit tests, 81 fresh
migrations, 2,008 SQL assertions, 30 independent lock checks and 232 browser
tests**, with 57 actual local Storage uploads, zero skips/retries and cleanup
passing.

The coordinated transport-policy cutover is installed as **`20260908111349`**.
Postflight confirms the legacy upload policy is absent, zero live legacy leases
and completion windows remain, and canonical policy/role/guard metadata is
unchanged: fingerprint `9bfa8a0e952a44c3baf5e795bcfc31ec`.
The protected-canary evidence at `9f079ba` records preparation of the retained
24,562,693-byte source in 91.496421 seconds, then produced the explicitly chosen
polygenic A/C result and a native original download with the exact expected hash.
**Synthetic source deletion passed through the real production API:** HTTP 204
at **11:46:30 UTC** for source `7011928e-9c9d-47c5-82b4-72ebd1e5d844`.
Independent checks at **11:46:54 UTC** found the source, one million variants,
results and Storage object absent while preserving the account. The native
browser confirmation button was not proved; this is API deletion plus residual
verification, not a native-button success claim.

The manual production retention GET at **11:36:11 UTC** returned HTTP 200 with
**processed 3 / failed 0 / pending 0**, covering two known synthetic expired
upload sessions and one historical synthetic grant-replacement cleanup. Exact
residuals are zero. The old overdue job records `completedWithinDeadline: false`;
late cleanup does not retroactively satisfy its original deadline.

The bounded database-only `pg_cron` purge job was installed inactive at
**11:51 UTC**, activated at **11:58 UTC**, and observed completing **15 consecutive
successful runs at 15-second intervals through 12:01:56 UTC**. This establishes
scheduled execution, not ownership of a particular purge. A separate native
production revocation of the 425-byte synthetic source
`b320380a-c803-4b70-8e70-2021be0fb4de` started at **12:01:26.470879 UTC** and
completed at **12:01:26.540436 UTC** (**69.557 ms**). Manifest
`8c20a9a4-049a-4de5-b1a1-e38507884b78` records four deleted members and zero
exact-grant residuals. **That is the synchronous fast path, not scheduler-owned
purge proof.** The minute composite cron addition is committed at `c2b` but is
**not deployed**. It is separate from the active database-only job; complete
scheduled cleanup and deadline coverage are not yet established.

Independent review also found that explicit Family withdrawal could leave
paired assistant answers and dependent chat history behind. The follow-up fix
passes 33 focused SQL assertions and a two-session writer/purge check; integration
and hosted verification remain pending. Generic Family purge-job verification
remains a separate open requirement. Global sharing pause is deliberately non-destructive and must not
be described as requiring deletion. New uploads remain paused; neither the
scheduler run count nor the synchronous smoke closes all release prerequisites.

Evidence: parent task `work/production-upload-cutover/canonical-merged-deployment.json`,
`work/production-upload-cutover/cutover-postflight-receipt.json`, and
`work/hosted-capacity-20260908/ca-normalization-success.json` /
`ca-native-download-receipt.json`; retention evidence is under
`work/current-retention-release/production-594e885/`, including
`manual-invocation-receipt.json` and `scheduler-activation-result.json`. Earlier failure and recovery checkpoints below
are preserved as historical evidence; this dated checkpoint supersedes their
production/pending status.

The owner's next approved scope is ordinary full-size existing WGS result files
first, then raw FASTQ/BAM/CRAM processing, targeting **100 genomes per month** and
**one-month retention of originals**. Those targets are not verified capacity or
enabled raw-format support. Format/compute/lifecycle contracts still need the
corresponding implementation and proof. **No additional spending is authorized.**
Full-plan acceptance remains **19/65**.

## Earlier checkpoint: local recovery passed; hosted certificate configuration was pending

Exact `9ef7fca` CI `34214992453` passed: **3,247 unit tests, 81 migrations,
2,008 SQL assertions, 30 independent lock checks and 232 browser cases** with
57 actual Storage uploads, no skips/retries and successful cleanup.
The separate actual-browser recovery also passed on that exact build: the
retained million-row source produced its A/C finding and original hash, a new
tiny A/A source proved result/deletion isolation, and both sources reached zero
file/derivative/Storage residuals. The 15.0-second recovery case includes only
one new tiny upload, not a new million-row upload. Earlier preparation at
`848a834` took 49.753 seconds; its initial report timeout remains recorded.

The query-only locus lookup migration is installed hosted as `20260908102804`.
Its body fingerprint, owner, ACL and search path match local; 65 focused SQL
assertions passed. The historical bad query plan was not reproduced after
statistics refreshed. Security advisors remain the existing 138 informational
findings and two warnings; this is not a claim of an entirely clean advisor list.

Hosted direct completion first failed to resolve the existing database route
(`ENOTFOUND`), then reached the verified shared pooler but failed certificate
validation (`SELF_SIGNED_CERT_IN_CHAIN`). Neither attempt published variants;
the synthetic original is retained and temporary capacity limits restored.
The existing database password and environment scopes were preserved while its
route changed to the project's dashboard-provided IPv4 shared pooler. Supabase's
public CA was obtained from its dashboard download link and independently
verified against that pooler's hostname using TLS 1.3, without credentials or SQL.

The adapter now accepts an optional `INHERIT_NORMALIZATION_DATABASE_CA_CERT`
containing one public PEM CA certificate. It preserves hostname verification,
`rejectUnauthorized: true`, project binding and all transaction/deadline guards.
Malformed/non-CA/bundled values fail closed; the setting affects only this hosted
database connection. Unset retains platform roots; flag-off retains REST.
**109 focused tests pass; fresh final CI and hosted completion are pending.**
Set the public CA from the provider's trusted dashboard, never from an unverified
peer; do not disable certificate verification. This public trust anchor has been
registered for future canary/Production deployments; current Production remains
PR77. Evidence is in the parent task's `work/hosted-capacity-20260908/`,
`work/report-capacity-20260908/` and `work/ci-9ef7fca/`.

New admission remains subject to the controlled legacy pause/drain/policy cutover
and verified recurring cleanup. Acceptance remains **19/65**; WGS workload and
retention targets below remain follow-up scope.


## Current checkpoint: direct-completion binding fix pending · 8 September 2026

The first local browser attempt with the opt-in direct-database completion
adapter at `7605b0b` returned **503 after 18.222 seconds** during preparation.
The original synthetic source is preserved with **zero published variant rows**.
The failed receipt is retained in parent task
`work/canonical-family-runtime-adapter/direct-capacity/`; the test namespace was
restored and owned listeners closed. This is a failed new-adapter application
journey, separate from the earlier successful REST/local-SQL capacity cases.

A read-only, rollback-only probe using the actual `postgres` **3.4.9** driver
confirmed the binding defect: interpolating `JSON.stringify(payload)` into the
JSONB parameter produces a JSON **string**, while `tx.json(payload)` produces
the required JSON **object**, preserving its count and nested fields. The probe
passed at 09:59:21 UTC and changed no upload or completion state. Evidence:
parent task `work/hosted-capacity-20260908/direct-json-binding-receipt.json`.
The adapter correction and a fresh actual-browser run are **pending**; the
standalone driver probe is not proof of successful application completion.
The previous hosted statement-timeout evidence below remains unresolved.

The owner prioritizes merging PR76 after the current completion defect is
resolved. Next scope is full-size existing WGS result files first, then raw
FASTQ/BAM/CRAM processing, targeting **100 genomes per month** and **one-month
retention of original source files**. These are newly approved scope/workload
targets, not current accepted raw formats or demonstrated capacity. Update the
affected format, compute and retention contracts before enabling those paths;
do not silently replace existing lifecycle obligations. There is **no new
spending authorization**: any capacity or compute beyond verified existing
allowances requires a separate cost decision. Production remains PR77 and
full-plan acceptance remains **19/65**.



## Current checkpoint: hosted capacity still blocked · 09:25 UTC, 8 September 2026

Exact `0d05e1c` CI `34206586233` is green: **3,190 unit tests, 1,989 SQL
assertions across 53 files, 30 independent lock checks and 232 browser cases**,
with 57 actual local Storage uploads and no skips or retries. This verifies the
integrated local runtime and database chain, not hosted throughput.

The separate local format-capacity journey also passes at a temporary **24 MiB
raw/decoded format ceiling**, 128 MiB account allowance and one active upload.
Plain VCF (25,165,789 bytes) and its gzip representation (1,444,064 bytes) each
prepare exactly **541,341 variants and one observation**, in 27.363 and 26.225
seconds. Both have zero analysis runs before choice. Only the older plain source
is then selected: its exact-source report shows A/C, while the newer unselected
source shows no result. Raw over-limit issuance and gzip decoded-over-limit
finalization both refuse with 413; rejected bytes are cleaned without changing
the two valid sources. Native downloads match each original's bytes/hash.
Deleting the older source preserves the newer source's exact metadata, rows and
download; deleting the newer source then leaves zero scoped source/derivative
rows and objects. Three actual Storage uploads, zero skips/retries. Temporary
local limits were restored and owned app listeners were absent afterward.

Sampled Docker container memory peaked at 537.8 MiB for the app and 354.2 MiB for
the database. These are sampled container figures, not exact process peaks.
The positive decoded input is 35 bytes below the ceiling; the negative input is
12 bytes above. This is one serial synthetic SNP workload with only one
rsID-backed observation per source, not WGS, a large observation-table test,
concurrency evidence or proof of all permitted file sizes. Receipts and the
independent summaries are in parent task
`work/canonical-family-runtime-adapter/format-capacity/`.

The exact capacity migration was then installed on the hosted project at
**09:19:26 UTC**, recorded version `20260908091926`, with source SHA-256
`90ce86a71ae119264910d908d8d58309d692226f4d7f4e2d56e393894f7d5057`.
The intended normalization function settings and execution privileges were
verified; the service-only wrapper has the 45-second statement budget. See
parent task `work/production-upload-cutover/hosted-capacity-migration-receipt.json`.

Despite that change, the protected `f0ab225` canary's **24,562,693-byte,
one-million-row synthetic array failed hosted normalization**. Storage upload
and finalization succeeded; preparation returned 503, and the database recorded
a statement timeout at **09:23:52.020 UTC**, log ID
`407db189-0f62-46f7-bf4f-10f56f4770f0`. Exact source
`7011928e-9c9d-47c5-82b4-72ebd1e5d844` remains retained for diagnosis, with
**zero published variants and zero remaining staged batches**. No chosen
reports or ready mail were generated in this attempt; no successful hosted
preparation, report or deletion outcome is claimed for it.

Temporary hosted limits were restored at **09:25:09 UTC** to 64 KiB per file,
256 KiB per account and two active uploads. The checkpoint and failure receipt
are preserved in parent task `work/hosted-capacity-20260908/`. Diagnose the
hosted statement bottleneck before another attempt; local success does not
justify raising the public cap. Production remains **PR77 (`3c59ac1`)**,
full-plan acceptance remains **19/65**, and useful hosted capacity remains a
release blocker alongside recurring cleanup and the coordinated cutover.


## Realistic-size local journey verified · 8 September 2026

Migration `20260908083349_own_normalization_capacity_budget.sql` resolves the
measured database timeout below. It avoids a redundant subject lookup for each
autosomal row and gives only the service-only normalization RPC a 45-second
statement budget. The five-minute processing claim is unchanged. Publication
now rechecks exact store authority and refuses completion if its lease, session
or consent expires during the bulk save or final metadata cleanup. All 82
focused SQL assertions pass, including three expiry-during-insert regressions;
the local security advisor reports no issues before or after the change.

One real-browser case with one actual Storage upload passes without skips or
retries: **24,562,693 bytes, one million distinct mapped synthetic array rows**.
The native preparation request returned 200 in **47.710 seconds**. Before report
choice there were exactly one million canonical rows, no analysis run or ready
notice, and no remaining staged batches. Explicit polygenic choice produced the
exact-source caffeine A/C finding; the original native download matched the
entire byte count and SHA-256. Actual UI deletion returned 204 and independent
checks found zero source, variants, observations, batches, normalization/analysis
journals, Storage manifests and final objects for that source. The complete
journey took **75.591 seconds**. The mail tombstone remains correctly; no global
mail worker or hosted email was sent for this local case.

Evidence: parent task `work/canonical-family-runtime-adapter/capacity/` contains
the fixed recipe, local migration binding, receipt, browser report and resource
samples. It reuses the pinned production build whose upload runtime is unchanged
from `4c6312c`, against the reviewed local SQL migration. The failed baseline and
an explicitly interrupted test-discovery attempt remain separately preserved;
the runner now asserts exactly one discovered case before starting a provider.
The interrupted attempt's synthetic prepared source and the baseline failed
source remain local investigation fixtures; neither is a public user file.

This establishes one realistic-size **local array journey**, not a public limit
or hosted/concurrent processing guarantee. The subsequent bounded local VCF/gzip
pass and hosted timeout are recorded in the current checkpoint above. Production
remains PR77. Useful hosted capacity, reviewed recurring cleanup and the legacy
pause/drain/transport-policy cutover still block the canonical public release.
Full-plan acceptance remains **19/65**.

## Realistic-size capacity failure · 08:30 UTC, 8 September 2026

Exact integrated `4c6312c` CI `34202744965` passed 3,190 units, 1,944 SQL
assertions, 30 lock checks and 232 browser cases, with 57 actual Storage uploads
and no skips/retries. A separate local capacity case then uploaded one
24,562,693-byte synthetic GRCh37 array with one million distinct mapped rows.
Actual Storage transfer and finalization passed; source preparation returned
503 after 26.127 seconds. PostgreSQL logged a statement timeout. The service
role inherited the authenticator's eight-second statement limit, and the bulk
canonical-row transaction rolled back. No report generation or deletion pass
is claimed. The original synthetic source remains intact, with zero visible
variants, batches or analyses; no normalization query remains active.

The original fixture, complete failed-attempt receipts and resource samples are
preserved in parent task `work/canonical-family-capacity-attempts/attempt-1-default-timeout/`.
The app container's sampled memory peaked at about 704 MiB; host disk stayed
above 3.99 GiB. These samples are not a true per-process peak measurement.
No hosted limits, deployments, schedules or real genetic files changed.
Resolve this measured failure and rerun the actual journey before adopting a
public capacity limit. Full-plan acceptance remains **19/65**.

## Hosted own-file journey completed · 8 September 2026

The protected `f0ab225` canary completed the actual browser journey for
`inherit-test@plus.bio`: one 425-byte synthetic GRCh38 file, five usable calls,
one chosen polygenic report purpose, and an exact-source lactase finding A/G.
The other report purposes stayed off. The catalog contains 151 captured reports;
the UI reports seven covered entries, not 151 personal findings or calculated risks.

The application queued one canonical ready notice. The existing production
mail scheduler accepted it once; Resend recorded delivery and the actual Zoho
inbox received it. Clicking that message's link reached authenticated Reports
and the saved-source finding. No direct provider send or manual global worker ran.
Withdrawal completed the exact-grant purge in about 0.1 seconds, before its
60-second deadline; the old result URL returned 404. Original downloads before
and after withdrawal both matched all 425 bytes and SHA-256
`3a7d4c51e5fea9a241909c24f83433b601289ad3f032128c87c6dd229128b361`.

Actual UI deletion removed the sole synthetic source. At 07:50:32 UTC, SELECT-only
checks found zero source, variant, observation, normalization, analysis, ancestry,
file-worker, pending-deletion, ledger and staging/final Storage rows for its exact
IDs. The revoked grant, completed purge audit and consumed upload tombstone with
null final-file reference remain correctly. The same notice stays delivered with
one attempt and its original expiry. No raw-locus browser check is claimed here.

Evidence: parent task `work/current-canary-notice-resume/02-prepared-receipt.json`
through `09-deletion-receipt.json`, actual result screenshot and two downloaded
fixtures. Independent review confirms consistent source/grant/mail/purge bindings.
The earlier file-permission and Mac-lock holds are resolved. Current integrated
`fa26e1a` CI `34170049395` passes 3,190 units, 1,944 SQL assertions, 30 lock checks
and 232 browser tests, with 57 actual local Storage uploads and no skips/retries.
PR77 post-merge CI `34169600502` also passes all 220 browser cases.

This is protected hosted evidence, not a public release. Production remains PR77
(`3c59ac1`); acceptance remains **19/65**. Before PR76 release, establish useful
bounded upload capacity, recurring retention execution with reviewed due-work scope,
and the documented legacy pause/drain plus incompatible transport-policy cutover.
Before this one-email batch, Vercel usage was $1.75/$20 included and Resend
3,171/50,000 with transaction overages off; no plan/add-on change was made.

## Current operational preflight · 08:03 UTC, 8 September 2026

All 23 cleanup entrypoints, transitive helpers and associated triggers match
committed `fa26e1a` body SHA-256, owner, security mode, search path and effective
EXECUTE privileges. All required relations/columns are present. Aggregate due
inventory and a three-hour look-ahead find two expired upload attempts and one
historical self-revocation job; all three belong to the previously recorded
synthetic account. Every other selector and raw invitation/contact check is zero.
The two old attempts have no staging object. Their original deadlines are past;
cleaning them later cannot retroactively establish deadline compliance.
No worker ran. Refresh this inventory immediately before any global activation.

Live capacity remains 64 KiB per file, 256 KiB per account, two active uploads.
Aggregate existing genome Storage is five objects / 88,603,743 bytes; none belongs
to the just-deleted fixture. The database is about 991 MB, with the variant
relation about 967 MB. No real file was read or changed and no limit was raised.

A proposed narrow PR77 retention bridge was rejected before commit/push: although
63 focused tests, lint and types pass, its fresh branch database omits canonical
cleanup RPCs. Three real legacy browser tests correctly require zero cleanup
failures. Do not suppress missing RPC failures or weaken those assertions.
Use the already integrated PR76 runtime and its coherent migration chain.
The unscheduled draft is preserved only as investigation evidence.

Next release batch: prepare the canonical production candidate and useful bounded
capacity; deploy the current legacy runtime with new issuance paused, verify the
pause and drain existing leases/finalizations under their unchanged deadlines;
coordinate the application transition with `20260906133807`; verify public
contracts, original file controls and restrictive authorization. Activate the
existing retention GET schedule only after refreshed scope/cost review, and
verify actual scheduled cleanup. Keep a canonical-compatible recovery deployment
once canonical sources can be admitted. Whole-plan acceptance remains **19/65**.
Evidence: parent task `work/current-retention-release/` metadata, parity, due and
synthetic-scope receipts. Vercel usage was refreshed at $1.75 covered by credits;
no scheduler, plan, secret or environment setting changed in this preflight.

## Current production baseline · 8 September 2026

**PR77 is live**, merge `3c59ac17bd3805e912068b76d12d1f64142f9397`, deployment
`dpl_39taDzWRuVgWbaDEQrRhARWUPz73`, READY on both public domains. This is the
six-file authentication-return correction extracted from PR76 onto PR75.
Its merged tree equals tested head `a90b756`: CI `34168717416` passes 2,289
units, 1,044 SQL assertions, 30 lock checks and 220 browser tests, zero
skips/retries, including cleanup. No migration or production binding changed.

Actual production password sign-in for `inherit-test@plus.bio` preserves
`/settings?check=auth-return#local` and renders Settings with that identity.
A scheme-relative external destination instead reaches a fully rendered
`https://www.inherit.bio/overview`. Verification uses an isolated in-app
session. Both public sign-in pages return 200, and the scoped production
error/fatal log scan after deployment returns no matching entries. The cron
UI remains enabled with the same three schedules; no manual job ran.

The first automatic auth preview lacked all environment variables. Only its
branch received the existing public Supabase URL/anon key; no service-role or
private key was retrieved. That preview proved routing and Settings, but its
Overview lacked server configuration. The production check above closes that
preview limitation. The original own-upload canary remains `f0ab225` with its
stable alias unchanged. Its completed hosted journey is recorded above.

Use **PR77 as the current legacy runtime and rollback baseline** for PR76's
future cutover. It retains PR75's pause/drain behavior, mail worker and data
compatibility. The incompatible `20260906133807` migration stays deferred.
Historical PR75/count snapshots below describe their dates. Full-plan
acceptance is **19/65** from the separate local G1.14 proof. Evidence:
parent task `work/auth-return-release/{ci/,production-proof.json,preview-routing-proof.json}`.



## Authentication return correction · 8 September 2026

Normal signup for the new synthetic alias exposed an outdated hosted Auth Site
URL, `http://sequence.plus.bio`, and an allowlist containing only three historical
Sequence URLs. The first confirmation email reached Zoho, but its fallback link
was not followed. The default is now `https://www.inherit.bio`. Existing entries
are preserved; exact callback paths and query patterns were added for the two
current production hosts, the stable protected canary and its exact current
immutable deployment. There is no general preview-host wildcard.

A single repeat of the ordinary signup form with the same pending credentials
issued a fresh PKCE confirmation. Its destination was inspected without logging
the token, followed in the same browser, and reached authenticated Overview on
`inherit-8i84xla1x-mariodiego.vercel.app`. Read-only Auth metadata confirms the same
synthetic account is email-confirmed. This is actual signup/email/callback proof,
not a report-ready Resend delivery receipt. No key retrieval, admin confirmation,
account overwrite or old-token rewrite was used.

The browser account completed the ordinary adult/disclosure/storage choices.
The extension rejected setting the 425-byte fixture in its file chooser; no
native chooser appeared on fallback. The owner has been asked to enable the
extension's documented file-URL access. An independent read confirms zero genome
files for the new synthetic account. No report was generated or queued. Preserve
the pending authenticated upload tab and private synthetic credentials.

Review also found that login/callback `next` values could navigate off-site.
Reviewed code `8926563` now validates local destinations for password sign-in,
OAuth and callbacks, preserving local queries/fragments and independent-login
sequencing. All 53 focused tests, scoped lint, generated types and full TypeScript
checks pass; it is not yet deployed in this canary. CI `34167007160` passes on `fcfcb390` with 3,177 units and all 232 browser
cases, zero skips/retries. Later Lighthouse/copy changes require another
exact-head run. Evidence: parent task
`work/current-canary-refresh/auth-url-correction.json`.


## Protected current canary and test-mail readiness · 8 September 2026

Current protected canary `f0ab225` is READY as
`dpl_9nEofpr63YA2V7Ez4mDdNdPfYc1Q`, with stable alias
`inherit-env-own-upload-canary-mariodiego.vercel.app`. All 1,170 deployment
inputs match committed tracked files; only the two gitignore files are omitted.
The five existing custom-environment application bindings are retained, SITE/APP
URLs point to the stable protected alias at build and runtime, and candidate job
secrets are empty. Fresh before/after project metadata confirms production cron
ownership/definitions and protection are exactly unchanged. Production stays
PR75; this is not a public release or proof of hosted findings/notice delivery.

The owner reports Resend Pro usage of 3,169 / 50,000 (46,831 remaining), renewal
September 16, and unlimited daily sending. The Resend plugin verifies inherit.bio
sending is enabled. After the owner requested a dedicated test address,
`inherit-test@plus.bio` was created and verified as a Zoho alias on the existing
mailbox, without an additional license or primary-address change. This resolves
the prior recipient/allowance prerequisite. A fresh Inherit account registration
uses that alias; its verification email reached Zoho. Chosen report generation,
actual application ready notice, withdrawal and source cleanup are still pending.
No manual global worker or incompatible cutover migration has been run.
Evidence remains under the parent task's `work/current-canary-refresh/` and
`work/resend-plugin-readiness.json`. Full-plan acceptance remains **18/65**.

Rollout preparation checkpoint, 7 September 2026. This is not a feature-release receipt.
The new upload/report runtime is verified in a protected hosted canary; production is the independently released
PR75 at `a7d5a8e6ac827beb2db464e4dbe34b2bfed8507b`, with its pause off.

## Health Picture and own captured detail staged · 7 September 2026

After the complete local 16-case journey passed, two additive migrations were
applied in order and metadata-verified at 21:14 UTC:

| Canonical migration | Actual hosted version | Canonical SHA-256 |
| --- | --- | --- |
| `20260907153506_health_picture_canonical_results.sql` | `20260907211300` | `8760c3a946d9cdb5af9bb74081a4bd0eb5eb71decd580bc5c0e41e74c1fc5bf6` |
| `20260907204454_own_captured_report_detail.sql` | `20260907211345` | `ff9f40df1ae74f8122e85d7ef336a3956c0a3ac4901ed15d9a938c60c99ef051` |

All eight new function bodies, owners, execution privileges and security
settings match; all 11 existing dependencies remain unchanged. Complete
stored wrapper hashes match the reviewed source. The new private grant table
has no direct client or service-role access; public entrypoints remain
service-only. Neither migration replaces an existing function. Evidence:
`work/health-own-report-hosted-staging-085dc9b/applied-receipt.json`.
No application RPC, generation, worker or provider operation ran during staging.

Final local V4 at `7ebabc5` passes all 16 Health Picture/Family cases, three
actual uploads and five inspected desktop/phone captures using fresh build
`ZtFdEBSPtsfwjGkWXRtjE`. Local schema is 79 migrations; focused SQL passes
46 Health Picture and 29 own-detail assertions. These do not establish hosted
application behavior. PR75 remains production; retain its legacy Storage
policy until the separate pause/drain and `20260906133807` cutover. Additive
schema can remain during application rollback. Full PR76 CI, notification
recipient/allowance, hosted app/worker/mail proof and coordinated cutover remain
open. Clinical/ROH and Portrait trait/lineage gaps remain explicit; **18/65**.

## Family and account-deletion release prerequisites · 7 September 2026

Local `fb43083` passes seven production-build Family/account-deletion browser
cases, including two actual Storage uploads and actual worker completion.
Bundle `work/hosted-eight-migration-staging-fb43083/` contains eight
exact committed migrations, **applied and metadata-verified hosted**: Copilot authority
`081757`, chat content `081759`, report catalog snapshots `083251`, ancestry
`111757`, ancestry export/notices `111835`, Family saved results `124212`,
account grant-nonce cleanup `132302`, and upload-session ordering `134656`.
All identifiers above have date prefix `20260907`. The final function manifest
covers 55 functions (59 definitions across the ordered bundle). Each wrapper
uses one transaction, a 5-second lock timeout and a 60-second statement timeout.

Actual hosted history versions, in that order, are `20260907152533`,
`20260907152756`, `20260907152800`, `20260907152805`, `20260907152810`,
`20260907152814`, `20260907152819` and `20260907152824`. Each stored SQL
wrapper matches its complete reviewed SHA-256. Final checks match all 55
function bodies, owners, security settings and effective execution privileges,
nine columns, ten enabled triggers and two published consent artifacts.
Seven additional function definitions, the original public grant API, the
53-row retention registry and legacy Storage policy are unchanged. The new
Family snapshot table has no direct role access; its RLS flag is false by
design. No canonical activity or Family snapshot was created. The recorded
zero ancestry journals, overlapping notices and active deletions were checked
again immediately before their dependent steps. See `applied-receipt.json`
and the preserved per-step preflight/apply/postflight artifacts in the bundle.
Portrait migration `20260907142213` was subsequently installed separately as
hosted `20260907204441`, after all 14 local Portrait/GIAB browser cases passed.
Bundle `work/portrait-hosted-staging-c155a78/` preserves fresh metadata checks,
independent review, exact wrapper and applied receipt. All five new function
bodies/owners/ACL/security settings, private table constraints and direct access
match the verified local schema. The full stored wrapper SHA-256 is
`3534d5e6d6393f075549693bc7f238573a5992903362b4744a4d2733756537eb`.
All six existing dependencies are unchanged; zero new Portrait grant snapshots
exist. This is additive schema staging only, without application RPC or worker
invocation. Health Picture and own captured detail were subsequently staged
as recorded above; their latest local baseline contains 79 migrations.

Family adds a new strong directional-grant writer and preserves PR75's writer.
Schema is installed before the application: old report tokens presented to the new
application refuse with 409 before nonce consumption and require refreshed
consent. Earlier grants retain their independently valid legacy access; they
need an explicit new grant for canonical saved results. Roll back the app while
retaining additive schema. Keep incompatible `20260906133807` separate until
its documented upload pause/drain and coordinated transition.

Read-only allowance check at `2026-09-07T15:16:30Z`: Vercel shows
**$1.73 / $20 included credit**, **$0 on-demand**. This supports one bounded
preview build, not overage authorization. GitHub repository visibility is
PUBLIC and CI uses a standard hosted runner. That bounded preview push was
used for `001b72e`; another push requires a fresh allowance read. Its CI run
`34137537643` stopped at the name gate on a negative-test example hostname,
before browser execution. The input is corrected to a reserved `.invalid`
hostname without changing the assertion or gate. Full CI remains unresolved.
Hosted report generation/mail still requires the authorized synthetic recipient
and verified Resend allowance already requested; the shared production worker
can consume notices queued by preview. No hosted generation or mail was run.

## Historical ancestry staging review · 7 September 2026

The eight-migration installation above supersedes the not-yet-staged status
and missing-function precheck below. These are the retained review conditions
used for that installation; notification and coordinated-cutover gaps remain.

Local ancestry now has a fresh 73-migration replay, 1,746 passing SQL assertions,
2,921 units at `e3ebdb6`, and five actual-provider browser cases at `0e0d99e`
(three uploads). The final source-provenance correction is included in that
browser receipt. See the local verification record for exact snapshots and
preserved failed attempts. This supersedes the older 68-migration local proof;
it does not mean the additional five migrations are staged hosted.

Independent release review requires these checks before staging:

1. Apply the missing `20260907081757`, `20260907081759` and `20260907083251`
   Copilot/catalog prerequisites before `20260907111757` ancestry generation
   and `20260907111835` ancestry export/notices.
2. Confirm no existing canonical ancestry journal predates the new required
   metadata constraint. Confirm no pending/claimed v1 report-ready notice
   already overlaps active ancestry; prospective triggers do not repair those
   rows. If present, review a permanent cancellation before proceeding. Both
   hosted counts are zero in the read-only `2026-09-07T12:35:29Z` precheck; the
   ancestry reader is absent and latest history remains `072516/072527/072542`.
   Recheck transactionally immediately before installation.
3. Keep incompatible `20260906133807` deferred until the documented PR75 upload
   pause, in-flight completion and coordinated application transition.
4. Retain additive schema, snapshot readers and authorization/notice guards
   on rollback. Reverting the application alone cannot restore removed content,
   read new canonical files safely or stop already queued delivery.

The shared PR75 mail worker can claim newly queued ancestry-ready notices.
Hosted generation remains gated by the previously requested authorized
synthetic recipient and verified Resend allowance, or a separately reviewed
hold covering all mail invocations and in-flight work. No hold is in place.

Read-only Vercel Usage at `2026-09-07T12:31Z` shows **$1.73 / $20.00 included
credit**, with $1.73 infrastructure charges fully covered by credits; the
$20 total is the existing Pro subscription. Usage may lag by one hour. This
establishes headroom for one bounded automatic PR preview build, not an
enforced spending cap or permission for upgrades/overages. No setting changed.
Production remains PR75; full-plan acceptance remains **18/65**.

## Current local prerequisites · 7 September 2026

The replacement protected candidate is READY at `85fe7c4`, deployment
`dpl_5mGS9PoQyCYYhm8dM7SQBwGm6MWT`, with the dedicated `own-upload-canary`
alias. Its runtime matches the locally verified code below. Production remains
PR75; the prior `9ffb68a` report/withdrawal receipt remains historical evidence.
At `6e9acd6`, all **69 selected browser cases pass together**, with no
skips/retries and 33 actual provider uploads; see
[the local receipt](local-upload-browser-verification.md). Runtime `6c25379`
passes 2,702 units and typecheck. Full CI remains incomplete.

A fresh isolated cluster replayed all **68 migrations** at `6c25379`, with
exact lexical history and file hashes verified. Eleven rollback-only fixtures
pass **299/299 assertions**, including 67 canonical notice checks and the
existing export, generation, revocation, mail and deletion contracts. Successful
isolated projects were removed; earlier failures remain retained. This supersedes
the previous 67-migration / 124-assertion checkpoint. The corrected new notice
migration SHA-256 is `875c9e94b549783d72658905cc92b95ec90d16b51f06ac358e051741d7a4cbfa`.

Fresh replay exposed a packaging defect in
`20260906135854_own_report_layer_language.sql`: its table lock depended on
an outer transaction. One DO statement now wraps the same SQL operations and
unchanged consent bodies/hashes. Hosted staging already applied those operations
transactionally; **do not reapply that migration** to the existing hosted
project or rewrite its history. Earlier staged-body comparisons remain dated
evidence for the original file. Test fixtures now declare their bounded upload
configuration and synthetic template/PGS references inside rollback transactions
instead of depending on the older local database's seed. All initial failures
are retained in the task receipts.

The three executor/export/notice migrations are now staged and independently
verified hosted. Assigned history versions are `20260907072516`,
`20260907072527` and `20260907072542`, respectively. Exact canonical file
bytes match after removing the recorded BEGIN / 5-second lock timeout /
60-second statement timeout / COMMIT wrapper. All 30 function bodies, owners
and execution privileges, five columns, seven enabled triggers and the phase
registry match. Client roles retain no new execution or table access. The
legacy staging policy remains and the incompatible cutover is still absent.
No report generation, retention worker or provider call was performed.

Current Vercel cycle usage at `2026-09-07T07:10:26Z` is about $1.72 against
$20 included credit, with billed usage rounding to $0.00. This establishes
headroom for one bounded candidate build, not an enforced spending cap.
One bounded build completed using that headroom. The stable protected alias
`inherit-env-own-upload-canary-mariodiego.vercel.app` now targets the replacement;
`NEXT_PUBLIC_SITE_URL` names that alias at build and runtime. The 07:20 UTC
alias receipt refers to the previous candidate and is historical.
Public aliases and scheduled jobs remain PR75; acceptance stays **18/65**.

### Replacement source-only hosted verification · 7 September 2026

The 08:01–08:03 UTC browser run completed actual restricted Storage upload,
finalization and preparation, original download, canonical ZIP content and
selected-file deletion. Independent before/prepared/after SQL checks prove
exact source hashes and bindings, no analytic grants/results/ready notices,
zero new-source derivatives or Storage bindings after deletion, and an unchanged
retained source. The new 547-byte source contributed three variant rows and
four observed calls. Its normal consumed upload receipt and cancelled retention
phase remain valid historical records. Existing fixtures were preserved.

Export was a native browser request to the actual export API, with exact ZIP
content checked; this does not claim hosted export-button verification. Earlier
harness attempts were retained: optional hosting feedback remained blocked,
the settings page was avoided because its status GET prunes account nonces
globally, and a local HTTP reproduction established that Playwright cannot
observe File XHR bodies although the server receives exact bytes. Strict upload
headers remained required; finalization, independent hashes and downloaded
original bytes establish actual content. The successful run had no denied
application request or page error. Receipt: task evidence
`source-only-3add608c-709a-4776-ba4e-9ec840495064`.

The earlier object-free lease `47817a0f-13b5-463c-9395-4c72a748be9c` remains
issued until its normal 08:22:45 UTC expiry, with fixed cleanup at 09:52:45 UTC;
no expiry, quota or cleanup ledger was altered. No report generation, mail or
retention worker ran. Resend's billing page requires owner sign-in, so current
email allowance and overage settings remain unverified. Actual notification
delivery, operational cleanup, complete CI and the coordinated public cutover
remain separate release prerequisites.

### Shared mail-worker transition

PR75 and this candidate have identical mail-worker, sender, crypto and
report-ready template code. The new migration retains claim/pre-submit RPC
signatures and legacy eligibility while adding canonical checks. The live
minute cron can therefore consume and decrypt newly queued canonical notices.
Excluding mail credentials from preview does **not** isolate that shared outbox.
Successful chosen-report completion or completed-work replay may trigger mail;
source-only preparation does not.

Before hosted generation, obtain explicit delivery authorization for a designated
owner-controlled synthetic recipient, or establish a separately reviewed hold on
all mail invocations including in-flight work. A post-enqueue cleanup races the
worker and is insufficient. No hold, provider call or delivery has been performed.
On application rollback retain the additive database migration and its contact,
readiness and submission guards; application rollback alone does not stop queued
delivery. Compatible staging and source-only canary checks can proceed without
claiming notification delivery or changing production scheduling.

## Previous staging checkpoint · 18:35 UTC, 6 September 2026

The owner completed signing-key activation. The authenticated dashboard labels
replacement `d5e4e50d-7017-4c8f-9435-22c07b5234a9` Current and both older keys
Previous. No revocation or private-key retrieval was performed. Vercel confirms
the signing variable exists as a sensitive Production-only variable; its value
was not inspected. Successful hosted token minting and actual Storage acceptance
remain unverified.

All twelve compatible own-upload migrations were applied sequentially through
Supabase migration operations, each with an explicit transaction and 5-second
lock timeout. Independent poststage verification matched each complete SQL body
to the local file, checked the current v2 consent artifact hashes and enabled
immutability trigger, and confirmed all 23 public RPCs are service-only. The
four new private tables have RLS and deny ordinary-user table privileges.
The upload role retains only the intended Storage insertion capability.

The incompatible `20260906133807_cutover_subject_upload_transport.sql` remains
unapplied: the existing legacy staging policy is preserved. Configuration rows,
canonical leases/source markers, normalization rows and analysis rows are all
zero. No real genetic file was changed. Security advisor reports zero errors;
its existing definer and leaked-password-protection warnings remain open.

Vercel Standard Protection is enabled for all deployment URLs except custom
domains. The public custom domain still returns HTTP 200; the generated URL
requires Vercel authentication. A detached canary checkout at `8166c3b` passed
a deployment-file dry run: 1,058 tracked files, 19,349,767 bytes, with no actual
credential files. No canary has yet been deployed. Existing active cron targets
still point to PR75. Scheduler isolation, explicit upload capacity, a fresh
synthetic account and the real hosted journey are the next ordered checks.

Existing Vercel included usage was rechecked at $1.71/$20, with $0 on-demand.
The next authorized hosted batch is one protected candidate build and two tiny
synthetic uploads, with bounded HTTP checks and no external model calls,
background-worker invocation, new resources or plan changes.

The following older checkpoints are retained as historical evidence; this
section supersedes their pending-activation and unstaged-schema statements.

### Protected canary preparation · 18:48 UTC

The included first custom environment `own-upload-canary` was created with
Vercel type `preview`, no branch matcher and no public domain. Five necessary
existing variables are shared internally by environment ID: Supabase URL,
public key and service role, BYOK encryption key, and upload signer. Their
Production targets remain intact. No values were retrieved. Worker and email
credentials were excluded; deployment-only worker secrets are explicitly empty.
This avoids the unproven cron behavior of a production `--skip-domain` deploy.

Temporary canonical capacity is now configured and read back: 64 KiB per array
or VCF, 256 KiB per account, two active uploads, exact hosted Auth issuer.
These are tiny protected-canary limits, not public file-size commitments.
The configuration is global to canonical issuance, whose public wrappers are
service-only; PR75 does not consult it. Current provider-wide Storage size
configuration is not independently confirmed; the two canary fixtures total
972 bytes and actual provider acceptance is still required.

First deployment `dpl_FXTojShhFADjYjbRKV3PYcAZFhcA` was BLOCKED before building
because the local commit author's machine-only email is not GitHub-attributed.
Its source remains `8166c3b`. The follow-up documentation commit uses the
existing owner's verified GitHub email without rewriting historical authorship
or changing runtime source. The protected custom environment and all three
active production cron definitions were checked; crons still target PR75.

Synthetic Auth Admin setup through the existing Supabase CLI did not return
within bounded attempts; both processes were stopped before account creation.
No user list, existing account update, consent seed or private signing-key
retrieval occurred. A supported alternative credential path for the actual
new-account operation is being checked; no hosted genetic upload has run.

### First real hosted browser journey · 18:53 UTC

The follow-up candidate `dpl_9W634MRCEadvBBvoB4tHg5KhEU5p` is READY at
`9ffb68a1a9b79e093d986e1e054449fcf9095f9c`; its only changes from the locally
verified `8166c3b` runtime are the two rollout documents. Public aliases and all
three cron definitions independently remain on PR75. Both candidate URLs still
require Vercel authentication. No second build was consumed by the earlier
BLOCKED author-attribution attempt.

A legitimate Auth Admin create operation made exactly one fresh, confirmed
synthetic account, with no consent or result seeding. The fallback retrieved
only the named existing Supabase service credential through Vercel's supported
API for immediate server-side Auth Admin use, kept it in memory, and validated
its project and role. The upload signing private key was never retrieved.
The independent baseline found one profile/subject and zero files, leases,
consents or signatures for the new account.

A fresh browser used a temporary candidate-specific Vercel share URL to install
a secure host-only cookie, then the app's normal password sign-in. It checked
the actual confirmed account identity before making fictional adult declarations
and signing disclosure/store consent through the UI. No trace, HAR, session
export or injected credential headers were used. Independent review corrected
a redirect-prone test-header approach before its first execution.

The single run, 18:52:40–18:53:23 UTC, passed two real uploads totaling 972 bytes:
exact browser hashes, restricted Storage bearers, provider HTTP 200, bodyless
finalization, normalization, explicit trait-report permission and real personal
findings with public sources and honest missing coverage. Grant alone exposed
no findings. The two conflicting files produced the expected disagreement.
Both downloaded byte-for-byte through native app/Storage redirects; deleting
only the second source returned 204 and preserved the first download/report.
PDF and multiple-sample files were refused before issuance/Storage. There were
no browser errors or global-worker, invitation or outside-model requests.

Desktop/mobile screenshots were inspected: controls fit, report coverage and
source facts remain distinguishable. Generic file names and sub-kilobyte sizes
rounded to 0 KB remain usability limitations. The active retained synthetic
source was preserved for independent journal/Storage checks, which passed:
correct 425-byte raw/decoded hash, revision 1, complete normalization, five
source variants and five usable observed calls, current polygenic grant and
completed source/grant-bound analysis. The deleted file and all checked derived
rows/journals are absent; both staging objects and its final object are absent.
The retained final object matches its canonical file/object bindings. No
unchosen grants, ancestry results, workers or mail were created. Provider
owner_id on the service-copied final is null; ownership comes from the checked
canonical bindings. Authorization refusals and purpose withdrawal are next.
This is a protected hosted canary, not a public cutover or a full acceptance gate.

### Restricted-token refusals and withdrawal · 19:11 UTC

A bounded follow-up used a genuine new token signed with public kid
`d5e4e50d-7017-4c8f-9435-22c07b5234a9`. Eight actual Storage operations returned
HTTP 400 envelopes containing explicit provider 403 authorization denials:
wrong bucket/key creation, reading the existing retained synthetic object,
listing its prefix, updating/deleting the new absent key, upsert at that key,
and a real body one byte over the token's exact maximum. Independent SQL then
confirmed the lease remained issued/unconsumed, all new target objects were
absent, and the retained source/object/grant were unchanged. After this explicit
checkpoint, the **same token** accepted the exact 547-byte source, which really
finalized, prepared, downloaded and was deleted through the application.

The first attempt's 60-second acknowledgement timeout is preserved as a setup
failure, not a product failure or a complete token test. Its eight denials had
no same-token positive control. The corrected run retained every assertion,
used a 180-second explicit-ack deadline and promptly executed the lead's separate
SQL verification before acknowledging. Neither timeout grants permission to
continue. The second run passed from 19:10:43 to 19:11:20 UTC.

The previously verified live trait-report permission was then withdrawn through
the real UI. Direct authenticated Data API reads for the retained file changed
from three PRS coverage rows to zero; ancestry remained empty. Fresh report
responses omitted personal results. Exact original download and source A/G
remained available under live store consent. A focused read-only browser check
also waited for the regional API/IGV track to finish and inspected the rendered
region, rather than treating the earlier loading screenshot as complete proof.

Independent final checks confirmed the third file, its derivatives, journals,
staging and final objects are absent. The retained 425-byte source, raw and
normalization bindings, five variants and five observed calls remain intact.
The report grant and direction are revoked, with no remaining PRS/analysis rows,
no unchosen grants, no ancestry and no mail. Exactly one expected purpose-derived
revocation purge job is queued/unstarted; this is not worker-execution evidence.
Operational preflight found no supported executor for `worker_jobs.revoke_purge`:
neither PR75 nor the canonical retention route handles it, and the standalone
worker handles only `annotate_vcf`. No corresponding purpose retention phase or
purge manifest exists. At 19:18 UTC every other checked due-work component was
empty; the generic queue contained only this synthetic job. Its 60-second
physical deadline was 19:12:12 UTC, and the checked derived stores are already
empty through inline revocation. Do not claim manifest/worker completion from
that emptiness or call unrelated retention endpoints. A real executor and its
residual receipt are the next implementation prerequisite.

The unused first-attempt lease `0c0c1188-2802-473e-9e8b-9539afbb53b7` has no
object. It remains untouched, with token expiry 19:36:22 UTC and the ordinary
two-hour cleanup deadline 21:06:22 UTC. No deadline or state was shortened to
manufacture cleanup proof. In total, three successful synthetic uploads stored
1,519 source bytes; two sources were deleted and one remains for verification.

Absent-target UPDATE/DELETE and empty-key upsert are limited probes, not complete
existing-object overwrite/deletion proofs. Expiry, validly signed excessive
claims, store-consent revocation, cross-account boundaries and ordinary-session
transport denial after the deferred legacy cutover remain open. This evidence
supports the protected own-file milestone; full-plan acceptance remains 18/65.

## Historical verified scope before schema staging

- Inherit Supabase project: `zuvloczwgrayonqabnss`, reported ACTIVE_HEALTHY.
- Vercel project: `prj_K7bVowhjFr0uIapXraH41hthJkgy`, team slug `mariodiego`.
- Production PR75 deployment: `dpl_GdFqNrewbxF28SCT23LuR5qwxGVJ`, READY,
  with both `inherit.bio` and `www.inherit.bio` assigned to the exact merge.
  Authenticated `/files/upload` and `/files` were checked after deployment:
  both retain an enabled Choose file button. No real file was submitted,
  downloaded, deleted or reprocessed. Pause-on behavior is CI/local evidence,
  not a production assertion.
- The scoped hosted database audit found no `upload_authorization_config`,
  `own_normalization_runs` or `own_analysis_runs` yet. It found neither
  `pg_cron` nor `pg_net` installed. The genomes bucket is private; its
  bucket-specific size and MIME limits are null.
- Public Auth JWKS advertises an ES256 key. Advertisement does not show that
  the application possesses its private key or can mint a trusted upload JWT.
- Vercel's signed-in list was subsequently inspected without revealing values.
  The owner created the Production-only signing secret; its stored value is
  write-only and has not been read back or verified by a deployment.
- Hosted Edge Functions `bootstrap`, `seed-reference` and `prs-backfill` are
  ACTIVE with `verify_jwt: true`. Their deployed versions 5, 4 and 2 are
  unconditional HTTP 410 tombstones: no request processing, credentials or
  database/storage access. No callers were found in current `src` or `scripts`;
  this does not prove they have no external callers. Leave them unchanged.
  The specific [function authentication guide](https://supabase.com/docs/guides/functions/auth-headers)
  supports asymmetric keys, whereas the general signing-key guide retains a
  compatibility warning. No live function invocation was performed or needed
  to establish that these retired handlers contain no active workflow.

## Owner authorization and access checkpoint

On 6 September 2026 the owner explicitly approved controlled signing-key
import and activation, retaining the existing key and testing synthetic
uploads first. The initial preparation below was followed by owner-executed
replacement-key generation, Vercel saving and Supabase standby import. No
activation, revocation or deployment has occurred in this setup sequence.

The connected Supabase tools expose database and Edge Function operations,
but no signing-key management operation. The owner completed GitHub login in
Brave. The authenticated Inherit JWT dashboard confirms current ES256 key
`1591c25b-673c-45f3-b60d-f20bfd5c59bb`, previous legacy key
`1cc85c83-b89b-437d-87ad-4cc1de0c9daf`, and no standby key. The import form was
opened with ES256 selected; no private material was entered or submitted.
Browser credential changes require owner completion of entry and submission.

Neither `SUPABASE_ACCESS_TOKEN` nor `VERCEL_TOKEN` is set in the current shell.
The existing Supabase CLI can list projects through its saved authentication,
but its inspected commands expose no JWT signing-key import operation.
Vercel's environment-settings dashboard is signed out. Do not extract browser
or connector session credentials; use a supported management interface or an
owner-assisted dashboard handoff. Never ask the owner to paste private signing
material in chat. Establish production-only secret storage before creating a key.

The owner subsequently signed into Vercel. Its environment list has no
`INHERIT_UPLOAD_SIGNING_JWK`. The new-variable form is prepared with that name,
Secret type and Production only, with an empty value and no save submission.
Existing values were not revealed. Both credential forms await owner entry;
first import as standby and save the identical key securely, then verify the
public key identifier before activation. Do not redeploy merely to save a key.

### Latest verified owner-completed state

The dashboard was checked again around 17:51 UTC: the replacement remains
Standby, current and legacy keys are unchanged. The Rotate signing key dialog
is prepared, with no confirmations selected and no final submission. Browser
tool policy requires owner submission for a credential change; an asynchronous
handoff requests that activation while retaining both older keys. No private
key is needed in chat or reread from Vercel. The dialog warns about the three
retired Edge Functions already verified as unconditional 410 tombstones.

The owner generated a replacement after the first new private key appeared
in a chat screenshot. Never reuse that exposed key or reproduce its material.
The owner reports saving the replacement in Vercel and creating its Supabase
standby entry. The authenticated dashboard and public JWKS now show replacement
`d5e4e50d-7017-4c8f-9435-22c07b5234a9` alongside the unchanged current ES256 key.
The dashboard still labels the replacement **Standby** and retains the original
legacy key. The exposed key is not among the dashboard's listed current,
standby or previous entries, nor the fetched public JWKS.

This verifies public registration, not possession of the same private key in
Vercel or successful hosted upload authorization. Do not infer either from
the write-only editor appearing blank: Vercel's save-success notification
confirms the write, while stored secret contents cannot be revealed in Edit.

The browser upload now sends the existing public project key in `apikey`,
separately from its restricted upload bearer in `Authorization`. Missing or
malformed public-key configuration is refused before lease issuance. No
server credential or ordinary user-session token is substituted. This follows
the signing-key guide's gateway requirement; a read-only unauthenticated GET
to an invented object returned a bucket refusal and was **not** treated as
proof that a real hosted upload works. Positive hosted authorization remains
unverified until the ordered synthetic canary is possible.

The owner explicitly requires no spending: no new paid resources, upgrades or
paid add-ons. Prefer existing resources and free limits, including Cloudflare
where appropriate. This checkpoint provisions no service and initiates no
deployment. Any usage-bearing canary or scheduler requires a verified bounded
cost plan rather than assuming the provider is free.

## Hosted trust is not the local harness

The local browser harness gives an isolated instance of the actual Storage
provider an extra ephemeral public key. It does not alter project Auth keys,
and proves provider authorization/real stored bytes locally. Hosted Supabase
does not thereby acquire that key or the same configuration facility.

The official [signing-key guide](https://supabase.com/docs/guides/auth/signing-keys)
documents importing a privately held key and rotating it into use. Existing
keys remain usable until separately revoked. It does not promise that merely
publishing a new standby key enables every hosted service to trust arbitrary
new tokens. The guide also distinguishes the API key header from the custom
JWT Authorization header. Validate the exact hosted Storage request, including
gateway headers, rather than inferring success from the isolated provider.

An imported project signing key is privileged: it can sign other project roles,
not only upload-role claims. The application constrains emitted claims, but
key custody must receive the same care as other privileged server credentials.
Do not export an existing Supabase-managed private key; the documented design
does not allow that. Do not put a private key in browser configuration, chat,
source control, build artifacts or verification traces.

## Ordered release work

### 6 September follow-up: compatibility and bounded cost preflight

Read-only live checks still identify PR73 as production, no open PR at the
start of the batch, and no hosted own-upload migrations. The local ref had a
single-branch fetch configuration; `origin/main` was explicitly refreshed to
the GitHub-confirmed PR73 commit before reviewing the release base.

The migrations are **not all additive**. `20260906133807` drops the ordinary
session staging policy used by PR73; both legacy upload API aliases also have
new incompatible contracts. Stage reviewed compatible schema separately,
then coordinate the transport policy and app cutover, including old tabs and
in-flight uploads. A Vercel-only rollback is not a complete recovery plan.
The consent-language migration also requires its transaction-held lock and
exact prerequisite artifact hashes; never apply its statements piecemeal.

Authenticated usage dashboards were read without changing settings. Both
accounts are already Pro. Vercel showed $1.71 of $20 included credit consumed
and $0 on-demand charges. Supabase showed 1.042/100 GB average Storage,
0.926/250 GB egress, 1.204/250 GB cached egress, 4,920/2,000,000 Edge Function
invocations and 111/100,000 MAU, with no quota exceeded and overage billing
disabled. Inherit has an existing 8 GB disk. These are a time-bound usage
snapshot, not permission to add resources or a production-wide capacity cap.
Existing compute/subscription charges are not caused or changed by this work.

For the isolated Overview release, bound hosted work to one preview and one
production build, with local preflight and ordinary page verification only.
The public repository uses standard `ubuntu-latest` CI. Recheck allowances if
the scope expands or a further hosted attempt is needed. No external model,
new scheduler, paid add-on, plan upgrade or bulk processing is part of this
release. An own-upload hosted canary still needs a separately bounded plan.

The retention POST is a composite executor: it also processes due invitations,
embryo expiry/notices and account purges. Before any hosted canary invocation,
read only the due-work counts and establish its full scope. Do not describe a
call to this handler as synthetic-only merely because its intended fixture is
synthetic. Existing working keys and real genomic records remain untouched.

### Reviewed schema staging and recovery boundary

Independent read-only review found the own-upload migrations can be staged
in filename order while PR74 remains live, **except**
`20260906133807_cutover_subject_upload_transport`. Keep that policy removal
for the coordinated cutover. The reviewed range starts at `20260906102710`
and ends at `20260906165130`; the language migration still requires its
transaction lock and exact prerequisite hashes. This is a reviewed sequence,
not evidence that any hosted migration has been applied.

A protected production-environment candidate without production aliases could
use the already saved Production-only signing secret. A non-aliased URL alone
is not access protection; verify access controls and a fresh bounded cost plan
before deployment. Retaining legacy Storage policy permits preliminary
integration checks, **not** restricted-upload denial acceptance. Repeat the
full authorization matrix after policy removal.

The public transition requires a server-side pause on new legacy issuance,
completion of existing uploads through their deadlines, actionable recovery
for refreshed clients, and a canonical issuance stop switch. Original PR74
tabs cannot receive new JavaScript without reloading. Before policy removal,
PR74 remains the recovery deployment. After canonical uploads begin, recovery
must retain a compatible canonical app, stop issuance and fix forward; bare
PR74 cannot serve the complete new-source journey. Do not automatically
restore broad Storage policy or revoke working keys.

The replacement private key is already reported saved: do not ask for another
copy or generation. Its public entry remains Standby; accepted hosted signing
and matching deployed secret are unverified. Controlled activation is already
authorized, but any owner-only dashboard submission remains an access handoff.

### Aggregate retention preflight

At `2026-09-06 17:16:01 UTC`, a SELECT-only hosted inventory returned zero
candidates in all eleven installed retention selectors: account notice/resume,
adult contact/pending expiry, embryo cohort/disposition/contact expiry,
invitation refusal-receipt/terminal-notice expiry and refused adult/embryo
cleanup. Predicates were checked against live function definitions. No IDs,
contacts or genetic data were read and no worker was invoked.

Canonical normalization and own-upload cleanup are **unavailable**, not zero:
the canonical tables, cleanup functions and necessary source columns are
absent. This snapshot does not authorize a later worker as synthetic-only;
newly due work can enter its global selection. Refresh the aggregate inventory
immediately before any proposed composite canary.

### Remaining ordered rollout

Local prerequisites advanced at `9b45b75`: 24 actual-provider browser cases
pass, including canonical pause/resumption with 18 uploads and exact bytes.
The unchanged runtime passed 2,661 units at `a8d82b5`. A separate default-off
legacy bridge PR75 passed CI run `34050146592` at `9e92ea6`: 2,236 units,
220 browser cases with zero skips/retries and database/build/repository gates.
It merged at `a7d5a8e` and is deployed with its pause off. The refreshed Vercel dashboard
still reports $1.71/$20 included usage and $0 on-demand charges. This bridge
requires no hosted DDL and preserves existing completion handlers.

The authenticated GET retention adapter is implemented locally at `77dbad1`
and included in those unit checks. It rejects HEAD, foreign credentials,
selectors and bodies before invoking the unchanged bodyless POST once with
server-owned authorization. No schedule is configured and no hosted retention
worker was invoked. Refresh the aggregate due-work inventory before that step.

1. Finish local integrated regression and review the additive migrations,
   including account/source/grant transitions and exact-purpose cleanup.
2. Establish the production signing-key custody and rotation plan, with an
   explicit rollback path and no revocation of currently valid keys. Verify
   any existing verifier/Edge Function compatibility before activation.
3. Apply the reviewed hosted schema and bounded capacity settings in a staged
   rollout. Check effective ACLs, RLS and database advisors; never copy the
   local test-jurisdiction flag into production.
4. With a synthetic canary only, prove the exact issuer/audience/role token
   through hosted Storage: the permitted create succeeds; overwrite, read,
   foreign object, extra capability, expired/revoked consent and finalized
   nonce requests fail. Confirm the original bytes and cleanup independently.
5. Provision and verify recurring retention execution. Vercel cron invokes
   GET; the registered retention handler is bodyless POST. Do not silently
   change its method contract or assume adding its path to vercel.json works.
   Use a reviewed authenticated POST-capable scheduler/adapter and prove
   stalled/expired cleanup, not merely scheduler configuration.
6. Verify the production browser journey and existing file controls before
   calling the own-file milestone delivered. Ancestry, other-adult uploads,
   embryo workflows and broader full-plan gates remain separate work.

No production schema, credentials, scheduler, real account or real genomic
record was changed during this audit.
