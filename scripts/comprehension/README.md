# Comprehension execution

The rubric, task bindings, prohibited-answer patterns and budget journal are
implemented. **The participant runner and grader isolation are not wired yet;
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

Run the local checks with:

```sh
corepack pnpm exec vitest run scripts/comprehension/
```
