# Local canonical upload browser boundary checks

## Exact-route performance gate · 8 September 2026

**G1.14 passes at `60c122ecaeec712583c2abd338a23b9629162999`.** Fresh isolated
Linux production build `xB2bE6fs2ZV80Ri_IVt9S`, installed local schema 79,
one actual synthetic provider upload and UI-selected report generation.
Node-native Lighthouse uses the real signed-in session and audits exactly
three pages, with three cold-cache navigations per page:

| Page | Performance runs | Performance median | Accessibility, every run |
| --- | --- | --- | --- |
| `/` | 98, 96, 96 | 96 | 100 |
| `/overview` | 98, 98, 98 | 98 | 100 |
| Caffeine report, exact uploaded source | 97, 97, 97 | 97 | 100 |

Every navigation verifies the exact requested/final URL, actual Document 200
and content on the measured tab. The report contains the uploaded A/C call
and its source provenance. The wrapper passes with zero skips/retries; the
actual Storage transport gate records one upload. Independent receipt review
confirms the original route, category and three-run contract. Whole-plan
acceptance increases **18/65 → 19/65** for G1.14 only. This does not establish
full-route accessibility, G1.16 integration CI or public-hosted performance.

The landing page, privacy page and provider directory also now describe the
actual accepted array/VCF/gVCF inputs. BAM/CRAM/FASTQ are refused, and supported
files do not promise that every report has coverage. Scoped lint, readability
and six actual rendered-format checks pass before the frozen build.

Evidence in the parent task:
`work/lighthouse-runtime-adapter/run-2026-09-07T22-49-57-291Z/`
contains the source/runtime hash preflight, sanitized nine-run scores,
completion/build ID, Playwright result and real-provider receipt. Existing
font bytes are served locally during the offline build. Mail/job credentials
are blank; no global worker, external model or hosted mutation ran. Preparation
corrected the firewall binary path and Docker Desktop port-proxy preflight
before the single successful build/audit; setup checks are not score samples.



Before publication, the unpushed test fixture was corrected to construct its
synthetic credential-bearing proxy URL through URL fields. Its rejection
assertion and all 13 Lighthouse unit checks remain. Rewritten code commit
`2623709` differs from audited `60c122e` only in that test file; all application
and audit runtime bytes are identical. The post-audit equivalence receipt is
saved beside the scores. Original audit IDs/build evidence are preserved.

## Latest complete PR76 CI · 8 September 2026

CI `34168400683` passes at `e97fa21aafc2e862061f9f95aaec4319bd154869`,
completed 2026-09-07T23:18:32Z: **3,190 units / 202 files**, **1,944 SQL
assertions / 52 fixtures**, **30 lock checks**, all static gates and the
production build, **232/232 browser cases**, **57 actual Storage uploads**,
zero skips/retries, all cleanup successful. Evidence in the parent task:
`work/ci-34168400683-terminal/`. The subsequent integration of separately
released PR77 changes only reserved dummy hosts in the already-tested auth
helper/tests; 53 focused checks pass again. A new exact-head CI is required.

## Complete CI checkpoint · 8 September 2026

CI `34167007160` is **SUCCESS** at `fcfcb3908c839dc516a65bfa812983c49b5ec069`,
completed 2026-09-07T22:52:36Z. It passes **3,177 units / 201 files**,
**52 pgTAP fixtures / 1,944 assertions**, **30 independent-session lock
checks**, all static gates, the production build and **232/232 browser
cases** with **57 actual Storage uploads**, zero skips/retries. Both owned
cleanup steps succeed. This verifies the research-digest correction and
local authentication-return protection in the full suite. The subsequent
Lighthouse/copy commits require their own CI run; this result belongs only
to `fcfcb390`. Parent-task evidence: `work/ci-34167007160-terminal/`.
No public merge or hosted application cutover is implied.

## Full CI browser checkpoint · 8 September 2026

CI `34164082107` at `f0ab225` passed 3,122 unit tests, 52 SQL fixtures / 1,944
assertions, static gates and the production build. The actual isolated Storage
browser run passed **231/232** cases with one research-digest delivery failure.
The namespace startup correction now reaches and completes the full suite.

The research test assumed one global mail batch necessarily included its digest.
A focused route regression proves 25 older ready notices occupy the first batch,
leaving the digest for the next. The original CI queue count was not captured,
so backlog remains an inferred cause pending rerun. Reviewed change `3504fc6`
retains the positive recipient/content delivery assertion and permits at most ten
successful batches, stopping on delivery failure, no progress or no remaining
due work. It does not change the production worker, SQL, queue order or batch
limit. Seventeen focused route/enqueue tests pass; all three research cases
remain. Full CI rerun is pending. Failed log is preserved at
`work/ci-34164082107-failed.log` in the parent task.

2026-09-07. **Local own-account chosen-trait journey verified; not full-plan or hosted acceptance.**
Full-plan acceptance stays 18/65. Browser evidence here uses only local synthetic
or public reference files. Separate hosted schema staging is recorded in the
hosted-readiness ledger; no real user file was used for these checks.

## Health Picture and Family checkpoint · 7 September 2026

**Latest complete receipt (V4):** `7ebabc5`, fresh build
`ZtFdEBSPtsfwjGkWXRtjE`, **16/16 cases passed**, zero skips/retries and
**three actual provider uploads**; the aggregate upload gate passed. The ten
Health Picture and six Family cases run together on the owned synthetic local
stack. The journey includes independent uploads and chosen report generation,
actual invitation acceptance, freshly signed sharing, the session gate,
source-attributed saved calls, actual own/shared exact-source detail navigation,
input provenance, per-layer withdrawal and joint withdrawal. Own sources and
independently live purposes survive withdrawal. It does not prove third-party
upload/quarantine or clinical computation.

All five desktop/phone captures were inspected. The final presentation keeps
320-pixel result columns, visible You/Invited adult labels and a keyboard-focusable
horizontal region. Broad accessibility acceptance is still open. Evidence:
`work/canonical-health-picture-verification-v4/{run-once.log,run-once-receipt.json,run-once-results/}`
and the five `health-picture-*.png` files alongside them.

Preserved earlier boundaries: V2 at `40147f7` had **8 passed, 1 failed,
7 not run** after successful own-source URL, A/C and provenance assertions.
It incorrectly requested Tier-2 acknowledgment again on return in the same
session. The test-only correction navigates back and waits for the table;
initial gate assertions and timeouts remain unchanged. V3 at `1288dc9` then
passed all 16 using the unchanged `40147f7` build
`9wfpsXopRKhpGPvS0rk9B`, with three uploads and no skips/retries. Its visual
review exposed narrow columns and missing visible source-owner labels; V4
verifies their correction in a fresh build. Keep the V2 and V3 directories;
do not relabel the failed run as a pass.

The installed local schema has 79 migrations; Health Picture contributes
46 passing SQL assertions and own captured detail 29. Full units pass 3,121
at `085dc9b`; latest focused checks pass 53 and 39 tests, and full typecheck
and readability pass at `7ebabc5`. Hosted metadata-only staging is recorded
separately. Clinical carrier/ROH, Portrait trait tables and parent lineages
remain unsupported; production stays PR75 and acceptance **18/65**.

## File deletion, Portrait and GIAB checkpoint

**Latest complete Portrait/GIAB receipt:** at `f0e1b5f`, all **14/14 cases
pass together**, zero skips/retries, **four actual provider uploads** and the
original aggregate-upload gate passing. Build `0dfBySAfzCr-qXXTXv8A7` from
`c894915` was reused after checking the actual container mount/build ID and
unchanged application inputs. All ten Portrait cases cover real independent
uploads/invitation, each adult's signed permission and acknowledgment, the
session gate, explicit unavailable clinical output, budgets/accessibility,
equal finding text and withdrawal with source preservation. All four GIAB
cases cover the byte-verbatim benchmark window, separate synthetic rsID/gene
positives, actual source attribution and genuinely computed zero-marker
ancestry with explicitly uncomputed lineages. The preceding six Family cases
passed against the same app build in their separate run.

Desktop 1280×800 and phone 390×844 full-page Portrait captures were inspected;
the available controls and unavailable scientific states remain readable.
These are permissions/refusal and source-journey proofs, not computed clinical,
registered trait-table or lineage acceptance. Evidence:
`work/canonical-portrait-giab-receipts-v2/{run-once.log,run-once-receipt.json,run-once-results/}`.
The earlier failures below remain historical evidence. Production remains PR75
and full-plan acceptance stays **18/65**.

At `001b72e`, the unchanged application build from `fb43083` ran both
file-deletion cases followed by four GIAB cases: **2 passed, 1 failed,
3 not run**, zero retries. Both deletion cases pass, including a freshly chosen
report, exact-file retention, foreign-account and active-processing refusal,
immutable canonical data and the isolated legacy other-adult guard. Five real
upload/preparation helpers completed. The failed suite exits before printing
its aggregate upload counter, so that aggregate gate is not claimed passed.
The first report toggle reached On in 787 ms; this isolated observation does
not prove the cause of the preceding intermittent refresh failures.
The GIAB failure was an exact-text selector spanning a paragraph with links;
the repaired selector, coverage scope and absent-lineage assertions are
integrated at `466f569`. Evidence: `work/canonical-file-giab-verification/`.

Portrait source readiness is integrated at `24fd51a`, with 198 focused units
across ten files, 32 SQL assertions on the installed 77-migration local stack
and complete TypeScript checks. It requires current independent endpoint
permissions and actual prepared canonical sources, while preserving exact
eligible legacy input IDs. It does not compute canonical clinical or ROH
results. Migration `20260907142213` remains local only.

Fresh container build `_tf6ylLNWorB59ER4UVmV` at `466f569` ran the ten
Portrait cases followed by four GIAB cases: **1 passed, 1 failed, 12 not run**,
zero retries. The first case proves two actual canonical uploads, invitation
delivery to local capture, B's acceptance and independent sign-in, and no
implicit report permissions. The second case failed before a grant POST:
A's test route used B's self ID instead of the invitation representative.
Read-only synthetic metadata confirmed the distinct accepted handle. Test
commit `48e41eb` derives that handle and verifies its exact A/B principal and
current binding; source, grant and pair assertions retain actual self IDs.
The ten cases remain intact. A rerun and visual budget case are pending.
Evidence: `work/canonical-portrait-giab-verification/`, including the preserved
failed run and `identity-route-diagnosis.json`.

The initial receipt incorrectly read `XBFRsLbVEhUlDTr1i22Oh` from the host's
older `.next` directory. A reuse attempt correctly rejected that ID before
starting Next or any test. The actual container mounts `.next` from the
separate writable runtime directory: its build ID and manifest timestamps
fall inside the recorded fresh-build run, with `/app` bound to the frozen
`466f569` source. The original receipt and failed reuse attempt are preserved;
the correction records exact mounts, manifest hashes and timing separately.
This is a provenance correction, not an additional passing browser run.

At `c155a78`, the corrected reuse attempt discovered all 14 cases with the
actual worker environment before starting servers. It passed the first
two-upload/invitation case and the second case's actual grant status `201`,
then timed out on Playwright's response-body read: **1 passed, 1 failed,
12 not run**, zero retries. The application refreshed the Family row without
consuming that response body. The product correction now consumes and validates
the exact purpose/artifact/version grant receipt or timestamped revocation
before refreshing, and handles transport errors visibly. Thirty focused
receipt/API tests pass, including delayed and interrupted real response streams.
The original browser receipt assertion remains intact; a new application build
and browser run are required. The earlier two pretest setup failures (wrong
host build pin and missing local worker environment) remain preserved as such.
Latest actual attempt: `work/canonical-portrait-giab-verification-v4/`.

Fresh build `0dfBySAfzCr-qXXTXv8A7` at `c894915` ran all six Family cases,
ten Portrait cases and four GIAB cases: **7 passed, 1 failed, 12 not run**,
zero retries. All Family cases and Portrait's first upload/invitation case
pass. The next Portrait case now receives the complete grant receipt and
reaches On, then finds the naming mismatch: A sees its actual “Invited adult”
handle, while the old fixture expected B's “Another adult” fallback. The
fixture now distinguishes each viewer's graph label throughout its remaining
assertions. No product naming or permission assertion changes. The three
original specs, failed result, actual container build ID and setup correction
are preserved in `work/canonical-family-portrait-giab-receipts/`. The combined
suite's aggregate upload-counter gate remains unproved because the suite fails.

GitHub CI `34137537643` at `001b72e` failed before browser execution because
one negative-test URL used a non-reserved example hostname. The replacement
uses `.invalid`; all 12 CI boundary tests and scoped lint pass with the same
rejection assertion and unchanged name gate. Actual Linux execution of the
new isolated runtime remains due. The subsequent `c155a78` run `34140491155`
passes all preceding gates, database checks and production build, but stops
before browser cases because namespace policy setup does not become ready.
Its generic error lacks the underlying command/exit diagnostics; this is an
infrastructure failure, not a passing browser run. Earlier complete-suite
failures are retained.

## Search and report-count regression verified locally

At test commit `dd70229`, both complete `report-counts` and `search` specs pass:
**7/7 cases, no skips/retries, one actual Storage upload**. The pinned production
build from `fb43083` was reused only after checking that application source and
build inputs were unchanged; subsequent differences are docs, plain-vocabulary
registration, test fixtures and local bootstrap variable naming. The build ID
and exact diff are recorded in `count-search-v1-commit.json`.

All six adversarial count mutations remain asserted. Cleanup holds the exact
injected DOM node even if React detaches it, then asserts no fixture remains
and the real page audit is clean. Keyboard opening is tested after an actual
button/Escape/focus-return cycle confirms the client has mounted; the shortcut
still starts from the page body and must focus the real search dialog. No
sleep, retry, timeout relaxation or substitute shortcut result was added.
Evidence: `work/canonical-family-runtime-adapter/count-search-v1.log`,
`count-search-v1-receipt.json` and `count-search-v1-results/`. This closes the two
local regressions found by the earlier full CI, not a complete CI pass.

## Family sharing and account deletion verified locally

At `fb43083`, **7/7 production-build browser cases pass together**, with no
skips/retries and **two actual Storage uploads** on the disposable
`inherit-family-20260907` local stack. The Family journey creates independent
A/B accounts, completes DOB and invitation acceptance through captured local
mail, uploads B's file, generates B's chosen report, and shares that layer
with A. A passes the Family gate and reads B's exact saved A/C finding.
Pause, resume and stop take effect on the next request; B retains their own
source, download and report. The account-deletion case runs the actual worker
and reaches zero residual Auth, file and grant-nonce rows.

Desktop (1280×800) and phone (390×844) Family-person and shared-report full-page
captures were inspected. Source and counterpart labels remain visible; the
phone layout has no horizontal overflow. These captures exercise the saved
result, not every Family state. Evidence: task
`work/canonical-family-runtime-adapter/run-v3-commit.json`, `run-v3-receipt.json`,
`run-v3.log` and `run-v3-results/`. Runtime code was frozen during the run.
The loopback mail relay forwards only the capture server's fixed email endpoint;
no hosted outbox, external provider, real account or paid model was used.

### Authority, regression and recovery evidence

- `9f3b4b6` adds exact directional endpoint receipts and dedicated recipient
  readers. `a892fdd` wires Family readiness, person, library and detail views.
  **40 UI/source tests**, **55 authority units**, and **48 rollback SQL
  assertions** cover captured catalogs, exact source selection, malformed and
  duplicate queries, independent legacy files, sensitive gates, unfinished
  layers and terminal withdrawal.
- Two physical-connection race probes establish that owner-purpose withdrawal
  and recipient-binding changes wait for reader locks, then invalidate the
  original captured receipt. The independent purpose remains valid. The
  temporary logical clone excludes scheduler extensions and one embryo DDL
  event trigger; application constraints, owners, ACLs and RLS are retained.
  See `work/family-shared-report-verification/concurrency-receipt.json`.
- **2,975 units in 186 files pass at `abfe326`**, zero skips, two workers.
  The earlier `a892fdd` run passed 2,970 but its five mail-capture cases stopped
  on an ignored generated CLI cache. That cache was preserved outside the
  checkout; the capture guard was unchanged. Full TypeScript and ESLint pass
  at `00944a1`; ten added disposable-project infrastructure tests pass separately.
- The fresh stack replays 74 migrations, then installs the two account-deletion
  corrections (76 total). **All 49 SQL fixtures / 1,826 assertions pass at
  `00944a1`**, before synthetic browser data. The last session-order migration
  additionally passes **43 canonical + 19 legacy assertions** and an exact
  rollback probe; this is not a claim that all 49 fixtures ran at `fb43083`.
- V1 passed all six Family cases at `00944a1`. Combined V2 at `a8f4494` failed
  account deletion and did not run the six Family cases. The worker had already
  acknowledged physical Storage removal, but an upload-session consent foreign
  key blocked database purge. `fb43083` orders owned session children before
  consents and retains Storage/lease safeguards. Its actual worker recovery
  passes: processed 1, failed 0, pending 0; only the exact failed synthetic
  account was removed, with other file fingerprints unchanged. V2 and recovery
  evidence remain in the same adapter directory.
- The preceding `3c73e3a` correction narrowly admits and purges the account's
  own signed purpose-grant nonces. It preserves foreign-owner refusals and
  requires Storage acknowledgement before removing the owned graph.

The final consolidated batch `7261259` passes **2,981 units in 187 files**,
zero skips, plus the unchanged repository/authored-history secret gate and
readability gate. The two new plain words are explicitly registered. Synthetic
negative credential URLs are constructed within tests; bootstrap references use
recognized environment-member syntax without changing validation. Only the
unpublished range after `3651a46` was consolidated. Its prior head `2226404`
and exact browser commits remain under `codex/evidence-family-pre-squash-2226404`;
the final tree is byte-identical to that preserved head. Remote history was
not rewritten. Receipts: `work/family-shared-ui-verification/full-units-final.log`,
`secret-gate-final.log`, `readability-final.log`, `unpublished-squash-receipt.json`.

These are local receipts, separate from the earlier ancestry, Copilot and
report/control runs. Complete CI and hosted delivery remain open. Production
stays PR75 and whole-plan acceptance stays **18/65**.

## Canonical ancestry and Overview verified locally

At `0e0d99e`, **5/5 ancestry and Overview browser cases pass in one isolated
production-build run**, with no skips/retries and **three actual Storage
uploads**. A one-marker VCF keeps the honest insufficient-coverage map; a
168-marker synthetic file produces the existing broad-region estimate. The
result is selected, generated and read from its checked canonical journal.
Ancestry-only readiness appears on Overview without inventing report counts.
Empty and populated Overview and phone navigation also pass. Desktop 1280×800
and phone 390×844 full-page captures were inspected in both ancestry states.
Only computed results display input-analysis provenance; both canonical parent
lineages explicitly remain uncomputed. No hosted ancestry was generated.

The final run is `work/ancestry-local-install-c4718e9/browser-v3.log` with
`browser-v3-evidence/results.json`, screenshots and `verified-commit.json` in
the same task evidence directory. V1 passed all five cases at `e3ebdb6`, but
visual review found three repeated provenance blocks implying uncomputed
lineages had been analyzed. Runtime `6f27d07` removes those two blocks. V2 then
passed the low-coverage case and failed the old expectation of three blocks;
three cases were not run. The corrected assertion requires exactly one block
inside the computed result and none under either uncomputed lineage. Typecheck
caught an undefined locator before V3; `0e0d99e` corrects it. All failed receipts
are preserved. No runtime code changed during V3.

### Database and application evidence

- **All 73 migrations replayed successfully** on a fresh isolated Postgres 17
  database, without seed dependencies. A first replay exposed two PL/pgSQL CASE
  expressions needing parentheses; `3e55025` fixes syntax only. Its failed replay
  logs and exact input snapshot remain preserved.
- **All 47 rollback SQL fixtures pass: 1,746 assertions** at `e3ebdb6`.
  The 15 affected fixtures also pass independently (583 assertions), including
  the two new ancestry fixtures (113 assertions). Fixtures now declare their
  bounded upload/catalog state and keep source revisions coherent when testing
  stale authority. No production trigger was disabled to pass an assertion.
  Evidence: `work/fresh-ancestry-replay-syntax-fixed/complete-suite-e3ebdb6`.
- The two ancestry migrations were installed only in the existing local browser
  database in one transaction. All 363 existing files, 362 Storage objects and
  120 analysis journals, their row fingerprints, migration history and existing
  function owners/privileges were preserved. Fifteen changed/new function
  definitions, owners and privileges independently match the fresh database.
  No shared database reset or history repair occurred. Evidence:
  `work/ancestry-local-install-c4718e9/install.stdout.log` and
  `function-parity.json`.
- **2,921 unit tests in 183 files pass**, with zero skips, at `e3ebdb6`, using
  two workers to avoid resource contention. Full ESLint, generated Next route
  types and TypeScript pass. The final provenance adjustment also passes full
  TypeScript and scoped lint at `0e0d99e`. Earlier failures (missing Overview
  mock, a generated CLI cache caught by the capture guard and contended fixture
  timeouts) are preserved; no timeout threshold or detector was weakened.

Independent review confirmed permanent predecessor-notice cancellation,
source-by-source export authority checks and literal VCF call orientation.
This is separate from the older 73-case Copilot and 69-case report/control
runs; it is not a combined full-suite pass. The standard suite, hosted rollout,
scientific validation and complete route coverage remain open. Production is
PR75; formal acceptance remains **18/65**.

## Current BAM/CRAM refusal contract verified locally

At `b72c1e4` (runtime/tests `e90fb69`), **2/2 browser cases pass**, with two
actual Storage uploads, no skips/retries and one isolated production build.
The browser refuses both genuine and misleading extensions without issuing a
lease. Both declaration aliases return exact 422 refusals. Deliberately declaring
a supported format obtains a real restricted upload, whose stored bytes are
independently checked; finalization returns 415 and consumes a rejected lease
with acknowledged cleanup. Both cases end with zero source objects, files,
variants, ancestry/PRS results, journals, jobs or report-ready notices.
This verifies accepted ADR0016's exclusion, not positive BAM/CRAM support.
Historical A10 success evidence and its explicit retirement remain in the test
diff register. Evidence: task `work/canonical-unsupported-reads-runtime-adapter/`
`receipt.json`, `run.log` and `gate-test-results/results.json`.

The same batch passes legal, 162-template integrity and readability gates
(2,522 blocks). The repository/history secret gate passes at `b72c1e4`:
1,125 tracked files and 368 authored commits. The public name scan has zero
findings; the full name gate correctly fails only because the private denylist
is absent locally. Existing CI must verify that private gate; it is not waived.

## Canonical personal Copilot verified locally

At `763fbf1`, **73/73 browser cases in four specs pass in one production-build
run**, with zero failures, skips, retries or flaky cases. The actual-provider
bootstrap records **10 Storage uploads**; the HTTPS model stays synthetic and
inside the isolated runtime. Start `2026-09-07T10:42:17.416Z`, duration 325.8s.

The run proves conflicting/missing/ungenerated sources, exact captured report
citations, saved-history reopening without another model request, all 64 existing
output-safeguard cases, input refusals with zero model calls, live report/Copilot
withdrawal, model changes and source deletion that preserves an independent file
and conversation. Report withdrawal refuses and physically removes the exact
paired history; regrant cannot revive it. Desktop 1280×900 and mobile 390×844
screenshots were inspected: readable answers/citations, accessible visible
history/permission controls and no horizontal overflow. Refusal accessibility
assertions in both themes pass within the same run.

Evidence: task `work/canonical-copilot-sql-verification/integrated-browser-v9.log`
and `browser-v9-evidence/results.json`, with desktop/mobile PNGs in that evidence
directory. The integrated runtime also passes **2,811 unit tests in 181 files** and full
ESLint with zero warnings (`integrated-units-763fbf1.log` and
`integrated-lint-763fbf1.log`). No runtime source changed during those checks;
only this progress ledger was updated. The complete standard suite discovers
**231 cases in 44 files**;
that suite has not run successfully on this branch. The three migrations remain
local; full-plan acceptance is **18/65** and production remains PR75. This is
local Copilot evidence, not the full 80-case multi-scope evaluation or hosted
model/notification/cleanup verification.

### Integration and repair history

At `5d2afc7`, personal chat uses the actual current provider permission, prepared
source snapshot, selected completed reports, captured citations and server-owned
history. Permission dispatch now reaches the canonical handler; the interface
consumes and validates the exact grant/withdrawal receipt before reporting success.

The three Copilot-authority, chat-content and catalog-snapshot migrations were
installed locally after **212 rollback-only SQL assertions** passed. Subsequent
review found that the chat migration could block the public application's
selected-file deletion merely because historical chats existed. The correction
preserves truly unattributed historical content and still rejects partial
canonical provenance. Its affected chat, report-purge and file-deletion fixtures
pass **64 + 41 + 21 assertions**. The local correction preserved files, Storage
objects, catalog, users, chats, messages, migration history and deletion-function
owners/ACLs exactly. An initial rollback fixture needed the same temporary owner
normalization as the previous local SQL harness; that ownership change rolled back.

The integrated runtime `0003d87` passes **2,808 units in 181 files**, full lint,
and the focused missing-report correction passes typecheck. The receipt UI
also passed typecheck. Readability passes 2,518 blocks after simplifying setup
copy and registering three ordinary control words; its thresholds are unchanged.

The isolated production build succeeds with cached, hash-checked original font
assets. The synthetic HTTPS model is inside an egress-restricted container;
actual local Auth/PostgREST/Storage remain in the flow. No external model or
hosted service is called. Browser attempt v4 proved the actual 201 grant and
success UI but stalled while inspecting its unread response body. After the UI
receipt correction, v5 completed the conflict and missing-position answers;
the third question exposed a false refusal for an accurate ungenerated-report
explanation. The guard was correctly checking the number in the model's lookup
slug, but the unavailable-result tool had omitted that identity. `0003d87`
acknowledges only an exact published catalog slug, without borrowing scientific
metadata; unknown and fixture slugs remain unacknowledged. Guard rules and all
64 output fixtures are unchanged.

Attempt v6 passes that complete three-question case. The withdrawal case reaches
the actual 403 response, but the client cancels its body before refreshing, so
the browser inspector loses the body needed by the exact assertion. Native
response capture was corrected by test-only `6f066f1`: a one-shot observer reads
only a bounded clone while returning the original native Response to the app.
An isolated native Playwright proof and independent review confirm one unchanged
request, exact response bytes and cleanup without substituted responses.

Attempt v7 at `6f066f1` passes the production build, the complete three-question
case and the withdrawal response's exact 403/body/provider-call assertions. It
then finds a runtime defect: after synchronous report cleanup removes both
messages, history returns 200 with an empty list rather than refusing the purged
conversation. The canonical SQL reader's mismatch check accepts an empty set;
list/history/append must reject that empty canonical conversation. The run stops
with **1 passed, 1 failed and 71 not run**. Its failed assertion is retained.
**73-case browser acceptance is not claimed**. Failure receipts are preserved
under task evidence `work/canonical-copilot-sql-verification/browser-v4-evidence`,
`browser-v5-evidence`, `browser-v6-evidence` and `browser-v7-evidence`.

Repair `c4e414d` requires surviving canonical messages for list/history/append
and rejects empty histories at the application boundary. The new SQL fixture
reproduces seven failures with the prior function (70 passing assertions), then
passes all **77 assertions** with the correction, including a new two-turn
conversation after purge. Both runs roll back. Only the reviewed private
chat-dispatcher function was subsequently replaced locally; before/after data,
migration-history and owner/ACL fingerprints match. Focused application tests
pass 30 cases with lint/typecheck; no full-unit rerun is claimed for this repair.

Attempt v8 at `c4e414d` passes exact refusal, history denial, physical message
removal, immutable purge membership and retained raw-source checks. Its late raw
lookup assertion expects the legacy `AC` spelling while the canonical reader
correctly returns `A/C`, as its existing unit contract requires. The two raw
lookup assertions in invalidation/output specs are corrected to that exact
value; the separate captured report outcome remains `AC`. The 64 model-output
fixtures and all meaningful source/refusal assertions stay unchanged. V8 ends
with **1 passed, 1 failed and 71 not run**; evidence is retained in
`work/canonical-copilot-sql-verification/browser-v8-evidence`. The next complete
browser run remains required.

No PR merged or public deployment changed. Hosted permission/cleanup rollout,
required notice delivery, full regression integration and complete Copilot
evaluation remain open. The older snapshot-only checkpoint below is historical;
its "not persisted" statement describes that earlier run.

## In-progress Copilot prerequisite: captured report references

2026-09-07: new own-report generation now captures the exact selected public
template (description, evidence, variants and citations). An additive completion
trigger locks the published references, rejects changed/substituted inputs and
adds a database-generated SHA-256 revision. Completed result content is immutable.
Personal JSON and printable exports use that captured reference; historical
results without it retain their explicit missing-metadata explanation. Nothing
is backfilled from the current catalog.

Focused application verification passes **33 tests in three files**, including
every seed template's round trip and mismatched report/purpose rejection. The
extended `supabase/tests/own_report_generation.sql` passes **46 assertions** with
the new migration inside one rollback-only transaction on the local stack;
post-rollback checks confirm both the migration and synthetic identity are absent.
Scoped ESLint and diff checks pass. Independent SQL review found no blocking issue.
Task evidence: `work/catalog-snapshot-verification/rollback-verification.log`.

This is an implemented, focused-verified prerequisite, not an integrated Copilot
browser receipt. No migration was persisted or hosted change made. Install the
additive migration before enabling the new writer, and deploy snapshot-aware
readers with it: an older strict canonical export reader cannot consume newly
snapshotted results. Any rollback build must retain those readers. Production
remains PR75 and full-plan acceptance **18/65**.

## Latest verified checkpoint

At `6e9acd6`, one production-build run passes **69/69 cases in 20 specs**,
with zero skips, retries or flaky cases and **33 actual provider uploads**.
Start: `2026-09-07T07:14:29.933Z`; duration: 388.6 seconds. The earlier
65-case scope now passes together with canonical ready-mail expiry/replay,
three-page export, account deletion notice/cancellation and first self-file
deletion. Account purge and the unsupported other-adult deletion case were
outside this selected run; the full standard discovery remains 226 cases.

The canonical notice runtime at `6c25379` also passes **2,702 units in 171
files**, typecheck, and a fresh **68-migration / 299-assertion** SQL gate.
Only the pagination test input changed between those commits. The new local
migration preserved existing fixture counts and migration history. One older
local guard had a different owner; its temporary transaction-local ownership
transfer was restored with the original ACL before commit. New functions
remain owned by `postgres`. Hosted schema and public deployment were unchanged
during this local run; the later additive hosted staging and protected candidate
verification are recorded in `hosted-own-upload-readiness.md`.

The first five-case browser attempt passed mail expiry, own export and file
deletion, but the old compressed HG001 input expanded to 99,744,915 bytes,
above the configured 52,428,800-byte decoded limit. Its 413 was correct;
the following serial cancellation case did not run. A deterministic synthetic
gzip now supplies 2,005 distinct calls across three pages (5,460 compressed /
92,573 decoded bytes). Exact CSV rows, original bytes, decoded bytes and both
source hashes are verified. Existing files, runtime limits and other assertions
were preserved. Failed and successful JSON receipts remain in task evidence.

This closes the local own-notice/export/control checkpoint. It does not prove
provider delivery, scheduled hosted cleanup, full CI or whole-plan acceptance.

## Previous export checkpoint

The integrated runtime at `5ee7121` now has passing evidence for every case
in the selected 65-case, 17-spec set, across documented runs after test-only
corrections. This is not a single passing 65-case run or the full 226-case gate:

| Test revision | Result | Scope / correction |
| --- | --- | --- |
| `f3e21cc` | 57 pass, 3 fail, 5 not run | Actual-provider integration; reused synthetic accounts and older-source selection helper failed. |
| `c76a4bf` | 6 pass, 1 fail | Fresh accounts and semantic combobox selection; export and five network cases pass. Legal card lookup still used an obsolete name. |
| `5c2c194` | 2 pass, no skips/retries | Exact disclaimer on the actual personal report and the remaining legal-page network case pass; one native upload crossed actual Storage. |

The retained JSON reports were compared by file, test title and project:
65 unique cases each have a latest passing result with no retry. The helper
now checks the selected UUID before generating, alongside its exact process
response and private source/grant journal checks. Scoped reproduction showed
the old label lookup skipped the dropdown; no product selection defect or
arbitrary timing workaround was found. Earlier failed receipts remain recorded.

The new export case downloads real ZIPs before report choice, after generating
only the older of two sources, and after withdrawal. Both original byte arrays,
normalized rows and observed calls match throughout; generated JSON/text retain
captured interpretations without borrowing current catalog metadata. Only the
selected source has findings; withdrawn reports and PRS disappear while raw
access remains. Synchronous content verification does not close the registered
large-export delivery lifecycle. Production remains PR75 and the older protected
canary; these export/cleanup changes are not hosted yet.

## Previous pause checkpoint

At `9b45b75027e5201ef6d2653b34876ac62e0af805`, the expanded **24/24 cases**
pass with zero skips, retries or flaky cases: start `2026-09-06T17:57:03.042Z`,
155.3 seconds, **18 actual provider uploads**. This source changes only test
selectors and this register after `a8d82b5`, where all **2,661 units in 166
files** passed. No runtime code changed between those receipts.

The ninth selected spec proves canonical issuance pause on both entry pages
and both API aliases. Refused issuance and an already-open page's actual
paused-server response create no leases, source rows or Storage objects.
A real second upload is interrupted only after Storage acknowledgment, then
finalizes and prepares through native requests to the paused app. Both files
download exactly; the earlier source remains unchanged, the staging object
is independently absent, and report-choice/deletion controls remain available.
Desktop 1280px and mobile 390px screenshots were inspected without overflow.
The canonical pause is separate from the legacy bridge's flag; neither is
enabled on production by this test. Three local server ports closed on exit.

The first expanded run passed the previous 23 cases and stopped in the new
case because its alert locator also selected Next's route announcer. Both
alerts now select their exact messages. Independent review checked remaining
expectations against the runtime and actual local schema before the second
attempt. No byte, authority, source, cleanup or recovery assertion was relaxed.
The stale-response relay affects only app-server routing; it does not replace
authorization or Storage decisions. The standard suite discovers **225 cases
in 42 files**; this is still a selected local receipt, not full-suite acceptance.

## Previous source-provenance checkpoint

At source `5d755c934d45ecbb09747a9f2b81668c13150900`, **23/23 cases** pass
with zero skips, retries or flaky cases. Start `2026-09-06T17:12:31.941Z`,
155.5 seconds, **16 actual provider uploads**. All **2,619 unit tests in 164
files** pass on this source; typecheck and scoped lint pass. The new
service-only source projection has **32 rollback-only SQL assertions** and
no local security-advisor findings. The migration was applied transactionally
to the existing local database; no stack reset or history fabrication.

The eight selected specs cover preparation, chosen results, two-file controls,
source provenance, report-library recovery, behavior study scope, report
previews and sensitive report gates. Original positive, negative, source,
conflicting-input, privacy and SSR assertions remain. Preparation is never
promoted to legacy annotation. The standard suite still discovers 224 cases;
this is a bounded 23-case receipt, not full-suite or hosted acceptance.

Canonical source facts now read the existing private normalization journal
through current store authority or exact completed report purpose. The closed
DTO exposes build/conversion and recorded counts, never hashes, paths, claims
or private manifests. Modern sources never fall back to a legacy snapshot.
A synthetic GRCh37 file proves conversion, an observed call and an explicit
no-call; withdrawal hides analytic facts while retained source browsing works.
Report coverage stays distinct from the file-wide listed-call rate. Desktop
and 390px mobile screenshots were inspected after the wording correction.

The first 23-case attempt had 18 passes, two failures and three serial cases
not run: local public templates were stale and a synthetic array lacked the
recognized vendor header. The reference seed was refreshed locally without
altering user fixtures; the synthetic header was corrected while detection
stayed unchanged. Visual review separately caught the misleading source-rate
label, which was fixed before this final run. The initial full-unit attempts
also exposed an incomplete legacy embryo fixture and strict email checkout
hygiene: the fixture now includes its actual null canonical marker, changes
were committed, and a generated CLI cache was preserved outside the checkout.
No test was skipped or weakened. Final runner teardown left ports 3100/3101
closed and exited successfully; synthetic fixtures remain preserved.

## Previous two-file checkpoint

At source `784efbf`, the local runner passes **5/5 cases**, zero skips,
retries or flaky cases, in 57.7 seconds (start `2026-09-06T16:44:59.902Z`).
Five actual browser uploads crossed the installed Storage provider. The
four earlier journeys remain green. The additional two-file case proves:

- Two explicitly chosen polygenic results use distinct uploaded sources and
  retain the same live purpose choice across the second upload.
- Conflicting MCM6 calls suppress the result; neither file silently wins.
- Both real Download links return their exact original bytes. Prepared files
  now link back to report choices without claiming preparation is analysis.
- An intercepted deletion HTTP 503 leaves a visible retry action. The retry
  uses the real application and Storage provider and returns 204. A successful
  independent Storage list confirms the exact removed object is absent.
- The selected source and its variant, observed-call, score, ancestry and
  worker rows are gone. The other source's exact variant and score rows are
  unchanged; its original still downloads and its supported A/G finding is
  discoverable again through the library and detail.

The injected 503 proves UI recovery only; existing route units remain the
actual provider-failure injection evidence. Report-ready mail, account-wide
deletion and canonical download-session acceptance are not claimed here.
Existing legacy deletion/mail tests were retained unchanged.

Desktop and 390px screenshots were inspected. Own starter reports now appear
after My Genome and before Family/Embryos, with the existing five-item cap,
report-layer definitions and no-personal-payload/withdrawal checks intact.
Files controls fit the mobile width. Generic file names remain a usability
limitation; this test identifies controls by exact source links.

Scoped lint, typecheck and the existing 16 Overview unit tests passed. The
earlier 2,602-unit receipt is not relabelled as a fresh full-suite run. Both
local web servers and the proxy/provider runner exited. The first five-case
attempt passed the four existing cases but stopped because the new test
expected only the first sentence of the existing deletion error. The exact
expectation was corrected to include its second sentence; runtime behavior
and deletion assertions were not relaxed. Full-plan acceptance stays **18/65**.

## Prior four-case checkpoint

At source `bc31011`, `node --import tsx scripts/run-upload-browser.mts`
exits zero: **4/4 cases pass, zero skips, retries or flaky cases**, in 52.4
seconds. The run began at `2026-09-06T16:07:25.902Z`; **three actual browser
uploads** reached the installed Storage provider. The four-case coverage
below remains intact, with fresh Overview checks added to the chosen journey:

- Prepared before any report choice: **Choose reports** links to the library,
  with no personal starter link. Saving the polygenic choice alone retains
  that prepared state; no completed result is inferred from permission.
- After generation: an actual covered **Bitter taste perception** starter
  link appears in both the DOM and fresh server document, within the existing
  five-item cap. The library/detail still prove the original MCM6 milk-sugar
  finding, source, partial coverage and scientific citation.
- After purpose withdrawal: the starter link disappears from both the DOM
  and fresh document. All Overview states exclude genotype figures,
  serialized genotype fields and the known personal interpretation text.
  Existing analytic read-denial, retained-source browser and exact original
  download assertions still pass.

Desktop and 390px Overview screenshots were captured and visually inspected:
text and controls are readable without clipping. The starter list remains
below Family and Embryos; moving useful own results earlier is a future UX
priority, not a change or acceptance claim in this checkpoint.

The first Overview run at `5a06279` passed three cases but expected MCM6 in
the starter list. The real fixture covers more than five reports, and the
unchanged category/slug ordering places other covered reports first. The
test now checks the actual bitter-taste starter and the existing cap; no
runtime selection, fixture, permission or MCM6 result assertion was changed.

Full units passed separately at `bc31011`: **2,602 tests in 163 files**.
Final teardown confirms no listeners on 3100/3101, zero isolated provider
processes and normal runner/proxy exit. The generated report contains no
credential markers; traces remain disabled. This remains local own-account
verification, not hosted signing trust or whole-plan acceptance (18/65).

## Earlier four-case recovery checkpoint

At source `d782d1a`, `node --import tsx scripts/run-upload-browser.mts`
exits zero: **4/4 cases pass, zero skips, retries or flaky cases**, in 48.1
seconds. The run began at `2026-09-06T15:53:14.889Z`; **three actual browser
uploads** reached the installed Storage provider through the loopback proxy.
The earlier three journeys below still pass, with one migrated case added:

- Partial-coverage library recovery now uses the actual picker, explicit
  **Trait reports and estimates** signature, and Generate button. Read-only
  metadata proves the exact uploaded bytes/revision and only the selected,
  live polygenic grant's completed result; the file remains `stored`.
- Every previous recovery assertion is retained: MCM6 result search,
  browser Back preserving the search and results-only filter, 390px empty
  search, 44px Clear filters target, Enter restoring search focus and the
  original library, and no horizontal overflow. The case passes in 7.6s.
- The real gateway preflight permits `apikey`; the browser upload sends the
  exact existing local public API key and restricted upload bearer. Values
  are compared as booleans, never printed. This does not establish hosted
  JWT trust: only the isolated local provider trusts the ephemeral signer.

The first expanded run at `8586d27` passed the new case and two existing
cases, but failed the newly added API-key equality assertion: the test worker
read an unset environment variable while the app received the configured
local fallback. `d782d1a` aligns the expected value with that same fallback;
no runtime change, policy relaxation or assertion removal was needed.

Final teardown confirms no listeners on 3100/3101, zero isolated provider
processes and normal runner/proxy exit. The generated report has no cookie,
bearer or private-key markers; traces remain off. Scoped lint and typecheck
passed before this run. This migrates **one** legacy result-dependent case,
not the full 16-case candidate batch or the complete browser suite.

## Earlier chosen-report checkpoint

At source `53b630c`, `node --import tsx scripts/run-upload-browser.mts`
exits zero: **3/3 cases pass, zero skips, retries or flaky cases**, in 42.7
seconds. The run began at `2026-09-06T15:18:46.064Z`; **two actual browser
uploads** reached the installed Storage provider through the loopback proxy.

- Own upload: real account/consent screens, picker, restricted Storage bearer,
  finalization and source-bound preparation; stored bytes equal the original
  fixture, with no unchosen results or report-ready notice.
- Useful chosen result: `personal-previews-grch38.vcf`, only **Trait reports
  and estimates** enabled, no personal result before explicit generation,
  then the actual MCM6 milk-sugar finding (`A/G` at rs4988235), coverage of one
  of two listed positions, honest missing-input copy and PMID 11788828.
  The private completion journal contains only the selected polygenic purpose
  bound to the current source and grant. No ancestry output is generated.
- Positive owner REST reads return nonempty permitted score metadata and
  public score denominators. Requests for `raw_score` and stored `coverage`
  are refused by the existing column boundary; no permission was widened.
- Turning that report purpose off hides personal findings in fresh report
  documents/RSC and the DOM, and removes analytic REST access. The source
  stays stored: five source records remain owner-readable, an actual genome
  browser search still shows rs4988235 `A/G`, and the real **Download** link
  returns all **425 original bytes**. That download verifies the existing
  ownership-scoped endpoint, **not** canonical download-session acceptance.
- No-file report-library recovery also passes. Upload and chosen-report
  browser error assertions pass. Desktop and 390px mobile choice panels and the complete
  chosen report were captured and visually inspected.

Teardown is verified: no listeners on ports 3100/3101, zero isolated browser
provider processes, and the runner's in-process proxy closed before exit.
No cookie, refresh-token or private-signer markers remain in generated test
reports. Network traces were disabled. Earlier APIRequest diagnostics were
removed; that exact synthetic account had zero sessions and refresh tokens.
Native browser downloads avoid APIRequest's different CONNECT transport and
credential-bearing error formatter. A separate existing-file probe verified
the real Download link and exact bytes before the final integrated run.

This is a useful local vertical journey, not proof of all report purposes,
all upload formats, other-adult/embryo flows, hosted signing configuration,
real-jurisdiction launch or the complete acceptance matrix. Source-ingest
provenance fields that are not yet recorded remain explicitly unavailable.

## Earlier upload-through-preparation checkpoint

At source `294d8a0`, the production-browser runner exits zero: **2/2 cases
pass, no skips or retries**, including one actual browser upload through the
installed provider. The complete own-account sequence reaches prepared UI;
the stored file downloaded through the original, unproxied provider equals
the original fixture byte for byte. Exact source revision and normalized rows
are verified, with zero unchosen purposes, analytic results, worker jobs or
report-ready notices. The prepared screenshot was visually inspected.

The real HTTP adapter exposes a zero-byte POST as a non-null empty stream.
Finalization and normalization now check bounded EOF rather than testing only
`request.body === null`; any content or a stalled body is refused. The same
helper protects the bodyless retention route. Four helper tests and the 58
finalizer/normalizer regressions pass. Chromium did not expose the File-backed
XHR body to its debugging protocol, so byte equality is verified through the
actual stored-object download rather than an absent instrumentation field.

The clean source checkout passes **2,521 tests in 155 files** with
`corepack pnpm test --maxWorkers=2`; the secret gate passes over 1,022 tracked
files and 255 authored commits. Initial full runs found an old mock missing
the database's nullable structural-evidence field (corrected to explicit NULL)
and a five-second GIAB test timeout while two suites and a browser build ran
concurrently. With suites serialized and two workers, unchanged parser
assertions and timeout pass. No fixture was purged or assertion weakened.

That earlier checkpoint proved upload through preparation, **not selected
report generation**. The newer checkpoint above supersedes this limitation
for the single local own-account chosen-trait journey only.

## Infrastructure and scope

Run `node --import tsx scripts/run-upload-browser.mts` from the repository root.
It requires the existing local Docker stack and existing capacity policy.
It does not provision configuration, apply migrations, reset data or rotate
Auth signing keys. It refuses hosted/CI execution and existing web servers.

The runner starts another instance of the installed Storage HTTP application
inside the local Storage container. Only that instance trusts the run's
ephemeral public ES256 key. The private signing key exists in process memory
and the Next server's environment, never a key file or browser configuration.
The browser uses a loopback HTTP proxy; the Supabase URL and database issuer
remain `http://127.0.0.1:54321` and its `/auth/v1` issuer.

Browser Storage requests reach the actual provider with their original
restricted Authorization header. Other local traffic is forwarded unchanged;
external tunnels are refused. The app's server-side Storage calls still use
the normal local gateway, sharing the identical database and file backend.
There is no substituted Storage decision or seeded file row. Selected recovery
cases use app-response interception for a UI deletion failure or relay an
actual paused-server response; their resumed operations use the real provider.
The original HTTP provider harness remains separate and unchanged.

CORS is served by the normal local gateway, not the internal Storage app.
The proxy forwards OPTIONS to that gateway and relays its actual current
CORS policy onto the provider response. It does not alter the provider status
or body. Before a production build, the runner verifies a real preflight and
an actual refused, unauthenticated POST through this boundary. A successful
suite must also have at least one successful upload observed by the proxy.

The dedicated Playwright configuration disables network traces to avoid
persisting the one-use bearer. The runner closes its provider, proxy and
browser processes in `finally`. Synthetic records remain like other local
browser fixtures; no broad cleanup or deletion of existing data is performed.

## Findings and corrections

| Boundary | Evidence | Outcome |
| --- | --- | --- |
| Account completion → insurance → own-upload presentation | First run: account completion 200 and insurance signature 201, then unavailable UI. Database logged `issue_own_upload_nonce_v1` validation error before creating the third nonce. Context, artifacts and existing signature matched. | Fixed the host/database expiry race, below. |
| Browser cross-origin preflight | Second run: valid lease issued, but no Storage POST response. Direct installed provider OPTIONS returned 404 without CORS; unchanged local gateway returned 200 with its CORS headers. | Fixed test proxy gateway handling; third run passed the preflight/denied-POST checks and reached actual Storage. |
| Restricted browser upload → canonical finalization | Initial third run: synthetic session reached `uploaded`; no final object was claimed and no file was finalized. The browser's canonical `/finalize` response was 422. | Fixed by bounded zero-byte EOF handling, verified in both passing checkpoints above. Next can represent a zero-byte POST as an empty stream; non-null body alone did not prove content. |
| Empty report-library filter → recovery | Passed in all three runs; final recorded case took 1.9 seconds. Keyboard activation clears the results-only filter, restores search focus and shows the unchanged uncovered library. | Verified locally. Not a whole G gate. |

### Consent expiry race

The app minted a token expiring exactly ten minutes after its host clock;
SQL correctly rejected expiries beyond ten minutes on the database clock.
Persistent read-only clock samples put the database 2–4 milliseconds behind
the host with 1–2 millisecond round trips. A slower unskewed rollback probe
accepted both durations. With a controlled 100 millisecond host-clock lead,
the same synthetic snapshot returned SQLSTATE 22023 for ten minutes and
accepted nine minutes. Both probes rolled back; no nonce was retained.

Own consent and account-completion token lifetimes are now nine minutes;
their readers enforce that exact duration. The database ceiling remains ten
minutes. Sixty focused consent/account tests passed, including exact expiry
and clock-headroom assertions. The parent independently applied the same
headroom to report-choice presentations.

## Initial infrastructure handoff (superseded by the checkpoint above)

- `e2e/own-upload-positive.spec.ts` requires actual consent screens, picker,
  exact restricted Storage bytes, finalization, source-bound normalization,
  matching download through the original Storage endpoint, no unchosen
  analytic outputs or report-ready notice, and accurate prepared UI.
- `e2e/report-library-recovery.spec.ts` supplies the no-file recovery case.
  Its separate covered-results/Back test is not selected by this runner;
  report readiness remains an independent precondition.
- `e2e/helpers.ts` no longer sends the legacy upload declaration or ordinary
  login token to Storage. It uses current real consent screens and the picker.
  Existing report-dependent callers deliberately fail if only normalization
  completed: explicit purposes and actual report generation must be connected,
  never manufactured by setting `annotated` in a fixture.
- Scoped infrastructure lint, app typecheck and standalone MTS typecheck
  passed. The final production-browser run had **one pass and one failure**,
  no retries: the recorded finalization 422 is unresolved here. A production
  build succeeded, but this is not a passing browser-suite claim.
- Teardown was checked after the final run: ports 3100/3101 were not listening
  and no isolated browser-provider process remained in the Storage container.
  The runner exited after closing its in-process proxy.

The initial handoff's finalization and chosen-report next steps are resolved
by the passing checkpoints above. Real-jurisdiction launch, hosted signer
configuration, scheduled retention and all four upload paths remain outside
this local receipt.
