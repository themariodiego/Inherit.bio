# Jurisdiction review gate — 22 September 2026

G5.5 is a structural gate plus an operator obligation. The brief's G5.5(b)
explicitly says a build with zero permitted real jurisdictions passes.
`docs/release-checklist.md` B2 makes the same distinction. The previous matrix
row retained NO after the structural omissions were fixed because there were
no real signed decisions; that reason contradicts the governing criterion.

## Structural proof

`scripts/jurisdiction-gate.ts` checks the signed-review contract, including the
ten required reference fields, the computed scope and record path, matching
front matter, date freshness and the reviewer's final sign-off. The record
must be tracked, regular and reached without symlinked parents.
`scripts/jurisdiction-review-history.ts` checks the actual ancestor commit and
the exact historical decision after removing only the top-level `review`.
Object key order may differ; array order, strings and all other values must
agree. Missing history, invalid object types, non-ancestors and replacement
objects are refused.

The gate and history suites contain 42 tests with temporary Git repositories,
complete passing records and planted failures. Their invented records test
the gate and never enter the shipped jurisdiction catalogue.

Full CI [35717563251](https://github.com/themariodiego/Inherit.bio/actions/runs/35717563251)
passed at `bb0ef960ee87ce1a0d4d3c5a7f6f135772282395`:

- 5,349 unit tests across 324 suites.
- 3,393 database assertions across 87 files, plus independent invitation locks.
- All 500 browser cases, with no skipped cases or retries, in 53.4 minutes.
- All configured static gates, typecheck, lint, the isolated production build
  and Lighthouse. Performance medians: landing 98, Overview 93, report 92;
  accessibility 100 in all nine measurements.

After that run, the evidence and default-denial regression pass all 72
targeted tests across the gate, history, runtime resolver and matrix suites,
changed-file lint, readability and the jurisdiction gate. The earlier full
CI is not attributed to their commit.

## Shipped default

The real catalogue has 249 country codes, 12 restricted capabilities and zero
real jurisdiction entries. A read-only sweep called the actual
`resolveCapability` for every country/capability pair with
`testJurisdiction: false`. All 2,988 results were `unreviewed`. No database or
network access was involved. `src/lib/legal/jurisdictions.test.ts` repeats this
sweep against the committed catalogue and asserts every decision's source and
country code, as well as its status.

The gate also passes against the shipped file: zero signed decisions, zero
historical decisions verified, 15 dates checked, oldest 22 days on this date.
Zero is reported honestly rather than presented as a review. `next.config.ts`
refuses the test-jurisdiction flag on Vercel production; runtime tests also
prove a stored `TEST-LOCAL` value cannot enable that jurisdiction.

## Limits and row accounting

G5.5 changes to YES and the candidate matrix becomes 39 YES / 26 NO of 65.
G5.1a and G5.1b remain NO. This evidence does not prove jurisdiction declaration,
all-actor gating, professional standing, independent review or legal correctness.
No real jurisdiction, reviewer, signature or scientific determination is added.
The applicable qualified legal, clinical-genetics and safeguarding/ethics
reviews remain required before offering the corresponding restricted
capabilities. No deployment, production write or activation occurred.
