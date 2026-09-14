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
force. The result: **3 of 44 within the brief's rule, 26 of 44 within the
proposed one, median ratio 0.98.**

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
superseded — see the fixture confound in
`docs/density-baseline.json#postChange` — was not worth the repository weight.

## What this does not establish

The two halves were not fed the same file. The baseline half serves a
2,135-variant sample inserted directly into an out-of-tree stub; the
post-change half uploads a 309-row synthetic VCF through the real journey.
Every measure that depends on how much a file supports is confounded by that,
and the confound is recorded in full, with what bounds it, in
`docs/density-baseline.json#postChange.comparison.fixtureConfound`. No row
here should be read as a verdict on a surface until it is closed.
