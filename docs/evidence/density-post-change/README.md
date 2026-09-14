# Post-change density evidence

This directory holds the two halves of the G2.5 relative comparison and the
row-by-row result of putting them side by side. It records a **comparison**,
not a new baseline: `docs/evidence/density-baseline/` is untouched, and the
numbers in `docs/density-baseline.json#routes` are still the macOS capture of
2026-08-31.

## What is compared

`docs/density-baseline.json#relativeComparison` maps each of the 22 baseline
routes to the surface that replaced it. Brief X6.2 sets the rule: *"where a
route has a baseline predecessor, its ink coverage is ≤ 60% of that
predecessor's"*. Every row here is scored against that 0.6, and — because the
operator has asked for a looser rule that is not signed yet — against 1.0 as
well, in `withinBriefRule` and `withinProposedRule`. Only the first is in
force — the operator was shown X6.2's clause and its rationale and kept the
60%. The result: **3 of 44 within the brief's rule, 26 of 44 within the
declined alternative, median ratio 0.9753** — and all three passes are on rows
with no honest predecessor, so among the 28 measurements whose predecessors
were real rendered pages there are **none**.

Both sides have to be measured the same way for either number to mean
anything.

**Ink coverage is a pixel measurement, so both sides must come off one
machine.** That is not a precaution; it was measured on 2026-09-14. Re-running
the frozen baseline on Linux rather than macOS moved ink coverage by a mean of
+28.5% at 390×844 and +26.5% at 1280×800 on identical markup, which is larger
than most of the differences this comparison is looking for. Every non-pixel
measure — interactive counts, visible text characters, prose element counts —
was identical across the two platforms on all 44 captures.

Both halves here ran on Linux 6.18.44 x86_64, Chromium 141.0.7390.37, Node
22.22.2, light theme, DPR 1, locale `en-US`, timezone `UTC`, service workers
blocked, at 390×844 and 1280×800.

- `baseline-linux-computed-measurements.json` — the frozen baseline commit
  `864736979c92a08ba77e8580d61946eba6864918`, re-captured on Linux through
  `scripts/density-baseline/reproduce.sh`. Its `captureEnvironment.browserName`
  reads `Google Chrome` because that string is inherited from the baseline
  contract; the version beside it, `141.0.7390.37`, is the browser that
  actually ran.
- `post-change-computed-measurements.json` — the successor surfaces, captured
  by `e2e/density-post-change.density.spec.ts` against a HEAD build on the real
  local stack. Its `baseline.commitSha` field is likewise inherited from the
  contract header and does **not** describe this half: the tree measured was
  `f86e2f428b3b7b38dd867aedd9874e408c6c63b3`, which is the tree of
  `445664bfbaafaa81327082be84e8b2ac5764304f`.
- `comparison.json` — one row per (baseline route × viewport), carrying both
  ink coverages, their ratio, both verdicts, both screenshot SHA-256 values,
  and the visible-text and interactive counts on each side.
- `absolute-budgets.json` — every absolute threshold applied to all 44
  measurements of both halves, with each miss labelled `pre-existing`,
  `new-in-the-rewrite` or `fixed-by-the-rewrite`. This is what X6.2 says applies
  where the relative rule cannot.

One mismatch is deliberate and worth knowing about before it looks like a bug:
`baseline-linux-computed-measurements.json` mirrors the contract's thresholds
block as it stood when that run happened, so its copy of every budget is a
snapshot rather than a live reading. Compare thresholds against
`docs/density-baseline.json`, which is the one authority.

## Reproducing it

```sh
# Left-hand side: the frozen baseline, on this machine.
DENSITY_WORKING_ROOT=<work> DENSITY_OUTPUT_ROOT=<work>/evidence \
  scripts/density-baseline/reproduce.sh

# Right-hand side: the successors, on a HEAD build.
INHERIT_DENSITY_CAPTURE=1 DENSITY_POST_CHANGE_OUTPUT=<out> \
  pnpm exec playwright test --project=density
```

The capture spec is behind its own Playwright project and its own environment
variable because a capture asserts nothing about the product — it records what
the product looks like — and a default run should neither pay for 44
screenshots nor let a density measurement read as a passing test.

## The screenshots are pinned, not committed

Neither half's 44 PNGs are stored here. Each measurement in both computed
files carries its own `screenshotSha256`, and `comparison.json` repeats both
hashes on every row, so a regenerated image is checkable against what was
measured. Committing 6.4 MB of PNGs for a comparison that is expected to be
superseded was not worth the repository weight.

## What this does not establish

**Sixteen of the 44 rows have no honest predecessor**, and the reason is
sharper than a choice of fixture file. `scripts/density-baseline/supabase-fixture.mjs`
is a PostgREST stub, and three of the four derived layers the baseline's
authenticated pages showed are literals inside it: the admixture result
(EUR 0.54 … markersUsed 82, "82 of 120 ancestry markers covered in this
synthetic fixture"), the mtDNA and Y calls, and the three polygenic scores
(percentiles 62, 33, 78). Only `variant_calls` came from the sample. No upload
on the successor side can reproduce a number that was never computed, so
`docs/density-baseline.json#postChange.comparison.noHonestPredecessor` records
those rows as not applicable — which is what X6.2 itself prescribes for a route
with no honest predecessor — and the absolute budgets stand for them instead.

It changes no conclusion. Strike all 16 and the remaining 28 still contain no
row that meets the rule.
