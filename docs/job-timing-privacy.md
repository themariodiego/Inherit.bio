# Job timing aggregate contract

The brief's turnaround contract requires `job_time_stats(p_kind)` to return
only `n_bucket`, `p50_seconds` and `p95_seconds` over the trailing 90 days.
The previous exact-count, p90, 30-day response did not satisfy that contract.
The earlier decision to suppress percentiles below twenty did not authorize
the exact counts or the different quantile and window.

The forward migration retains the RPC name and argument. PostgreSQL requires
dropping and recreating a function when its table return type changes; both
operations and the restored grants run in one transaction. There are no
tracked application consumers. Generated types and the original empty-count
test now use the safe shape. This is intentionally not response-compatible
with clients expecting an exact count: that disclosure is removed, not kept
behind a deprecated alias. No new consumer or timing copy is introduced.

The allowlist is the three embryo/family job kinds in
`docs/route-register.json`'s worker dispatch registry: `split_cohort_vcf`,
`score_embryo`, `compute_portrait`. Other kinds, including lifecycle purges,
are refused. Only complete, non-partial `done` jobs with valid, finite,
nonnegative, integer-representable durations and nonfuture completion times
are included. The lower 90-day boundary is exclusive, the upper boundary is
inclusive. If `started_at` is absent, the existing creation-to-finish fallback
is retained. Both percentiles are null below twenty eligible jobs. Counts are
always one of `<20`, `20-99`, `100+`, never exact.

The definer function deliberately aggregates across accounts without granting
raw job access. Its search path is fixed; PUBLIC and anonymous execution are
revoked; authenticated calls require a user claim. Service-role execution
retains the same bucketed response. These buckets are a disclosure limit,
not a claim of differential privacy or twenty distinct people. A hosted
advisor may still flag the intentionally exposed definer function: do not
change it to invoker and silently change the aggregate's scope merely to
remove a warning.

## Verification and remaining settings

The new pgTAP suite covers bucket edges, both suppressed fields, exact
quantile semantics, the 90-day boundary, malformed/nonterminal/partial jobs,
the allowlist, actual role calls, and rejection of legacy projections. All
141 existing cohort assertions are retained; the empty exact-count assertion
now checks the required indistinguishable small-sample bucket. Local tests
use a disposable database, not a reset of the shared development database.

Local verification: 38 new and 141 existing pgTAP assertions passed in
`inherit_job_timing_verify_20260905`, a separate database on the isolated
local verification container at port 54342. Only schema and five static seed
registries were copied. The 1,444-test unit suite, typecheck, targeted lint,
readability, name and secret gates passed. The CLI's local security-advisor
check returned no issues; this is not a hosted-advisor result.

The brief's future p95 display wording says “nine in ten”, which describes
p90. Resolve that copy before adding a consumer; do not mislabel p95.

Leaked-password protection remains unchanged. Official Supabase guidance
requires Pro or above and configures it through Auth's Email settings
(`password_hibp_enabled`). Eligibility and approval of its external
password-hash-prefix check remain rollout checks; an upgrade is not assumed.
The check sends a short hash prefix rather than plaintext or the full hash.
See [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
and the [Supabase client implementation](https://github.com/supabase/hibp/blob/main/pwned.go),
read 2026-09-05. No hosted password configuration was changed.
