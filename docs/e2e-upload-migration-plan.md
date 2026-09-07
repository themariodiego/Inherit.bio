# Browser-suite migration after the own-upload cutover

## Latest integration · 2026-09-07

The actual-provider bootstrap is integrated into the standard runner, with both
projects and the paused server retained. Six report/source specs use explicit
source-only or selected-report preconditions. Runtime `5ee7121` has passing
evidence for each of 65 selected cases across the `f3e21cc`, `c76a4bf` and
`5c2c194` runs after test-only corrections, including actual two-source ZIP
content and post-withdrawal raw access. The failed runs and scope are retained
in [the local receipt](local-upload-browser-verification.md); this is not one
passing 65-case run. Discovery is **226 cases in 43 files**, not 226 passes. Remaining legacy
`ingestFileAs` invocations are **14 in 12 spec files**. The older checkpoint and
callsite list below describe their dated revision. Whole-plan acceptance remains
**18/65**.

2026-09-06 checkpoint at `9b45b75`. The local actual-provider runner passes
**24/24 cases in nine specs**, with 18 uploads and zero skips/retries. See
[the receipt](local-upload-browser-verification.md). Standard discovery finds
**225 cases in 42 files**; that entire suite has not passed on this branch.
`ingestFileAs` still has **21 calls in 18 spec files**. An affected-file count
is not a count of demonstrated failures. Acceptance remains **18/65**.

## Migrated and verified

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
   and deletion-export cases need canonical setup while preserving lifecycle
   and physical removal evidence. Their bounded migration is underway.
   The separate other-adult deletion fixture remains unsupported and unchanged.
2. **Connected surfaces:** the old Overview case still needs its ancestry
   computation prerequisite. Copilot's legacy file/genotype loaders,
   independent cloud-model consent and source-bound tool authorization remain
   runtime work. Its 64 shared-output cases use scoped provider mocks, not
   proof of a real external model.
3. **Required notifications:** canonical synchronous generation still lacks
   the durable report-ready mail contract. Retain mail-expiry and deletion
   invalidation assertions until implemented; generation success alone does
   not prove a notice was queued or expired correctly.
4. **Ancestry and shared results:** the dispatcher supports monogenic and
   polygenic only. Ancestry/lineage, adult shared/joint results and Health
   Picture ROH computation need real authorized generation. A saved purpose
   is not a computed result. Modern own reads do not authorize recipients.
5. **Embryos and Tier-2:** existing empty/denied embryo surface cases do not
   prove either positive uploader path, QC, publication or comparisons. BAM's
   old resumable path is unsupported by canonical own declaration; do not
   restore ordinary-login Storage access to pass that test.

For same-origin transport prefer browser-native requests or navigation response
bodies. The reviewed standard runner now keeps APIRequest/`route.fetch` direct
HTTP and manual Chromium contexts inherit the proxy. Do not invent native
Sec-Fetch headers for `route.fetch`; preserve SSR-denial and mutation evidence.
Keep no-file recovery, public/legal and jurisdiction-denial cases independent
of analytic grants.

## Remaining helper call sites

All paths below are under `e2e/`; these are invocation lines, not imports.

```text
account-deletion-purge:22    ancestry:75
copilot-output:50           copilot-refusal:136
copilot:85                  deletion-export:23,34
family-health-picture:402   family:287
file-deletion:11,84         mail-expiry:16
overview:233                portrait:339
```

The deliberate legacy victim in `rls.spec.ts` is an isolation fixture, not
canonical upload readiness. Preserve the legacy positive/negative tests and
migrate their runtime prerequisites in bounded batches; do not skip them to
claim a full green run.
