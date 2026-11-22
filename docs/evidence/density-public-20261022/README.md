# Public and auth density, measured on one machine (2026-10-22)

An engineering measurement for G2.5, taken under the owner's 10 October
direction ("Commission density completion within the unchanged brief"). It is
**not** G2.5 acceptance, not a new baseline and not screenshot custody. The
frozen 31 August artifacts, `docs/density-baseline.json`, the 0.6 ceiling, the
selectors, the absolute budgets and the 44px target rule are unchanged, and
`pnpm density:verify` passes on this tree. No PNG is committed; every capture
is pinned by its `screenshotSha256` in `measurements.json`.

## What was measured

Both halves on one machine: a cloud container, Linux 6.18.44 x86_64, uid 0,
Chrome for Testing 151.0.7922.34 (Playwright `chromium-1234`, headless),
Node 22.22.0, light theme, DPR 1, `en-US`, UTC, reduced motion, service workers
blocked, at 390×844 and 1280×800.

- **Predecessors.** The frozen baseline commit `86473697`, re-captured here by
  the steps of `scripts/density-baseline/reproduce.sh` (archive, frozen-lockfile
  install, build, stub, `capture.mjs`, `compute.mjs`), all 44 captures, zero
  capture anomalies.
- **Successors.** Every public page the route register lists, 35 pages and 70
  captures, from a `next start` of the tree under test, by
  `tools/successor-capture.mjs`, which calls the unchanged `ready` and `measure`
  from `scripts/density-baseline/measure.mjs`; pixels by the unchanged
  `compute.mjs`. Captured twice: at `cf79b1b6` (PR 324's head, "before") and at
  `1f9a8947`, the source commit before this directory ("after").
- **Budgets.** `tools/evaluate-budgets.py` applies every threshold as
  `scripts/density-current.ts` does, surface classes included. The relative
  rule compares each successor with the predecessor captured on this machine.
- **Text-only floor.** For the predecessor rows, a diagnostic capture of the
  "after" build with every border, fill, shadow, underline, icon and image made
  transparent and every glyph left where it is. It answers one question: how
  much ink the page's text alone puts in the first viewport. It is not a
  measurement of the product.

## Findings

**1. This machine reproduces the frozen macOS baseline.** All 44 non-pixel
readings (interactive, characters, prose elements, decorated elements) are
identical to the frozen file, and ink coverage is within a mean of +1.95%
(+0.05% to +3.28%) of the frozen macOS figures. The 2026-09-14 Linux
re-capture on Chromium 141 was +28.5% at 390 and +26.5% at 1280, so most of
that platform gap was the browser build, not the operating system. That is a
measurement, not custody: the owned-Linux runtime and its Root-pinned
predecessor packet remain the acceptance path.

**2. The relative rule (28 public and auth rows).** Within 0.6 of the
same-machine predecessor: **1 of 28 before, 12 of 28 after.**

| Route | 390×844 before → after | 1280×800 before → after |
| --- | --- | --- |
| `/auth/sign-in` | 0.742 → **0.559** | 0.708 → **0.540** |
| `/auth/sign-up` | 0.791 → 0.636 | 0.734 → **0.594** |
| `/auth/forgot-password` | 0.803 → **0.478** | 0.757 → **0.463** |
| `/auth/reset-password` | 0.860 → **0.485** | 0.811 → **0.472** |
| `/` | 1.002 → **0.599** | 1.375 → 0.824 |
| `/providers` | 0.869 → 0.709 | **0.564** → **0.504** |
| `/privacy` | 1.083 → 0.943 | 0.636 → **0.533** |
| `/legal/deceased` | 0.884 → 0.734 | 0.621 → **0.522** |
| `/legal/gina` | 0.983 → 0.821 | 0.678 → **0.581** |
| `/legal/law-enforcement` | 1.036 → 0.883 | 0.620 → 0.611 |
| `/legal/research-consent` | 0.986 → 0.826 | 0.714 → 0.656 |
| `/terms` | 1.106 → 0.948 | 0.745 → 0.649 |
| `/about` | 1.272 → 1.093 | 0.765 → 0.685 |
| `/changelog` | 1.071 → 0.869 | 1.093 → 0.846 |

`/` at 390×844 passes by 0.0015 and should be read as marginal.

**3. Fifteen of the sixteen remaining rows cannot reach 0.6 with their text
where it is.** Their text-only floor is itself above the ceiling: `/about`
1.075 and 0.677, `/changelog` 0.841 and 0.826, `/` 0.776 at 1280, `/providers`
0.623 at 390, `/privacy` 0.925 at 390, `/terms` 0.932 and 0.643,
`/legal/research-consent` 0.811 and 0.645, `/legal/law-enforcement` 0.868 and
0.605, `/legal/gina` 0.806 at 390, `/legal/deceased` 0.720 at 390. Each "after"
figure is within 0.006 to 0.086 of its floor. Passing needs less text in the
first viewport, by removing it or by moving it below the fold, and the
direction rules out both. The sixteenth, `/auth/sign-up` at 390, has a floor of
0.538; its inputs' 3:1 boundaries (WCAG 1.4.11, which the baseline's inputs did
not have) add about 0.067, so with those boundaries kept the page cannot go
below about 0.60 either.

**4. Absolute budgets.** All 70 captures pass every absolute budget **2 times
before and 14 times after**. What remains:

- *Visible characters over 700* on 35 captures: 21 at 1280 and 14 at 390, all
  of them reading, legal and rights pages plus `/` (744) and `/providers` (829)
  at 1280. The required legal text is the first-viewport text. Three of these
  are new: `/legal/incident-response` (696 → 846), `/legal/law-enforcement`
  (653 → 874) and `/providers` (676 → 829), all at 1280. Each passed before
  only because a 72px title, outside the brief's type table, held text below
  the fold; at the brief's `display-1` the same text rises into view. The
  title change also moved `/legal/law-enforcement` from 0.620 to 0.666 before
  the outlined pill brought it to 0.611.
  On the signed documents (`/legal/insurance-and-discrimination` 1,913 and
  1,952, the six consent and artifact documents 712 to 1,351) the count is
  inflated by the measure itself: it counts the whole of a text node whose
  first line is in view, and those pages render their signed text as one
  `white-space: pre-wrap` node, so most of what is counted is below the fold.
- *Minimum prose measure under 45ch at 1280* on all 35 public pages: the
  persistent footer's link lists (29.2ch), and on the auth pages the one-line
  link paragraphs (10.8ch). The contract counts every `p` and `li` anywhere;
  the brief says "prose `<p>`". That is D-115, an open owner decision.
- *Maximum prose measure over 68ch*: `/` (an eyebrow rule, 106ch), `/providers`
  (provider cards as list items, 109ch), `/science` (73ch), the signed
  documents (91 to 94ch).
- *Interactive elements over the flow cap of 7*: `/auth/sign-in` 9 and
  `/auth/sign-up` 10, every one a required control or link. The baseline
  missed the same cap with the same counts.
- *Section gaps*: the two version-comparison pages put their two panes side
  by side at 1280 (a negative "gap") and 24px apart at 390; `/providers` at 390
  reorders its sections with CSS `order`, which the DOM-order gap reads as
  −34,068px.

## What changed between "before" and "after"

Every change keeps all text, every control, the 44px targets and every
consent, safety, evidence and uncertainty statement on the page:

1. Every page h1 is the brief's `display-1` (§2: `clamp(2rem, 1.2rem + 3.2vw,
   3.25rem)`). The landing headline (up to 100px) and the reading-page titles
   (up to 72px) used two larger steps that the brief's type table does not have.
2. The auth submit, the header's "Get started"/"Overview" pill and the landing
   page's first action are the forest outline instead of a filled pill, at the
   same 44px height. The filled auth submit alone was 30–40% of each auth
   page's first-viewport ink.
3. `.quiet-link` rests at the prose link's 1px underline and thickens on hover.
4. Legal sections are one section rhythm apart with the hairline drawn at its
   midpoint outside the box: the same pixels, now measured as the 64/80/96px
   they are rather than half of it.
5. The landing page's last section uses a top margin instead of inner padding
   for the same gap, for the same reason.
6. The legal contents list, the reading head's eyebrow and date, and the
   footer's attribution sentence keep the 68ch measure; the claim page's and
   the embryo-analysis page's paragraphs keep it too, and their two top-level
   sections are a section rhythm apart.

## What this does not cover

- **278 of the 348 required captures.** Every authenticated, reviewer and
  public-or-authenticated state (258 captures on 29 pages), the public
  processing and receipt states (18), and `/withdraw/[token]` (2). They need a
  real account, real data and a native state per capture. The shared local
  database here lacks PR 324's 25 newest migrations, and the current driver
  (`e2e/helpers/density-current-capture.ts`) needs a fresh admitted native
  stack per state and viewport through the owned-Linux runtime, which refuses
  uid 0 (`scripts/owned-linux-runtime.ts`).
- **`/auth/reset-password` initial form** was captured without a recovery
  session. The registered provider reaches it through the real recovery mail;
  the heading and form are the same, but this capture is not that state.
- **The ten authenticated relative rows** (`/files`, `/settings`,
  `/copilot/[scope]`, `/genome/[subject]/reports/[slug]`,
  `/genome/[subject]/data/browser`, both viewports). Their last measurement is
  the 2026-09-14 comparison (0.84 to 1.43), before the October UI renewal.

## Reproducing

```sh
# Predecessors: the steps of scripts/density-baseline/reproduce.sh, with
# DENSITY_BROWSER_EXECUTABLE set to the Chrome for Testing build above.
# Successors: build and `next start` the tree, then
DENSITY_ORIGIN=http://127.0.0.1:<port> DENSITY_OUT=<fresh dir> \
  node docs/evidence/density-public-20261022/tools/successor-capture.mjs
DENSITY_SCREENSHOT_DIRECTORY=<dir>/screenshots \
DENSITY_CAPTURE_MANIFEST=<dir>/capture-manifest.json \
DENSITY_COMPUTED_MEASUREMENTS=<dir>/computed-measurements.json \
  node scripts/density-baseline/compute.mjs
python3 -I docs/evidence/density-public-20261022/tools/evaluate-budgets.py \
  <predecessor computed-measurements.json> <dir>
```

The text-only floor used `DENSITY_EXPERIMENT_CSS` with
`*,*::before,*::after{border-color:transparent!important;box-shadow:none!important;outline:none!important;text-decoration:none!important;background:transparent!important}svg,img,canvas,video,hr{visibility:hidden!important}html,body{background:#f7f8f1!important}`.
