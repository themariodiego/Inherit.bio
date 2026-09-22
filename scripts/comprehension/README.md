# Comprehension execution

The rubric, task bindings, prohibited-answer patterns, budget journal and run
assessment are implemented. **The participant runner and grader isolation are not wired yet;
there are no completed simulation runs.** G3.1 and G3.3 remain NO.

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
identities and cannot skip an intervening failed run. The conductor must retain
the full history, enforce the three-revision stopping rule and preserve the
transcripts and independent-grader evidence. Those parts are not wired yet.
Test fixture answers in `assessment.test.ts` are fabricated instrument checks;
they are never comprehension results and must not enter a run artifact.

Run the local checks with:

```sh
corepack pnpm exec vitest run scripts/comprehension/
```
