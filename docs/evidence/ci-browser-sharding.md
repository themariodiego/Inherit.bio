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

The repository job independently discovers the complete standard case set.
Each shard independently repeats full discovery and native assigned discovery,
then requires exactly one passed, retry-zero execution for each assigned case.
Aggregation proves expected = assigned = executed, with exactly-once coverage.
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
