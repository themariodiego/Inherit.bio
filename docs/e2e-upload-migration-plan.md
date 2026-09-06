# Browser-suite migration after the own-upload cutover

2026-09-06. Read-only source audit and test discovery, not a full-suite run.
The verified local receipt remains **53b630c: 3/3 cases**, not full-plan
acceptance. No runtime, database or test assertions changed for this audit.

## Inventory

Discovery finds **222 cases: 219 Chromium and 3 jurisdiction-off**.
`ingestFileAs` has **29 call sites across 22 spec files** containing 161
registered cases. That is the affected-file footprint, **not 161 proven
failures**: several cases are independent no-file checks; other serial cases
depend on an earlier upload. `copilot-output.spec.ts` alone has 64 cases
sharing one upload in `beforeAll`.

The central incompatible assertion is `e2e/helpers.ts:176`: normalization
must be followed by `status === "annotated"`. New sources correctly remain
`stored`, with source-bound normalization and independent completed-purpose
records. Six spec files repeat that assumption: ancestry:85,
family-health-picture:415, family:306, genome-data:71, overview:255 and
portrait:348. `file-deletion.spec.ts:90` also forcibly restores `annotated`;
restore its actual prior status when testing the processing refusal instead.
The deliberately planted legacy victim in `rls.spec.ts:51` is a separate
isolation fixture, not evidence of a real upload; do not silently present it
as canonical readiness.

## Smallest honest helper/harness migration

1. **Make the actual provider harness reusable before running upload cases.**
   Standard `pnpm e2e` runs `playwright.config.ts`; it supplies neither the
   ephemeral own-upload signer nor matching Storage trust. The verified
   `playwright.upload.config.ts`/`run-upload-browser.mts` is local-only and
   selects three cases. Extend its explicitly scoped selection first; a
   separate reviewed CI bootstrap is needed before claiming full CI support.
   Keep no-skip/no-retry checks and real Storage authorization. Do not merely
   remove the local harness's CI refusal or rotate shared Auth keys.
2. **Split preparation from result readiness.** A prepare-only helper uses the
   real account, insurance, own-storage checkbox and picker, then verifies
   source revision and canonical normalization. It never grants a report.
   A chosen-report helper requires an explicit nonempty purpose argument,
   uses real choice checkboxes/Enable buttons, selects the exact new file,
   calls Generate, and verifies exact-purpose/source completion. No default
   “all purposes,” direct grant inserts or fabricated annotation.
3. **Handle existing choices honestly.** Repeated uploads in one account can
   legitimately return `processed` immediately because an earlier explicit
   choice is still live. Parse the strict processing receipt union and verify
   its declared purpose/source; do not require `not_generated` for every
   subsequent upload. Re-resolve refreshed controls between signatures and
   verify the selected file when the file chooser is present.
4. **Preserve real browser transport and denial evidence.** Use navigation
   response bodies for SSR leak checks and browser-native fetch/clicks for
   same-origin state changes. `page.request` and `route.fetch` use CONNECT
   under this proxy and can print cookies on failure. Relevant existing
   callers include report-gate:55/182/190, file-deletion:47,
   mail-expiry:33, observed-reference-calls:39 and copilot-output:45.
   Manually created browser contexts must inherit the real upload proxy.
   Use actual Download links and scope Search to its intended form.

## Prioritized batches

| Priority | Bounded scope | Readiness and required work |
| --- | --- | --- |
| 1 — useful own reports | **16 result-dependent cases**: report-library-recovery's partial-coverage case (1), behavior-study-scope (4), report-previews excluding its no-file case (6), report-gate (5). | Explicit `reports.polygenic`; preserve real genotype, source, conflicting-input, sensitive-reveal and SSR-denial assertions. These use the already implemented own-report path. The array second-upload case needs the existing-choice receipt handling above. This is a candidate batch, not a passing-test prediction. |
| 2 — observed variants and report presentation | report-skeleton (8 registered cases; only two direct upload sites, estimate:208 and Medicines:544). | Choose polygenic for estimates and monogenic for Medicines; do not grant both unless a case actually needs both. Keep no-file cases independent. Additional choice-panel controls may require truthful screen-budget accounting, not raising caps blindly. |
| 3 — source control and provenance | genome-data (5), network-audit's browser case (1), account-deletion-purge (1), file-deletion (2), deletion-export (2), observed-reference-calls (1), plus upload-vcf (4). | Most raw-data preconditions need only preparation. Export's report assertions require explicit chosen reports. Deletion tests also assume original filenames, incomplete-account UI, legacy process responses and a report-ready mail row; split independent deletion evidence from the still-required mail contract rather than deleting the mail assertion. Large benchmark/provenance cases need the missing source-manifest presentation work below. |
| 4 — connected product surfaces | Overview, report counts, Copilot and adult sharing. | Genuine runtime integrations remain; helper migration alone is insufficient. Keep the dependencies visible below. |

The two empty-library recovery cases, public/legal content, no-provider
Copilot setup, and jurisdiction-denial checks do not need analytic grants.
Do not make them slower or more privileged by uploading a fixture everywhere.

## Real blockers, not test-only cleanup

- **Overview:** `overview/page.tsx:158-182` still chooses populated states and
  `hasReports` from `annotated` files; its starter results use the legacy
  genotype loader. This blocks the populated Overview case and the real
  report-counts journey. Port it to exact live chosen-result readiness;
  preserve purpose withdrawal and do not equate `stored` with reports ready.
- **Source provenance:** normalization writes canonical private manifests,
  not the old public ingest snapshot / `observed_call_sha256` fields.
  `observed-reference-calls.spec.ts:34` pins those legacy fields;
  genome-data and upload-vcf require recorded build conversion and exact
  input-rate figures. The successful new report currently states these
  unrecorded facts are unavailable. Wire truthful canonical provenance before
  claiming the old assertions pass; do not invent snapshots or remove them.
- **Copilot:** 68 registered cases across copilot, copilot-refusal and
  copilot-output, including the 64-case shared setup. `api/chat/route.ts:237`
  and its tools still call `getSubjectProcessedFiles` /
  `getSubjectGenotypesByRsid`, which exclude new stored sources. Cloud-model
  consent is independent of report purpose. Port the exact tool/data access
  contract; retain provider mocks only as explicitly scoped output-gate
  fixtures, never as proof of a real external model or all-scope acceptance.
- **Report-ready mail:** own synchronous generation currently enqueues no
  report-ready notice. `mail-expiry.spec.ts` (1 case) and the first deletion
  case require one real durable notice and its invalidation/expiry behavior.
  Adding a report choice does not implement that contract.
- **Ancestry:** both ancestry.spec cases plus the final upload-vcf case need
  computed ancestry/lineage outputs. The own dispatcher supports only
  monogenic/polygenic purposes; saving Ancestry explicitly does not generate
  it yet. Keep these three positive/limited-result journeys blocked on real
  independent ancestry computation, not preseeded outputs or a blanket grant.
- **Adult sharing / joint computations:** family (6), family-health-picture
  (10), portrait (10) contain positive-result dependencies. Their self-upload
  stages can migrate, but modern report reads currently authorize the own
  account only, and shared/joint genotype loaders still require annotation.
  Health-picture additionally expects automatically measured ROH at:417-440;
  the own dispatcher does not run that operation. Directional recipient,
  joint-purpose and source-bound computation work remains. Some current
  invitation/refusal/UI checks can still run independently; **26 is a file
  footprint, not 26 demonstrated failures**.
- **Embryos:** 10 Chromium surface cases and 3 jurisdiction-off cases are
  intentionally empty, consent-required or denied-state tests with synthetic
  cohort fixtures. They do not use `ingestFileAs` and do not prove embryo
  upload, complete consent, QC, generation or comparison. Full positive
  embryo journeys remain separate unimplemented work, not a helper fix.
- **Tier-2 BAM:** the one tier2-upload case expects the old resumable TUS
  path. The canonical own upload declaration currently excludes BAM. Do not
  re-enable the old ordinary-login upload as a test workaround.

## Exact ingest call-site map

All paths below are under `e2e/`; numbers identify invocation lines, not
imports. Cases may share a setup or execute a call inside a loop.

```text
account-deletion-purge:22     ancestry:75
behavior-study-scope:26       copilot-output:50
copilot-refusal:136           copilot:85
deletion-export:23,34         family-health-picture:402
family:287                   file-deletion:11,84
genome-data:55                legal:209
mail-expiry:16                network-audit:119
observed-reference-calls:30   overview:233
portrait:339                 report-counts:23
report-gate:45,177            report-library-recovery:75
report-previews:43,95,103,127  report-skeleton:208,544
```

Do not skip these tests to claim a full green run. Ship and report a bounded
passing batch, keep the remaining contracts explicit, then migrate each
runtime dependency with its own positive and denial evidence.
