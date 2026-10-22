# Public density under the owner's corrected rules (2026-10-22)

The owner decided six readings on 22 October ("2026-10-22 — Density rule
corrections (G2.5)", `docs/protocol/decisions.md`). This directory re-evaluates
the 70 public and auth captures that can be taken in this container under
those readings, before (`cf79b1b6`, PR 324's head) and after (`ac13250f`). It
is an engineering measurement, **not G2.5 acceptance**: the frozen 31 August
baseline, `docs/density-baseline.json`, the 0.6 ceiling, every threshold and
the frozen measurement modules are unchanged, and `pnpm density:verify` passes.

## How the readings are implemented

- **The evaluator** is `evaluateDensityCapture` in `scripts/density-current.ts`,
  with two rule sets. `contract` is every budget as written and stays the
  default of `verifyCurrentDensity`; `corrected-2026-10-22` applies the six
  readings. A capture that lacks a corrected reading is judged on the contract
  basis for that budget, which is never more lenient.
- **The corrected readings** come from `scripts/density-corrected-readings.mjs`,
  pinned by hash in the evaluator, on the same live page as the frozen
  `measure.mjs`. It is not a measurement module and the frozen modules do not
  import it.
- **The text-only floor** is a committed capture variant in the same module:
  `TEXT_ONLY_FLOOR_CSS`, pinned by its SHA-256, sets only border, outline,
  underline, shadow and background colours to transparent and hides `svg`,
  `img`, `picture`, `canvas`, `video`, `iframe` and `hr`. No property that moves
  or resizes a box is touched and the glyph colour is not touched. It is shot on
  the same load as the product PNG, its pixels are computed by the unchanged
  `compute.mjs` with the product capture's own exclusion rectangles, and the
  style is removed again. `scripts/density-corrected-readings.test.ts` pins how
  it is produced, including in a browser that every box and glyph stays put.
- **The six readings, as implemented:**
  1. A comparable row whose floor is over 0.6 of its predecessor passes the ink
     rule when its ink is at most its floor plus 0.05 of the predecessor's ink.
     The 0.05 is read in the same unit as the 0.6, a fraction of the
     predecessor, which is how the decision's measured floors are stated.
  2. The outlined primary actions stay (no evaluator reading).
  3. The 45ch floor reads every rendered `p` except a paragraph that sets on one
     line and carries a link; list items are not paragraphs. The 68ch ceiling
     keeps the contract basis, every `p` and `li`.
  4. Section gaps use the frozen section selection, sorted by rendered top,
     with vertically overlapping (side-by-side) sections merged into one row.
  5. On the seven routes that render a signed legal artifact
     (`legal.artifact`, `-version`, `-diff`, `legal.consent`, `-version`,
     `-diff`, `legal.insurance-and-discrimination`), characters count only
     where their own glyph box meets the first viewport.
  6. `auth.sign-in` and `auth.sign-up` may carry 10 interactive controls.

## Result

| | before, contract | before, corrected | after, contract | after, corrected |
| --- | --- | --- | --- | --- |
| captures meeting every budget (of 70) | 2 | 6 | 14 | **41** |
| relative rows within the rule (of 28) | 1 | 1 | 12 | **26** (14 of them text-bound) |

Every PNG in both captures is byte-identical to the corresponding earlier
capture (`docs/evidence/density-public-20261022/`), so the corrected rules
change the verdicts, not the measurements. This branch's later source changes
(the two signed-document hash and link lines, the "Source read" caption and the
version-comparison pane gap) alter no first-viewport pixel.

Per row, in `evaluation-before.json` and `evaluation-after.json`: product and
floor ink and their ratios to the predecessor, the three corrected readings
beside the frozen values they replace, and both verdicts.

**What still misses under the corrected rules, after (29 captures):**

- *Visible characters over 700* on 21 captures of reading, legal and rights
  pages, where the frozen count applies, and on three signed-document captures
  whose characters above the fold still exceed 700
  (`/legal/insurance-and-discrimination` 765, both version comparisons 1,122,
  at 1280).
- *The relative rule* on `/auth/sign-up` at 390 (0.636; its floor is 0.537, so
  it is not text-bound) and `/providers` at 390 (0.709 against a floor of
  0.623, 0.086 above it).
- *The 45ch floor on real prose paragraphs* at 1280: `/` (card text in three-
  and four-column grids, 28 to 35ch, and labels down to 12.7ch),
  `/auth/forgot-password` and `/auth/sign-up` (one sentence at 38ch in the
  26rem auth column) and `/science` (36.5ch card descriptions).
- *The 68ch ceiling*: `/` (eyebrow labels with a rule, 106ch) and `/providers`
  (provider cards as list items, 109ch), both at 1280.
- *Section gaps*: `/providers` at 390, whose 60 provider cards are `section`
  elements 16px apart.

## What this does not cover

All 348 required captures still need the owned-Linux runtime for acceptance;
these 70 are engineering measurements. The other 278 (every authenticated,
reviewer and processing state, and `/withdraw/[token]`) have no measurement.
The owned runtime cannot capture any of them yet: the six `genome.carrier`
pairs added by PR 324 have no state provider, so the capture driver holds the
whole census before it opens a page.

## Reproducing

```sh
DENSITY_ORIGIN=http://127.0.0.1:<port> DENSITY_OUT=<fresh dir> \
  node docs/evidence/density-public-corrected-20261022/tools/capture.mjs
for kind in "capture-manifest screenshots computed-measurements" "floor-manifest floor-screenshots floor-computed"; do
  set -- $kind
  DENSITY_CAPTURE_MANIFEST=<dir>/$1.json DENSITY_SCREENSHOT_DIRECTORY=<dir>/$2 \
  DENSITY_COMPUTED_MEASUREMENTS=<dir>/$3.json node scripts/density-baseline/compute.mjs
done
node --import tsx docs/evidence/density-public-corrected-20261022/tools/evaluate.mts \
  docs/evidence/density-public-20261022/measurements.json <dir>
```
