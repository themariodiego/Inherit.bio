# W8 design: the expert path on the figure contract

(Design pass output, persisted by the orchestrator. Sequence: build after W7 part B lands, because both touch `eslint.config.mjs`, `e2e/upload-vcf.spec.ts` and the ancestry page's link.)

## 10-line summary

1. The lint exemption exists for exactly three sites in `browser/page.tsx`: `h.pos.toLocaleString()` (L306) and the two `locus.start/end.toLocaleString()` calls in the igv `<h2>` (L335-336). Everything else the page shows (genotype chips, gnomAD `toFixed(4)` behind a ternary, rsIDs, `ref→alt`) is invisible to the rule but not to the contract.
2. Genotypes become `<Figure kind="genotype" class="variant-call" basis="observed" provenance="computed:genome/browser">` cells inside one `<ClaimBlock subject={{subjectId}}>` per results table (W7's "one attributed block per table" pattern); coordinates, rsIDs and allele letters stay plain text without thousands grouping, marked `inherit-figure-exempt` exactly as `reports/[slug]/page.tsx:524-525` does.
3. gnomAD AF and ClinVar columns are removed: no `FIGURE_KINDS` entry honestly renders an allele frequency, adding one violates X4, both are null on every seeded row, and their `title` glosses breach §1.6.
4. The sibling `data/page.tsx` already passes the rule but renders a `12.3%` sentence inside its coverage `ClaimBlock` (L121) that duplicates the `coverage` figure in the form §7.6 removed; delete it, source breadcrumb labels from copy, and (default) retitle the page "Data and methods".
5. `expert_mode` exists nowhere (no migration, no `profiles` column, no code). Smallest honest step: add the missing Settings entry point now and defer the toggle with a ledger entry; the migration is specified but not recommended in this change because no collapsed methods block lives on these two pages.
6. Entry points: report footer exists (`reports/[slug]/page.tsx:537`, pinned by E2E); ancestry exists but with a literal path and inline string (`ancestry/page.tsx:219-226`, owned by W7); Settings does not exist → one `DATA_AND_METHODS` link in the Settings footer built from `route("genome.data", { subject: "me" })`.
7. Composition: breadcrumbs `My Genome / {name} / Data / Genome browser` (the brief's own §1.4 example), subject bar, h1 "Genome browser", h2 "Results" (`#results`, already pinned by `primary-routes.test.ts:124`), h2 "Region"; three headings of a six cap; every `<p>` capped at `max-w-prose`.
8. Interactive budget is the real risk: igv's navbar adds ~10 counted controls when a one-row result puts the track inside 800px; default is to drop the three example chips (the placeholder already lists them) and trim igv's navbar via its shipped `show*` flags so the first viewport stays ≤ 11.
9. Every string moves to a new `src/copy/genome/data.ts`; export names decide the readability role (`*_HEADING`/`*_LABEL` are vocabulary-checked, `*_NOTE`/`*_STATUS` get the 25-word sentence cap), so three plain words (`zoom`, `level`, `interactive`) join `data/plain-vocabulary.json`.
10. E2E: keep the three GIAB browser tests but retarget the genotype assertion to `[data-figure-kind="genotype"] [data-slot="figure-value"]`; add `e2e/genome-data.spec.ts` on the tiny fixture pinning the block, the four attributes, breadcrumbs, heading and interactive caps, the three entry points and the absence of `%` text on `/genome/me/data`.

## 0. What binds this surface (brief, with line numbers)

| Rule | Where | What it means here |
|---|---|---|
| §7.3 expert path | `docs/inherit-v2-brief.md:410` | `/genome/[subject]/data` holds the browser at `/data/browser`, per-variant tables, per-score panel coverage, raw ancestry marker counts, method notes. Never in top nav. Reached from exactly three places: report footer "Data and methods", ancestry page, Settings. `expert_mode` (Settings → "Show methods and raw numbers by default") expands every collapsed methods block. |
| §1.4 breadcrumbs | `:195` | Four-level form given verbatim as `My Genome / Maya / Data / Genome browser`. Subject never abbreviated. |
| §1.5 density | `:197` | One `default`-variant button per screen; `<p>` ≤ 68ch at 1280; ≥96px between adjacent top-level `<section>`s at ≥1024; ≤12 interactive elements in the first 800px at 1280×800 excluding nav and dock. |
| §1.6 | `:199` | `title` attributes never carry information. |
| §2.2 headings | `:627` | One `h1`; h1–h3 only; ≤6 headings on any non-Overview app surface; every `h2` followed by ≥80 chars of non-heading content. |
| §7.5 | `:412` | Collapsible set is closed ("exactly these"); a genome track is not on it, so the browser is never behind a `<details>`. |
| §7.6 | `:414` | Grade ≤ 9; "coverage fraction" → the plain coverage sentence; three retained terms only. |
| X4 | `:2420-2430` | Every rendered quantity is a `<Figure>`/`<RelativeFigure>` inside `[data-claim-block]`; `data-figure-kind` is a closed enum; the lint rule fails the build on any numeric or genotypic value outside those components. |
| X6.1–X6.3 | `:2442-2446` | Caps ≤12 standard route (the register lists both routes as `surface: "standard"`, `docs/route-register.json:13241-13273`); ≤60 decorated elements at 1280; text ≤700 chars in first viewport. |
| X13 | `:2506` | Provenance is scroll-reachable, never behind a control. |
| Route register | `docs/route-register.json:6830-6838` | `genome.data` = `data-metadata-read`, `genome.browser` = `raw-variant-browser-read`; both `width: "64rem"`, depth 3 (`:8283-8284`). |

Conventions already taken in `docs/protocol/decisions.md`: one home per string in `src/copy/**`; counts and coordinates render as text with `inherit-figure-exempt` and a reason rather than a second attributed block; route builders, never literal paths; W7's table decision "`ClaimBlock` gains an optional `renderFigures` so the table layout keeps one attributed block".

## 1. What the rule sees, and what it does not

`scripts/eslint/no-raw-figure.mjs`:
- Flags JSX text / string literals in JSX expressions / template literals in JSX expressions matching `\d+(\.\d+)?\s?%`, `\b[ACGT]\/[ACGT]\b`, or `\bin (100|1,000|…)\b` (L42-51). In a template literal each `${}` becomes `0` (L53-55), so `` `chr${c}:${p} ${ref}→${alt}` `` reads `chr0:0 0→0` and is **not** flagged.
- Flags a `JSXExpressionContainer` whose expression is a **direct** call to `.toFixed(`, `.toLocaleString(` or `formatPercent(` (L69-82, L148-152). A call inside a ternary is a `ConditionalExpression`, not a call, and is **not** flagged.
- Runtime values (`{h.genotype}`) are never seen.
- Allowed inside any ancestor named `Figure`/`RelativeFigure`/`ClaimBlock` or carrying `data-figure-kind` (L57-67), or with `inherit-figure-exempt: <reason>` on the same or previous line (L102-115).

Consequence: the exemption in `eslint.config.mjs:27` covers exactly three sites, but the contract (X4) covers more, and once a table sits inside a `ClaimBlock` the rule is blind to everything inside it. The design therefore removes every non-contract quantity rather than relying on the block to hide it.

## 2. Inventory: every raw quantity on the two pages today

### 2a. `src/app/(app)/genome/[subject]/data/browser/page.tsx`

| Line | Today | Rule | Contract treatment |
|---|---|---|---|
| 186 | `Searching {name}'s {files.length} processed files — by rsID, gene symbol, or position.` | not flagged (identifier) | **Remove the count.** The subject bar already renders the file count. Replace with a fixed lede from copy or no lede. |
| 201 | placeholder `rs762551 · CYP1A2 · chr20:1000000-1100000` | not scanned (JSX attribute) | identifiers; keep, from copy (`SEARCH_PLACEHOLDER`). |
| 209-217 | three example chips `{ex.q} ({ex.hint})` | not flagged | **Remove** (default; see §6 interactive budget). |
| 227-231 | `Inherit's reference has no clinical variants for {gene}…` | not flagged | text, moves to copy as `clinicalGeneStatus(gene)` (role `status` → 25-word sentence cap). |
| 237-254 | trait suggestion with hard-coded report titles from `search-guidance.ts` | not flagged | titles resolved from `report_templates` at render (the `AR` title is already stale: `search-guidance.ts:156` says `· AR (X chromosome)`, `data/templates/aesthetic-cosmetic.json:5` says `· AR`). |
| 94, 101, 172 | `message` templates (`Your file does not cover rs…`, `rs… is not in your file and not in the reference store.`, `No reference variants known for "…" — try an rsID (rs123…), a gene symbol (CYP1A2), or a position (chr15:74749576).`) | not flagged (not in JSX) and **not scanned by the readability gate** | move to copy; they become gate-scanned. |
| 303 | `rs{h.rsid}` / `—` | not flagged | identifier, plain text, no comment. |
| 305-308 | `chr{name}:{h.pos.toLocaleString()} {ref}→{alt}` | **flagged** (`.toLocaleString(`) | identifier. Drop the grouping (the report page and the search syntax use `chr15:74749576`) and add `{/* inherit-figure-exempt: genomic coordinates and the reference/alternate letters are the position's identity, not a result figure */}`. `pos38 ?? 0` (L149) prints a false `chr…:0` for an unlifted reference row: render `—` when null. |
| 309 | gene symbol | not flagged | identifier text. |
| 310-320 | genotype chip `{h.genotype}` / `not covered` | not flagged (runtime) | **`<Figure>` kind `genotype`**, class `variant-call`, basis `observed`, provenance `{ kind: "computed", module: "genome/browser" }`, `genotype: h.genotype` (parsers store `A/C` already: `src/lib/genome/parsers/vcf.ts:108`, `array.ts:40`), `label: GENOTYPE_LABEL`. Not-covered cell: `COVERAGE_PILLS["not-covered"]` from `src/copy/reports/strings.ts:164-168`. |
| 283-296 | `th` `title`/`aria-label` glosses for ClinVar and gnomAD | not flagged | **breach §1.6**; removed with the columns. |
| 321 | ClinVar significance text | not flagged | **Removed** (default; open decision 1). A clinical classification beside a raw genotype without the report page's "How sure we are" apparatus is a naked clinical claim; null on every seeded row (`scripts/seed.ts:143-151` seeds no `clinvar_significance`; only `api/jobs/annotation-refresh/route.ts:84` fills it). |
| 322-324 | `h.gnomadAf.toFixed(4)` | **not flagged** (ternary) but a raw frequency | **Removed.** No kind fits: `absolute` renders "about N in D {group}" (`figure-text.ts:34-40`), a per-person probability, which an allele frequency is not; adding an `allele-frequency` kind changes the X4 enum. Null on every seeded row. |
| 334-337 | `<h2>Genome browser · chr{…}:{start.toLocaleString()}-{end.toLocaleString()}</h2>` | **flagged ×2** | h2 becomes `REGION_HEADING` ("Region"); the range renders in a `<p>` beneath as `chr15:74744576-74754576` with `{/* inherit-figure-exempt: the region shown is a coordinate range, not a result figure */}`. Pin this string in E2E. |
| 339-343 | first-party note | not flagged | pinned by `e2e/upload-vcf.spec.ts:69`; moves verbatim to copy as `FIRST_PARTY_NOTE`. |
| 119 | `.limit(200)` silent truncation | — | add `RESULTS_TRUNCATED` sentence when 200 rows return, with `{/* inherit-figure-exempt: a row limit, not a result figure */}` (open decision 7). |
| 61 | locus regex char class `[0-9XYM T]+` contains a stray space | — | extract to `src/lib/genome/locus.ts` (`parseLocusQuery`, `formatLocus`) with unit tests; fix the class to `[0-9XYMT]+`. |
| 64-70 | rsID lookup `.limit(1)` across files | — | use `getSubjectGenotypesByRsid` (`src/lib/genome/load.ts:89-129`) for rsID and gene searches so two disagreeing files render `FILES_DISAGREE` instead of one file's genotype silently. Region search stays per active file, as the track already is (`genome-browser.tsx:197-199`). |
| 197 | form `action={`${routeBase}/data/browser`}` | — | `route("genome.browser", subjectParams)`; report links via `route("genome.report"…)` / `route("genome.reports"…)`. |

`src/components/browse/genome-browser.tsx` (outside `RESULT_SURFACE_GLOBS`; leave the globs — `scripts/eslint/no-raw-figure.test.ts:17-21` pins five): igv draws `rs… A/C (A→C)` feature names on canvas (L240-246) — not DOM, not attributable; kept (open decision 4b). Its JSX strings (L282-283, L306-308, L313-316), the track name (L235) and the accessible names in `labelIgvControls` (L102-145) move to copy.

### 2b. `src/app/(app)/genome/[subject]/data/page.tsx`

Passes the rule today. Findings:
- L121 `` {`${(row.coverage * 100).toFixed(1)}% of this score's positions are in your file.`} `` — inside a `ClaimBlock`, so allowed, but it is the "coverage fraction" §7.6 removed and it duplicates the `coverage` figure (`figure-text.ts:59-63`: "read X of the Y positions this needs"). **Delete**, and drop `coverage` from the `user_prs` select (L44).
- L64-70 breadcrumb literals `"My Genome"`, `"Data"` → `NAV_LABELS["my-genome"]` and `DATA_CRUMB` from copy.
- L74 h1 `{name}'s genome data` → `DATA_H1 = "Data and methods"` (default; open decision 6) so the three entry-point links land on a page titled by the same words.
- L116 `row.pgs_id`, L115 `meta.name`, L118 `meta.trait`, L123 `meta.ancestry_note` — identifiers and seeded text; unchanged.
- L63 `max-w-3xl` vs register `width: "64rem"` → `max-w-5xl` (low priority).
- Every `<p>` gets `max-w-prose` (§1.5 68ch).

## 3. Identifiers: what the rule flags and what the comment allows

rsIDs, coordinates, ranges and allele letters are not matched by the three regexes; only formatting calls trip the rule. The exempt comment is precautionary on those lines, but the repository convention is to mark counts and coordinates with a reason anyway. Genotype letters with a slash (`A/C`) **are** matched when literal, so a genotype must never be a literal outside `<Figure>`; runtime values are invisible to lint and are caught only by the E2E `[data-figure-kind]` assertions.

## 4. `expert_mode`

No match across `supabase/migrations`, `src`, `e2e`, `scripts`, `docs/route-register.json`, `docs/schema-requirements.md`. `profiles` Row has no `expert_mode`.

Smallest honest step (default): add the Settings entry point now; defer the toggle, recorded in the ledger. The setting's effect ("expands every collapsed methods block application-wide") targets `<details>` blocks that live on the report page (`TechnicalNote`, `More sources`) and on the W7 ancestry page — none on the two pages in scope; a toggle that changes nothing on any surface this change touches is a false affordance.

If built: migration `supabase/migrations/<ts>_profiles_expert_mode.sql` with `alter table public.profiles add column expert_mode boolean not null default false;` (RLS unchanged); regenerate `src/lib/supabase/types.ts`; `src/components/settings/expert-mode-toggle.tsx` mirroring `digest-toggle.tsx` with label `"Show methods and raw numbers by default"` (from copy); read the flag in `reports/[slug]/page.tsx` and pass `open` to the two `<details>`; an E2E toggling it and asserting `details[open]`.

## 5. Composition

**Browser page** (`max-w-5xl`, `data-surface="standard"`, `data-density-primary-content`):
1. `<Breadcrumbs>` → `My Genome / {name} / Data / Genome browser`.
2. `<SubjectBar subject fileCount={getSubjectFileCount(...)} viewerAccountId>` (currently missing; §2.3 mandates it on every subject-derived route).
3. `<h1 className="display text-3xl">{BROWSER_H1}</h1>` — no `.eyebrow` (today's "Exploration" eyebrow goes).
4. Search form: `<Input aria-label={SEARCH_LABEL} placeholder={SEARCH_PLACEHOLDER}>` + `<Button>{SEARCH_BUTTON}</Button>` (the one default-variant button; the subject bar's "Add a file" is `outline`).
5. State boxes (clinical gene `role="status"`, trait suggestion, message) unchanged in structure, strings from copy.
6. `<div className="space-y-16 md:space-y-20 lg:space-y-24">` holding two `data-density-top-level-section` sections:
   - `<section id="results" aria-labelledby="results-heading">` — `<h2>{RESULTS_HEADING}</h2>` then one `<ClaimBlock subject={{ subjectId }} figures={[]} aria-label={resultsLabel(q)} className="p-0 overflow-x-auto">` wrapping the `<table>`; genotype cells are `<Figure spec={genotypeSpec} />` (no `subject`: the block is the single attributed ancestor). `claimBlock([])` is safe (no denominator, no modelled marker). If W7's `renderFigures` has landed by build time, pass the specs array instead; the DOM is identical.
   - `<section aria-labelledby="region-heading">` — `<h2>{REGION_HEADING}</h2>`, the exempted locus line, `<GenomeBrowser>`, `<p>{FIRST_PARTY_NOTE}</p>`.
   Headings: 3 of 6.

**Data page**: breadcrumbs `My Genome / {name} / Data`, subject bar, h1 `DATA_H1`, lede, two outline links, `Score panel coverage` section (coverage figures only). Headings: 2 of 6. Raw ancestry marker counts and method notes named in §7.3 are W7's and are not invented here.

**Entry points**: report footer exists (`reports/[slug]/page.tsx:536-539`, pinned `e2e/report-skeleton.spec.ts:180`); ancestry exists (W7 rewrites it with `route()`); Settings **missing** → append `<Link href={route("genome.data", { subject: "me" })}>{DATA_AND_METHODS}</Link>` to the Settings index footer beside "Accessibility" (no new h2: the page already carries six headings).

## 6. Risks

1. **Interactive budget with the track in view.** Baseline `/browse` measured 9 interactive at 1280×800 with no query. With `?q=rs…` a one-row table leaves igv's navbar inside 800px; `labelIgvControls` promotes to `role=button` the search icon, zoom in/out and every `.igv-navbar-text-button/.igv-navbar-icon-button`, plus a `<select>`, a text input and a range slider — roughly 10. Default: remove the chips and configure igv with `showChromosomeWidget: false, showSVGButton: false, showSampleNameButton: false, showMultiSelectButton: false, showTrackLabelButton: false, showCenterGuideButton: false, showCursorTrackingGuideButton: false` (all present in `node_modules/igv/dist/igv.esm.js` 3.8.5), keeping locus search and zoom → 6 + 5 = 11 ≤ 12.
2. **Third-party origins.** Unchanged: `loadDefaultGenomes: false` plus the XHR guard (`genome-browser.tsx:44-87`); `e2e/network-audit.spec.ts:110-141` remains the gate.
3. **`/api/browse/region`**: returns `{ variants: [...], truncated }`, capped at 5000 rows / 10 Mb, RLS-scoped, keyed by `file`. No change.
4. **Readability gate**: short-role blocks under 15 words must use only `data/plain-vocabulary.json` words. Registered: `genome, browser, results, region, variant, position, gene, your, genotype, search, variants, data, and, methods, chromosome, locus, by`; not registered: `zoom, level, interactive, matches, track`. So headings are "Results" and "Region"; table headers live under `TABLE_HEADINGS`; `zoom`, `level`, `interactive` are added so igv's accessible names can be checked under `IGV_CONTROL_LABELS`. Drop "(GRCh38)" from the header; state the build in a `<p>`.
5. **Density baseline relative rule.** The browser is a successor of `/browse` whose baseline ink was 0.0208 at 1280; ≤60% of a near-empty predecessor is not reachable while rendering the mandated subject bar and breadcrumbs. Record the position in the ledger.
6. **W7 conflicts.** `ClaimBlock` API changes under W7 (`renderFigures`); use today's exported props or the landed one.
7. **Copy roles.** Name exports as in §7.

## 7. New copy module `src/copy/genome/data.ts` (names decide roles)

`DATA_CRUMB "Data"`, `DATA_H1 "Data and methods"` (heading), `DATA_LEDE`, `BROWSE_VARIANTS`, `MANAGE_FILES`, `SCORE_COVERAGE_HEADING "Score panel coverage"`, `SCORE_COVERAGE_NO_FILE`, `SCORE_COVERAGE_NONE`, `BROWSER_H1 "Genome browser"` (heading, also the last crumb and `metadata.title`), `BROWSER_NO_FILE`, `SEARCH_LABEL "Search variants"`, `SEARCH_PLACEHOLDER`, `SEARCH_BUTTON "Search"`, `RESULTS_HEADING "Results"`, `REGION_HEADING "Region"`, `TABLE_HEADINGS { variant, position, gene, genotype }`, `POSITIONS_BUILD "Positions are on GRCh38."`, `resultsLabel(q)`, `rsidNotCovered(rsid, gene)`, `rsidUnknown(rsid)`, `UNRECOGNIZED_CHROMOSOME`, `noReferenceMatch(q)`, `OR_START_FROM_REPORTS`, `clinicalGeneStatus(gene)`, `lookingFor(topic)`, `FULL_LIBRARY`, `RESULTS_TRUNCATED`, `FIRST_PARTY_NOTE` (verbatim, pinned), `TRACK_NAME "Your variants"`, `BROWSER_LOADING`, `BROWSER_FAILED`, `BROWSER_EMPTY_REGION`, `IGV_CONTROL_LABELS { chromosome, locusSearch, locusSubmit, zoomSlider, zoomOut, zoomIn, region }`. Reused from `src/copy/reports/strings.ts`: `DATA_AND_METHODS`, `GENOTYPE_LABEL`, `COVERAGE_PILLS`, `FILES_DISAGREE`, `NAV_LABELS`. Test `src/copy/genome/data.test.ts` mirrors `strings.test.ts`.

## 8. File map

New: `src/copy/genome/data.ts`, `src/copy/genome/data.test.ts`, `src/lib/genome/locus.ts`, `src/lib/genome/locus.test.ts`, `src/lib/genome/search-guidance.ts` (moved from `src/components/browse/`, titles dropped, slugs kept), `src/lib/genome/search-guidance.test.ts`, `e2e/genome-data.spec.ts`.
Changed: `src/app/(app)/genome/[subject]/data/browser/page.tsx` (rewrite), `src/app/(app)/genome/[subject]/data/page.tsx`, `src/components/browse/genome-browser.tsx` (copy imports, igv `show*` flags), `src/app/(app)/settings/page.tsx` (footer link), `eslint.config.mjs` (delete the browser ignore, reword the comment), `docs/adr/0009-statistical-presentation-contract.md:49-50`, `data/plain-vocabulary.json` (+`interactive`, `level`, `zoom`), `e2e/upload-vcf.spec.ts` (genotype selector; block/breadcrumb pins), `e2e/helpers.ts` (lift `firstViewportInteractives` from `e2e/overview.spec.ts:70-90`), `e2e/README.md`, `docs/acceptance-matrix.md` A5 row, `docs/protocol/decisions.md` (new "Expert path (W8)" section).
Untouched: `src/lib/figures/**`, `src/components/figures/**`, `src/app/api/browse/region/route.ts`, `src/lib/genome/load.ts`, `src/lib/primary-routes.ts`, `docs/route-register.json`, `scripts/eslint/no-raw-figure.mjs`, `src/app/globals.css`.

## 9. Build order and verification

1. Copy module + tests; vocabulary additions → `pnpm test && pnpm gate:readability`.
2. `locus.ts`, `search-guidance.ts` move + tests → `pnpm test`.
3. Browser page rewrite; `genome-browser.tsx` strings and flags → `pnpm typecheck && pnpm lint` (still with the exemption).
4. Delete the eslint ignore; ADR 0009 sentence → `pnpm lint` green with no exemption for the browser.
5. Data page; Settings footer link → `pnpm typecheck && pnpm lint && pnpm gate:readability`.
6. E2E edits and the new spec; README and matrix rows → `pnpm exec playwright test --list`.
7. Ledger entry.
8. Full: `pnpm typecheck && pnpm lint && pnpm test && pnpm gate:readability && pnpm gate:templates && pnpm gate:legal && pnpm gate:secrets && pnpm exec playwright test --list`, then `pnpm build`.

## 10. E2E: what is pinned today and what strengthens it

Today (`e2e/upload-vcf.spec.ts:48-98`, GIAB, serial): region query → `table` visible, rows > 0, `genome-browser` testid, canvas within 60s, `/does not contact an outside genome service/`; first-row rsID re-searched → first row contains `/^[ACGT](\/[ACGT])?$/`; `PRODH` → a row or "No reference variants known". `e2e/network-audit.spec.ts:110-141`: `?q=rs762551` origins first-party.

Changes: the genotype regex targets `[data-figure-kind="genotype"] [data-slot="figure-value"]`; the first-party string stays byte-identical. New `e2e/genome-data.spec.ts` on `e2e/fixtures/tiny-grch38.vcf` (rs762551 `0/1` → `A/C`; rs4988235 `1/1` → `A/A`):
- `?q=rs762551`: `main h1` = "Genome browser"; breadcrumb text `My Genome / {name} / Data / Genome browser`, links `/genome/me` and `/genome/me/data`; `[data-subject-bar][data-subject-id]`; exactly one `[data-claim-block][data-subject-id]`; exactly one `[data-figure-kind]`, it being `genotype` with `data-figure-class="variant-call"`, `data-figure-basis="observed"`, `data-provenance="computed:genome/browser"`, value `A/C`; `table [title]` count 0; `.eyebrow` count 0; h1 count 1, `h1,h2,h3` ≤ 6, `h4,h5,h6` 0; `#results` present; region section contains `chr15:74744576-74754576`; after canvas ready, first-viewport interactives ≤ 12 at 1280×800; `[data-figure-kind="percentile"]` and `[data-figure-kind="absolute"]` 0.
- `?q=CYP1A2`: row rs762551 `A/C`; any other seeded CYP1A2 row reads "Not covered by your file".
- `?q=BRCA1`: `role=status` contains the first clinical-gene sentence. `?q=caffeine`: a link to `/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551`. `?q=zzz`: no-match sentence and link to `/genome/me/reports`.
- `/genome/me/data`: breadcrumb `My Genome / {name} / Data`; `[data-figure-kind="coverage"]` count equals list-item count and > 0; list text does not match `/\d%/`; two outline links to `/genome/me/data/browser` and `/files`.
- Entry points: `/settings` link "Data and methods" → `/genome/me/data`; `/genome/me/ancestry` same; report footer already pinned.

## 11. Open decisions (default first)

1. Drop gnomAD AF and ClinVar columns / keep ClinVar as plain text with its gloss in a sentence under the table.
2. Remove the three example chips / keep them and set `showNavigation: false`.
3. Trim igv's navbar with the listed flags / leave igv defaults and accept the budget risk.
4. One `ClaimBlock` per table with `figures={[]}` and `<Figure>` children / standalone `<Figure subject>` per cell / W7's `renderFigures`. 4b: keep genotype letters in igv feature names (observed, canvas) / rsID-only names.
5. Defer `expert_mode` with a Settings link and ledger entry / build migration + toggle now (§4).
6. Data page h1 "Data and methods" / keep "{name}'s genome data".
7. Add the 200-row truncation sentence / stay silent.
8. Coordinates without thousands grouping / grouped with exempt comment.
9. Trait-suggestion titles from `report_templates` / keep hard-coded (already stale).
10. Leave the ancestry page's literal path to W7 / two-line fix now.
11. No axe run on the browser route (igv DOM) / add it to `e2e/a11y.spec.ts`.
12. Settings link in the Settings index footer / on `/settings/data`.
