# Browser-suite migration after the own-upload cutover

## Health Picture migration verified locally · 2026-09-07

At `7ebabc5`, the complete ten-case Health Picture spec and six-case Family
spec pass together: **16/16**, no skips/retries, **three actual provider
uploads**, fresh build `ZtFdEBSPtsfwjGkWXRtjE`. This closes their local canonical
journey migration. Actual UI uploads, chosen generation, invitation acceptance,
explicit reciprocal sharing, source-specific own/shared report navigation and
withdrawal replace the former legacy ingest and direct-grant setup. Captured
catalogs and calls remain per source; no completion or clinical result is seeded.

The original deterministic ROH fixture calculation is still checked, but the
canonical file's ROH columns remain uncomputed. Clinical refusal and unbound
reference-label tests preserve that boundary; they do not close the original
ROH/carrier or Portrait trait/lineage acceptance. All ten cases remain, including
Tier-2, attribution, no ranking, budgets/accessibility, Overview withholding,
per-layer and joint withdrawal. Five desktop/phone captures were reviewed after
the final column-width and visible-owner correction.

V2's repeated-session-gate failure (8 passed, 1 failed, 7 not run) and V3's
16-case functional pass before visual correction are preserved separately in
`work/canonical-health-picture-verification-v2/` and
`work/canonical-health-picture-verification-v3/`; V4 evidence is in
`work/canonical-health-picture-verification-v4/`. No timeout, retry, skip or
original substantive gate assertion was relaxed. Earlier CI/helper counts below
are historical checkpoints, not the current local migration status.

PR76 full CI still awaits the corrected test environment and concrete Linux
runtime diagnostics. Separate local passing batches are not one full CI pass.
Hosted Health Picture/own-detail schema is metadata-verified; no hosted app,
worker or mail journey is claimed. Production PR75 and acceptance **18/65**
remain unchanged.

## Historical full CI checkpoint · 2026-09-07

[CI run 34131989592](https://github.com/themariodiego/Inherit.bio/actions/runs/34131989592)
on pushed `6679ad2` passed every pre-browser check. Of 232 scheduled browser
cases, **131 passed, 9 failed and 92 did not run**. Family sharing and account
deletion now pass in CI. Remaining failures are four missing isolated Copilot
daemon setups, three legacy helper refusals (Health Picture, Portrait and the
other-adult deletion guard), search readiness and the old GIAB uploader.
The reviewed isolated CI runtime and reproducible GIAB-window test are now
integrated locally; actual Linux/full-suite and GIAB browser proof remain due.
Search/count local proof remains seven cases at `dd70229`.

The migrated file-deletion guard has not yet been reached locally: the first
case failed on report-choice replacement in V1/V3. V2 showed the control On
but hung waiting for the streamed response to finish. A single metadata-only
off/on diagnostic on the existing synthetic account showed On 2.617 seconds
after click, with an aborted RSC fetch after application; it did not reproduce
or explain the earlier delay. No timeout or assertion has been relaxed. Keep
all three failed receipts and the zero-upload diagnostic distinct from journey
proof. Safe artifacts: `work/ci-34131989592-failed.log`,
`work/canonical-family-runtime-adapter/file-deletion-v1-*` through `v3-*`,
and `work/report-choice-refresh-probe/`. PR76 remains draft.

### Previous full CI checkpoint

[CI run 34123004524](https://github.com/themariodiego/Inherit.bio/actions/runs/34123004524)
on pushed `3651a46` passed build, unit, private name, legal, template,
readability, secret, database and invitation-lock checks. The full browser run
scheduled 232 cases: **126 passed, 12 failed, 94 did not run**. Four failures
require the isolated Copilot daemon; four reach the remaining legacy upload
helper refusals (Family, Health Picture, Portrait, other-adult deletion).
The Family fixture and account-purge failures now have passing local proof:
at `fb43083`, seven cases pass together with two actual uploads and no
skips/retries. Purge now removes exact owned grant nonces and upload sessions
without breaking consent foreign keys, while retaining Storage/lease guards.
The exact earlier failures and actual-worker recovery are preserved in the
local verification record. Three legacy helper sites remain: Health Picture,
Portrait and other-adult deletion. The isolated Copilot daemon setup still
needs standard-CI integration. Mutation-cleanup and post-login search readiness now pass both complete specs
at `dd70229`: seven cases, one actual upload, no skips/retries, using the
unchanged pinned `fb43083` production build. The old GIAB upload test still
never reaches the current file chooser. Do not narrow the suite or classify separate local receipts as
a combined pass. Safe CI logs and diagnosis:
`work/ancestry-local-install-c4718e9/ci-34123004524-*`. PR76 remains draft.

## Ancestry integration · 2026-09-07

At `0e0d99e`, **5/5 ancestry and Overview cases pass together**, no skips/retries,
with three actual Storage uploads through the isolated production-build harness.
This closes the ancestry/Overview prerequisite described in older checkpoints.
Both marker-coverage states, canonical result generation, ancestry-only Overview
readiness and mobile navigation are exercised; desktop/mobile captures were
inspected. Four legacy helper call sites remain in four specs: `portrait`,
`family-health-picture`, `family` and `file-deletion` (other-adult case).
The older six-call count below is historical. The BAM/CRAM refusal replacement
passes both cases at `b72c1e4` with two actual Storage uploads, no skips/retries;
accepted ADR0016 excludes positive support.
Standard static discovery passes **232 cases in 44 files**. These receipts are
not one combined full-suite pass; acceptance stays **18/65**.

## Earlier Copilot integration · 2026-09-07

At `763fbf1`, **73/73 Copilot cases in four specs pass in one run** with no
skips/retries and 10 actual Storage uploads. This closes local Copilot migration
proof: current-source tools, separate provider permission, closed answers,
captured citations, saved history and exact withdrawal/deletion behavior. All
64 output fixtures are unchanged. Desktop/mobile captures were inspected.
Standard discovery is now **231 cases in 44 files**; full CI is not yet proved.
The six remaining legacy ingest helper calls below are unchanged. This run is
separate from the earlier 69-case report/control run, not one combined
or full-suite receipt. See the current local verification record.

### Previous report/control integration and Copilot repairs

At `6e9acd6`, **69/69 selected cases in 20 specs pass in one run**, with no
skips/retries and 33 actual provider uploads. This combines the earlier 65
cases with canonical mail expiry, pagination export, account notice/cancellation
and the first self-file deletion case. The source fixture is now a bounded
2,005-call synthetic gzip; the old compressed HG001 correctly exceeded the
decoded-size limit. Account purge still requires an isolated disposable stack,
and the other-adult deletion fixture still requires a genuine supported source
or explicit legacy isolation setup. Full discovery remains 226, not 226 passes.

Current `6f066f1` has six remaining `ingestFileAs` calls in six spec files.
The three Copilot specs now use actual canonical upload/preparation and explicit
purposes. Canonical source loaders, provider permission, saved history and exact
cleanup are implemented locally; their 73-case browser integration is now proved by the newer 73-case run above.
Attempt v7 passes the first source-distinction case and the next exact withdrawal
response, then exposes empty-history success after purge (1 passed, 1 failed,
71 not run). Repair `c4e414d` passes 77 rollback SQL assertions; v8 verifies
history refusal, exact message removal and preserved raw data, then finds the
stale raw-genotype expectation corrected in both affected specs (`A/C`). See the
historical failure receipts; the newer v9 run above supersedes the 73-case gap.
Full CI and hosted delivery remain open.

The remaining six sites are not merely stale selectors: ancestry/Overview need
canonical ancestry output, recipient/joint views need their actual authority and
generation, and Health Picture needs ROH computation. The old positive resumable
BAM case has a separate contract disposition: accepted ADR0016 excludes BAM/CRAM
and supersedes that earlier requirement. Its historical A10 evidence remains;
`tier2-upload.spec.ts` now checks browser refusal, declaration refusal and actual
Storage/finalization rejection cleanup for both formats. See the explicit
[test diff entry](./test-diff-register.md#bamcram-historical-proof-and-current-refusal-contract--2026-09-07).
These two cases now pass actual-provider execution at `b72c1e4`, with two
real uploads and exact finalization rejection/cleanup proof. Preserve all other substantive assertions; changing status flags or
narrowing standard CI does not implement their missing behaviors.

### Previous export-only integration

The actual-provider bootstrap is integrated into the standard runner, with both
projects and the paused server retained. Six report/source specs use explicit
source-only or selected-report preconditions. Runtime `5ee7121` has passing
evidence for each of 65 selected cases across the `f3e21cc`, `c76a4bf` and
`5c2c194` runs after test-only corrections, including actual two-source ZIP
content and post-withdrawal raw access. The failed runs and scope are retained
in [the local receipt](local-upload-browser-verification.md); this is not one
passing 65-case run. Discovery is **226 cases in 43 files**, not 226 passes. Remaining legacy
`ingestFileAs` invocations are **9 in 9 spec files** after the next prepared
test-only batch at `1043838`. Those five migrated notice/source-control cases
pass lint/typecheck but have not run against the pending notice runtime.
The account-purge case retains generated derivatives and exact zero-residual
proof; it requires a clean disposable stack because the composite worker selects
queues globally. Its explicit prerequisite fails instead of skipping, and must
never be enabled on preserved local fixtures. The older checkpoint and
callsite list below describe their dated revision. Whole-plan acceptance remains
**18/65**.

2026-09-06 checkpoint at `9b45b75`. The local actual-provider runner passes
**24/24 cases in nine specs**, with 18 uploads and zero skips/retries. See
[the receipt](local-upload-browser-verification.md). Standard discovery finds
**225 cases in 42 files**; that entire suite has not passed on this branch.
`ingestFileAs` still has **21 calls in 18 spec files**. An affected-file count
is not a count of demonstrated failures. Acceptance remains **18/65**.

## Migrated and verified

- Personal Copilot source/permission/history and withdrawal/deletion journeys.
- Preparation, chosen own reports and two-file download/deletion/recovery.
- Canonical issuance pause and real acknowledged-upload completion,
  preparation and exact downloads while another source remains unchanged.
- Three report-library recovery cases, four behavior study-scope cases,
  seven report-preview cases and five sensitive report-gate cases.
- Canonical conversion/listed-call provenance and withdrawal. Report library,
  detail and Data scores use explicit completed report purposes; raw Browser
  uses prepared-source authority. No legacy snapshots are fabricated.
- Overview exact chosen-result readiness and starter ordering are verified
  within the own-report journey. The old populated Overview spec also requires
  a computed ancestry state that canonical generation does not yet provide;
  its unsupported ancestry assertions remain, alongside the old helper.

Every analytic upload helper call specifies the needed purpose. Repeated
uploads validate existing-choice receipts and the exact selected source.
The array fixture now has the recognized vendor header. Local public
reference templates must be seeded from the tested source; stale templates
were corrected without changing source/interpretation assertions.

The runner uses actual local Storage with ephemeral public trust, loopback
transport and no Auth rotation. Hosted targets remain refused. The reviewed
standard CI bootstrap accepts only the exact disposable GitHub job and forbids
narrowed selectors; full-suite configuration now supplies the independent
paused app server on 3102. That integrated CI run has not passed yet.

## Remaining prioritized work

1. **Source controls:** account-deletion-purge, supported own file-deletion
   and deletion-export cases now have canonical setup preserving lifecycle,
   generated-derivative and physical removal assertions; browser proof is pending.
   The separate other-adult deletion fixture remains unsupported and unchanged.
2. **Connected surfaces:** the old Overview case still needs its ancestry
   computation prerequisite. Canonical Copilot loaders, separate provider
   permission and source-bound tool authorization are implemented locally.
   Saved-history/invalidation browser proof passes in v9 after the
   empty-history repair and raw-genotype fixture correction. Its 64 output cases use an isolated synthetic HTTPS
   provider; they do not prove a real external model's behavior.
3. **Required notifications:** the durable canonical report-ready contract,
   expiry/replay and deletion invalidation are implemented and passed in the
   earlier 69-case local run. Hosted delivery, verified allowance and recipient
   authorization remain open; generation success alone does not prove delivery.
4. **Ancestry and shared results:** the dispatcher supports monogenic and
   polygenic only. Ancestry/lineage, adult shared/joint results and Health
   Picture ROH computation need real authorized generation. A saved purpose
   is not a computed result. Modern own reads do not authorize recipients.
5. **Embryos and closed formats:** existing empty/denied embryo surface cases
   do not prove either positive uploader path, QC, publication or comparisons.
   BAM/CRAM storage is excluded by accepted ADR0016, not an unimplemented
   current format. The historical positive proof is explicitly retired in the
   test diff register; its two replacement actual-provider refusal/cleanup
   cases await browser execution. Do not restore ordinary-login Storage access
   or call rejection a successful storage/analysis journey.

For same-origin transport prefer browser-native requests or navigation response
bodies. The reviewed standard runner now keeps APIRequest/`route.fetch` direct
HTTP and manual Chromium contexts inherit the proxy. Do not invent native
Sec-Fetch headers for `route.fetch`; preserve SSR-denial and mutation evidence.
Keep no-file recovery, public/legal and jurisdiction-denial cases independent
of analytic grants.

## Remaining helper call sites

All paths below are under `e2e/`; these are invocation lines, not imports.

```text
ancestry:75
family-health-picture:402   family:287
file-deletion:105
overview:233                portrait:339
```

The deliberate legacy victim in `rls.spec.ts` is an isolation fixture, not
canonical upload readiness. Preserve the legacy positive/negative tests and
migrate their runtime prerequisites in bounded batches; do not skip them to
claim a full green run.
