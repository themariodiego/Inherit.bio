# Comprehension execution

The rubric, task bindings, persona bank, prohibited-answer patterns, accounting,
assessment and local conductor scaffold are implemented. **The conductor runs
only authored synthetic adapters. There are no completed qualifying simulation
runs, and external process isolation is unproven.** G3.1 and G3.3 remain NO.

The owner authorized two full runs (600 task simulations at minimum), their
grading and an independent 10% re-grade, with **US$50 maximum incremental spend**
on 22 September 2026. This replaced the earlier US$25 choice. The cap includes
inference, any CI charges and any required first month of the hosting plan.

## Spending boundary

`budget.ts` provides `SpendJournal`. Use one absolute journal path for the whole
authorized effort, including calibration, both runs, graders and retries. Keep
it outside the checkout. Opening an existing journal requires the exact same
approval and non-inference reserve; a new run must not get a fresh balance.

Before sending a paid request, reserve its **maximum** charge and wait for the
journal write to finish. Bound both input and all billable output tokens,
including reasoning. Use current verified prices; never assume a cache discount.
`maximumTokenCost` rounds upward to an integer millionth of a dollar. A planning
estimate or a requested output limit that excludes billable reasoning is not a
safe reservation.

Settle the reservation only after receiving complete, certain provider usage.
A timeout keeps the full reservation. Give a retry a new request id and reserve
it separately. Unknown, duplicate or oversized usage reports halt spending.
The owner process holds an exclusive lock; after a crash or uncertain journal
write, inspect the journal and provider charges before manually recovering the
lock. Do not delete or reset the journal to resume work.

The journal contains only the approved amounts and opaque request ids. It does
not contain credentials, answers, model identifiers or browser context. The
model-identity evidence policy remains an owner decision before publishing runs.

## Assessing recorded results

`assessment.ts` validates 300 task/persona records per run: 30 distinct personas
for each of the ten tasks, with a fresh session for every simulation. Missing,
duplicated or unknown records cannot shrink the denominator. It requires a
verbatim answer and a recorded blind verdict for every simulation. The caller
must prove those sessions and grading processes happened; this validator checks
the submitted records and is not evidence of a completed run by itself.

Pin the sampling seed before grading. `regradeSample` selects three answers per
task by a seeded hash, independent of their verdicts. Supply independent grades
for exactly those 30 answers. Agreement below 27/30 voids the run. Any safety or
missing-route finding from the independent grader still fails its zero-tolerance
threshold even when overall agreement is high. The deterministic prohibited
patterns remain an additional failure path.

T1–T4, T8 and T9 require 27 completed, passing responses. T9 additionally requires
at most six counted in-app actions; its entry count stays separate. Pass a full
`HumanSuccesses` record only after a real twelve-person round: a task below 10/12
raises its simulated threshold to 29/30. No human results exist yet.

`assessConsecutiveRuns` takes chronological history and checks the last two runs,
using one product revision and settings digest. It rejects reused run/session
identities and cannot skip an intervening failed run. The local conductor retains
chronological instrument history and exercises the three-revision stopping rule;
it does not turn authored adapter answers into participant evidence.
Test fixture answers in `assessment.test.ts` are fabricated instrument checks;
they are never comprehension results and must not enter a run artifact.

Run the local checks with:

```sh
corepack pnpm exec vitest run scripts/comprehension/
```

## Local conductor boundary

`loadConductorInputs` reads the committed bank, bindings, rubric, pattern file,
protocol, route register and referenced fixture bytes. `createManifest` freezes
their digests, the consumed input data, product revision, temperature, limits,
sampling seed and task variant before any adapter opens. Runtime input changes
invalidate the manifest. The detector uses that pinned pattern snapshot.

`runInstrument` accepts only `instrument-dry-run` and a
`synthetic-local-adapter`. It has no network client, endpoint configuration,
credential loader, application server or real browser adapter. Its injectable
factories are test doubles. They cannot establish OS sandboxing, network
isolation, file-system isolation, fixture readiness or provider token limits.
Fresh IDs and separate objects are checked, but those checks are not proof of
physical process independence. The returned `qualifyingEvidence` is always
false, including when the instrument's assessment is clean.

Every full dry run exercises all thirty personas on all ten tasks, with a fresh
browser handle for each pair and a fresh inference handle for every call. The
participant sees only its selected persona, the task prompt and its own current
session's visible observations/actions. A grader or independent regrader sees
only the rubric slice and verbatim answer. The rubric slice preserves the
unchanged common instructions and exact relevant task section from one source;
the source digest and deterministic selection version are pinned. Completion,
action counts, entries, persona, page content, prior verdicts and run history
are never added to a grading payload.

The browser adapter must record actual click/submit events and separately record
mailed-link/typed-URL entry. This scaffold refuses claimed confirmation
exclusions; it does not invent the real route-register instrumentation. An
independent adapter and its tests must establish those exclusions before a
qualifying run. Participant responses cannot supply their own completion flag.

## Durable instrument records

Create a new, protected directory outside every Git checkout and open it with
`InstrumentJournal.open(directory, limitMicroDollars, otherCostsMicroDollars)`.
The directory must be owned `0700`; history and spend files are owned `0600`.
The fixed `dry-history.jsonl` and `dry-spend.jsonl` names keep all runs and retries
in that instrument effort on one ledger. **These are synthetic accounting
checks, not incurred charges. Never reuse the real expense journal here.**
No transcripts are written under `docs/comprehension-runs/` by this scaffold.

Before an inference adapter is acquired, its maximum token cost is reserved and
flushed, then its unique request/process/slot identity is appended and flushed.
Only complete, bounded usage may settle a reservation. Unknown replies and
timeouts retain the maximum; a retry receives a new reservation and new process
ID. Both call admission and history replay enforce the pinned retry limit;
settings cannot change between the manifest and a call. A process whose
acquisition or closure is unresolved is not retried. A late acquired handle is
closed without invocation. No partial run can resume a previous call slot, and
no crash recovery deletes a lock or resets a balance.

The append-only history records run starts, browser-session admission, observed
frames, requested actions, verbatim answers, verdicts, session endings and the
final instrument assessment or stopped status. Partial traces and uncertain
calls stay in the history. Failed persistence halts execution and retains the
lock. Actual owner-process death leaves both locks and full outstanding
reservations for manual reconciliation; the unit suite verifies that behavior
with a killed local child process and no provider call.

Unresolved browser/process acquisition or closure records a durable stop tied
to the admitted resource identity. Finishing the run as stopped does not clear
that marker: the history lock remains, replay refuses another run or revision
closure, and no further inference is admitted. Disposal of a late handle does
not silently clear this stop. Cleanup reconciliation is external work; this
scaffold supplies no lock deletion or automatic recovery operation.

A different product revision cannot start until the previous revision is
explicitly closed in the history. Closure uses its last two full runs on the
same settings, including intervening failures. Three consecutive failed closed
revisions stop new instrument runs. This tests the stopping mechanism; actual
capability withholding still requires real transcripts and the release process.

## Qualifying execution remains blocked

`preflightQualifyingRun` always refuses live execution. Current prerequisites
include the unresolved publication policy for the required pinned inference
identity; externally enforced participant/grader isolation; the verified
production build under the test jurisdiction; complete bound T6, T7, T9 and T10
fixtures; and verified provider token/cost bounds. An authored adapter saying
that a task is ready cannot clear any of these blockers. No real participant,
human review, clinical interpretation, expense or release acceptance is inferred
from these instrument checks.
