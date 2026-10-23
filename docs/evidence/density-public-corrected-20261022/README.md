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
whole census before it opens a page. (Round 3, below, adds that provider and
the operator's command-line path, `OPERATOR.md`.)

## Round 3: carrier provider, operator path and the remaining honest fixes

**Carrier provider.** `e2e/helpers/density-carrier-state-fixtures.ts` reaches
the six `genome.carrier` states the way `e2e/own-carrier-status.spec.ts` does:
a fresh account, the committed carrier-pair VCF through the real upload and
preparation path, the "Observed genetic variants" choice signed and generated
on the person's own Reports page, and a synthetic reviewed release imported,
activated and withdrawn only through the rule's own doors. It is wired into
the fixture assembly, the owned capture ports and the native observers, so the
source census now has a provider for 174 of 174 pairs (348 captures). It has not
run against the app: the shared local database here lacks PR 324's newest
migrations, and the owned runtime gives each capture its own complete stack.

**Operator path.** `OPERATOR.md` lists the 348 selections and gives the
per-capture command (`scripts/run-owned-density-segment.mts`, now with
`--baseline-originals <path> --baseline-originals-sha256 <sha>`), the union
command (`scripts/run-density-segment-union.mts`), the host requirements and
what Root must supply.

**Source fixes, re-measured with the unchanged modules** (`evaluation-round3.json`;
all 70 PNG pairs are byte-identical to `evaluation-after.json`, so no first
screen moved):

- `/science`: each link card's text column is now the card less its arrow,
  not the width of its one line; its sentences measure 52ch, not 36.5ch. The
  1280 capture now meets every budget.
- `/providers`: the page's heading and directory carry the contract's own
  top-level-section marker. The 16px gaps at 390 were between product blocks
  inside one provider card, never between sections of the page; the page's one
  gap is now the 64px a reader sees. The 390 capture keeps only its ink miss.
- `/`: the four steps sit two across from md, so each step's text runs 61ch,
  not 28ch (below the fold, so the first screen is unchanged), and the hero
  eyebrow is held to the 68ch measure.

Every budget is met by **42 of 70** (41 before this round); the relative rule
holds on 26 of 28.

**Tried and reverted:**

- Dropping the auth column's bare side padding from 640px lets
  `/auth/forgot-password` meet the 45ch floor, but it raises `/auth/sign-up`'s
  ink at 1280 from 0.594 to 0.633 of its predecessor, over the 0.6 ceiling
  (its floor is 0.518, so not text-bound).
- Setting the landing guide's three plates two across brings their labels and
  text to 45ch, but it moves the third plate below the 1280 fold. That changes
  the page's 700-character result and its first-screen ink, so it is not a
  pass that can be counted.

**Still missing, and why it is not engineering:**

- *45ch floor at 1280*: `/` (the guide plates' labels at 23.5ch and their text
  at 34.8ch, three across, and the "Sample report" label at 12.7ch),
  `/auth/forgot-password` and `/auth/sign-up` (the 26rem column's 38ch, see
  above).
- *68ch ceiling at 1280*: `/` (the two eyebrow labels whose rule runs to the
  column edge; holding them to 68ch would shorten the rule, and moving the rule
  off them sets them under 45ch) and `/providers` (each provider card is a list
  item as wide as its comparison table, 109ch; no line inside it is longer
  than 68ch, since its prose already carries the measure).
- *Relative rule at 390*: `/auth/sign-up` and `/providers`, unchanged.

### The 700-character results, by page

Characters as the frozen measure counts them (any text node that reaches the
first screen counts whole), and characters actually above the fold (the
corrected reading). About 80 to 100 of each count are the site header and
attribution; the rest is the page's own heading, introduction, contents list
and first section. Nothing here was changed.

| Page | Viewport | Frozen | Above the fold | What would be needed |
|---|---|---|---|---|
| `/` | 1280 | 744 | 744 | Content structure: a shorter first screen (hero and guide) |
| `/about` | 390 / 1280 | 949 / 988 | 769 / 988 | Content structure, or an owner reading for reading pages |
| `/future-person/claim` | 1280 | 767 | 767 | Counsel: the claim rules are the first section |
| `/legal/appeals` | 390 / 1280 | 878 / 1008 | 701 / 954 | Counsel, or an owner reading (above the fold, at 390 one over) |
| `/legal/deceased` | 1280 | 738 | 738 | Counsel, or an owner reading for legal pages |
| `/legal/future-person` | 390 / 1280 | 778 / 843 | 628 / 843 | Owner reading (above the fold passes at 390); counsel at 1280 |
| `/legal/gdpr` | 390 / 1280 | 808 / 847 | 708 / 847 | Counsel, or an owner reading for legal pages |
| `/legal/gina` | 1280 | 999 | 924 | Counsel |
| `/legal/incident-response` | 1280 | 846 | 785 | Counsel |
| `/legal/law-enforcement` | 1280 | 874 | 874 | Counsel |
| `/legal/research-consent` | 390 / 1280 | 779 / 876 | 654 / 876 | Owner reading (above the fold passes at 390); counsel at 1280 |
| `/privacy` | 390 / 1280 | 705 / 819 | 705 / 819 | Counsel: one introductory paragraph is most of it |
| `/providers` | 1280 | 829 | 829 | Content structure: the introduction, filter note and explainer |
| `/terms` | 390 / 1280 | 939 / 1035 | 688 / 1035 | Owner reading (above the fold passes at 390); counsel at 1280 |
| `/legal/[artifact]/diff/…` (signed) | 1280 | 1351 | 1122 | Owner reading: two signed versions side by side |
| `/legal/consent/[key]/diff/…` (signed) | 1280 | 1351 | 1122 | Owner reading: two signed versions side by side |
| `/legal/insurance-and-discrimination` (signed) | 1280 | 1952 | 765 | Counsel: the signed words cannot change without a new version |

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
