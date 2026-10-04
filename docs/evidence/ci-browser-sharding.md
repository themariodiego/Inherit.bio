# Full browser CI across six isolated jobs

The default CI workflow runs six native Playwright shards on separate fresh
GitHub-hosted Ubuntu machines. Each owns its Supabase database, seed, production
build, real Storage-provider bootstrap and isolated app/model runtime. No
database, build or credential-bearing runtime artifact is shared. Every shard
keeps one worker, no full parallelism, zero retries and disabled traces. Native
file/group assignment preserves existing serial fixture lifecycles.

The existing required `checks` job remains the release gate. It runs even when a
prerequisite fails and explicitly requires both `repository-checks` and the
entire browser matrix to succeed. It then requires one exact receipt from each
of the six shards on the same checkout SHA, GitHub run ID and run attempt. A
failed, cancelled, skipped, missing, stale or duplicate receipt cannot pass.
Ordinary `pnpm e2e` continues running the complete local suite.
Run `pnpm gate:browser-discovery` before every draft push. This local preflight
loads the complete standard suite and all six native partitions with synthetic
configuration. It requires the existing complete source census, exactly-once
partition coverage, whole fixture groups and accessibility placement. It starts
no browser, app or database and creates no hosted execution receipt. Real
credentials, debug hooks and optional selectors are excluded from its child
environment. A missing import therefore fails before a hosted run starts.
The owner approved complete hosted browser verification as the permanent
policy on 30 September 2026: local units, type checking, lint, all ten gates
and fresh pgTAP remain required before a draft push; the complete hosted suite
remains required on the final version before merging or a production change.

GitHub increments the run attempt on a rerun. Use **Re-run all jobs** so the
independent manifest and every shard produce fresh evidence on that attempt.
**Re-run failed jobs** cannot provide the complete same-attempt evidence and
therefore fails aggregation with an explicit rerun instruction. Evidence from
earlier attempts is never reused to make a later attempt appear complete.

Main branch protection now independently requires the `checks` status from the
GitHub Actions app (ID 15368), on an up-to-date pull request, including for
administrators. Force pushes and branch deletion are disabled. Merge commits
remain allowed and no human-review requirement is added. The live rule was
applied and reread on 30 September 2026; its exact readback is in the integrator
review directory. The six-job workflow still needs hosted execution and merge
before it becomes the default workflow.

The repository job independently discovers the complete standard case set.
Each shard independently repeats full discovery and native assigned discovery,
then requires exactly one passed, retry-zero execution for each assigned case.
Aggregation proves expected = assigned = executed, with exactly-once coverage.
Native listing reports expected=0 and skipped=the listed case count; the
validator requires those exact discovery statistics, every declared expectation
to be passed, and zero results. Actual execution instead requires the exact
passed-case count, skipped=0 and one retry-zero passed result per case. Listing
statistics cannot be accepted as evidence of an executed or skipped test.
A separate tracked-source census requires every ordinary `e2e/**/*.spec.ts`
file to appear. Only the exact documented opt-in files
`e2e/density-post-change.density.spec.ts` and `e2e/comprehension-run.spec.ts` are
excluded. A newly ignored ordinary spec fails clearly, regardless of test count.
The shared standard-project registry in `scripts/ci-browser-project-registry.ts`
must accompany every new project; an empty or unregistered project fails.

Every shard passes the unchanged real-provider denial/CORS and native/manual
browser versus direct-request transport preflight. Native shard 1 presently has
no upload journey. The original full-suite positive actual-provider-upload
invariant therefore runs at mandatory aggregation: observed counts are
nonnegative per shard and their sum must be positive. No synthetic sentinel
upload is added. Ordinary full runs and Lighthouse still require positive
actual uploads directly.

Repository checks retain full units, type check, lint, ten gates, fresh pgTAP,
invitation transition locks, seed/catalog consistency, rendered legal checks
and Lighthouse. Lighthouse uses its repository job's independently seeded
database, exact build and actual provider; it does not reuse another job's state.
Superseded pull-request runs may be cancelled. Main/release runs are never
cancelled by the concurrency policy: their concurrency group includes the
unique GitHub run ID, so one pending release cannot replace another pending
release. Pull-request groups instead use the stable PR number.

Coverage artifacts contain only fixed case IDs, relative committed spec paths,
source/run identity, actual provider-upload counts and bounded timing fields.
They contain no raw Playwright configuration, environments, stdout, errors,
attachments, traces or credentials. Failure evidence retains only synthetic
error-context Markdown and screenshots, excluding the raw JSON configuration.

The aggregate step summary records case counts and setup, build, transport
bootstrap and browser wall time for each shard, plus the ten longest file groups
by summed actual test duration. These receipts are retained for 14 days and
allow later slowdowns or imbalance to be compared without a frozen case count.
Setup includes dependency/browser installation, fresh Supabase/seed and runtime
image preparation; build measures the production build and identity receipt.
Pre-run timing input resides in private, job-owned `RUNNER_TEMP` files outside
Playwright's output directory, which native execution clears. Input carries the
exact checkout/run/attempt/shard identity and bounded integer durations; missing,
linked, permissive, stale or foreign input fails before execution and before
receipt publication. Only sanitized final coverage receipts enter artifacts.
Six independent setups/builds consume more runner minutes in exchange for
shorter wall time. The slowest indivisible fixture group and available hosted
runner concurrency still bound the gain.

Local real discovery on the installed Playwright 1.62.1 found 565 cases across
88 ordinary files, partitioned 98/100/108/74/94/91 over 4/13/20/21/19/11 files.
Those six assigned sets exactly equal full discovery once. This is discovery
evidence, not browser execution or a measured CI speedup. Exact committed-head
discovery receipts live in the integrator review directory. Full hosted CI on
the implementation remains necessary before claiming execution or timing gains.

The architecture follows [Playwright's native sharding guidance](https://playwright.dev/docs/test-sharding)
and [GitHub's job prerequisite semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs).

The first hosted run passed all 565 cases across all six jobs with zero skips
or retries, but the jobs then failed when receipt publication read timing input
that Playwright had deleted. Those failures remain failed evidence. The external
timing-input correction has a real native-cleanup regression; a complete hosted
rerun on the corrected version remains required for a green release gate and
measured speed claims. The failure receipt is retained in the integrator review
directory.


### Complete accessibility measurements · 1 October 2026

The six long accessibility measurements use separate semantic specs. Each file
keeps its complete original route, theme and viewport loops and all assertions
and limits. `accessibility-sweeps.ts` shares the read-only register/ledger/probe
helpers; `createAccessibilitySweep` gives each G1.13b file its own UUID account
and authentication closure, including when files share one serial worker. Its
original real confirmed-account/upload setup runs once before that complete
measurement. This repeats setup across four files in exchange for independent
whole-file execution. The fixed skip-link account and original setup stay with
that case in `a11y.spec.ts`.

The CI workflow, registry and strict whole-file coverage verifier are unchanged;
there is no parallel mode or file-group exception. Native discovery on the
installed Playwright 1.62.1 preserves all 565 original semantic title/project
cases, all unmoved IDs and all stateful file groups. Six explicit file moves
change their native IDs. The complete census contains 94 ordinary files and
partitions 95/99/109/76/95/91 cases, exactly once. The long measurements reach
five jobs: authenticated pages (1), target size (2), text alternatives (3),
reflow and public pages with a session (4), keyboard traversal (5). Existing
worker-fixture groups and native contiguous case-count assignment determine
placement; filenames describe the measurement rather than a job number.

These are source and discovery receipts. Full hosted execution and timing
comparison remain required. Individual complete measurement duration and
repeated setup cost still bound the improvement. Future changes must keep every
ordinary spec in the default census and every case exactly once; sanitized
file-group timing receipts show when a different complete group becomes the
bottleneck.

## Prevent long-check concentration

Six independent accessibility sweeps live in six semantic spec files. Each complete G1.13b measurement owns its own UUID account and setup closure, so sharing a serial worker cannot share its accumulated upload fixture. Their original bodies, assertions and limits are retained.

The mandatory inventory discovers the actual complete suite and all six native partitions before publishing its manifest. It requires exact case equality and whole serial project/file groups, then requires all six complete Chromium accessibility sweeps across at least three jobs with no more than two sweeps per job. The required final aggregate repeats the sweep-placement guard after validating exact-source, same-run, same-attempt execution. Missing, duplicated, subdivided or concentrated sweeps fail the check even if ordinary coverage would still be complete. Scheduling changes must preserve this guard and be measured with actual full-suite timing receipts.
