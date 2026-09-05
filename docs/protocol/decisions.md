# Protocol decision ledger

This ledger is append-only. It records decisions that affect how acceptance
evidence is interpreted.

## 2026-09-01 — Naming-gate history boundary

- Decision: the no-comparator name gate scans the whole current working tree
  and every reachable commit message whose committer timestamp is later than
  baseline commit `864736979c92a08ba77e8580d61946eba6864918`.
- Reason: history published before that baseline remains part of the public
  AGPL provenance and the density evidence. Rewriting it would invalidate
  existing commit and tree identities without improving the shipped tree.
- Consequence: pre-baseline history is explicitly out of scope; current files
  are never grandfathered, regardless of when their text first appeared.

## 2026-09-03 — Consolidation onto `main` and the lost readability batch

- Decision: pull requests 11–40 were merged into each other's feature
  branches, not into `main`. The tip of that chain
  (`codex/readability-incident-response-remediation`, 32 commits) is merged
  onto `claude/inherit-service-redesign-3r43mb` and proposed to `main` as one
  pull request (#41). Further v2 work continues on that branch.
- Reason: `main` stopped at pull request 10; every later "merged" pull request
  was invisible to production and to CI on `main`.
- Consequence: the previous session's final readability batch (self-hosting,
  terms, state-privacy rewrites and runtime-copy extraction) was never pushed
  and could not be recovered from the remote. Its copy scope was redone here;
  the runtime-copy extraction remains open and keeps G1.10 at NO.

## 2026-09-03 — Modelled-figure marker string

- Decision: the once-per-claim-block marker for modelled figures is the gate
  string in G4.2, `This is a model, not an observed outcome.` The §4 §3.5
  sentence `This is a modelled estimate, not a measurement.` is not rendered
  in addition, because two sentences saying the same thing on every card is
  the caveat-stacking X0.1 forbids.
- Reason: §8 defines complete resolution and its detector asserts the G4.2
  string once per block; §4 governs what a surface may say but the two strings
  carry the same claim, so choosing the gate-checked one loses no accuracy.
- Consequence: `src/lib/figures/contract.ts` exports the single marker;
  `e2e` and unit tests assert it once per `[data-claim-block]`.

## 2026-09-03 — Natural-frequency denominator rule

- Decision: X4.1 governs. Denominators are 100, 1,000, 10,000, 100,000 and
  1,000,000; one denominator per claim block, the smallest that renders every
  figure in the block as an integer of at least 1 and keeps figures that
  differ by more than display precision distinct; otherwise the block renders
  `Fewer than 1 in a million, both for you and for the comparison group.`
- Reason: G4.1's two-rung rule (100, then 1,000) and §4 §2.3's four-rung
  ladder conflict with each other; X4.1 is the cross-cutting rule and says the
  matching regex must admit 100.
- Consequence: `src/lib/figures/natural-frequency.ts` implements the rule;
  tests pin the worked vectors.

## 2026-09-03 — Presentation decisions taken from the reconciled spec

Each item names the competing texts and the rule that decided it. The full
reconciliation is in the session's spec derivation; these are the defaults
the shipped code follows.

- Percentile withheld. Today's percentile is computed against one
  cohort-wide reference distribution with no named panel, no size and no
  interval, and no absolute risk exists beside it. X4.2 and §4 §2.5 forbid
  rendering a percentile in that state, so no surface renders one; coverage
  facts move to the expert data page.
- One not-diagnostic line everywhere: the §5 §6.1 sentence ("This is not a
  diagnosis. Inherit is not a doctor and no clinician has reviewed this.
  Talk to a qualified professional before acting on anything here."). G4.8's
  alternative sentence is not added as a second line; legality precedence.
- "What you can do" empty state uses §3 §2.2's sentence ("There is nothing
  you need to do about this result. It does not change what any doctor
  would advise for you today.") because X13.1 adopted that heading and §3
  defines the heading and its empty string as one unit.
- Layer group labels are "Specific variants" and "Statistical estimates"
  with §4 §1.3's definition sentences (X5.1); §2's "Single-gene findings"
  and "Whole-genome estimates" are not used.
- Starter list selects `layer = 'variant_call'` or
  `estimate_kind = 'single_locus'`, evidence in (clinical, established,
  emerging), categories outside Brain, memory and mood and Cancer, covered
  by the subject's files; the same reasoning X5.3 applied to the evidence
  clause applies to the layer clause (a day-one empty state would be false).
- Overview `h1` is "Overview" (nav-label identity, route register); §2's
  "Welcome to Inherit." sub-line survives as the State A lede. Section
  headings are "My Genome", "Family", "Embryos" (X9, nav labels).
- Copilot is a route, not a dock (X1.2); report-scoped chats use
  `/copilot/{subject}?report={slug}`.
- Legacy redirects are all 308 (route register is canonical, X1); the two
  temporary `redirect()` stubs are to be changed to `permanentRedirect()`.
- The State A "Show me what this looks like first" item renders only once
  `/example/report` exists; a dead link is never shipped.
- The eight subject colour tokens are added to `src/app/globals.css` as an
  extension (X2.4); a unit test pins the frozen identity tokens (G2.7) and
  the 3:1 contrast on both grounds in both themes.

## 2026-09-03 — Example surfaces and response headers

- Decision: no `/example/*` or `/demo` route is built. The route register's
  `supersededProposals` and `docs/canonical-artifacts.md` already reject
  every production, user-reachable example or fixture-derived result surface
  under G8.2, anti-pattern 2 and C6; the brief's X1.3 permission is the
  earlier draft. The Overview "Start here" strip therefore renders two items
  until an example surface exists, never a dead link.
- Decision: the register's `authenticatedUserData` header profile is applied
  in `src/proxy.ts` to every protected page, every `/api/` response and the
  proxy's own redirects. No such headers were set before; this is a
  privacy defect fixed under legality/security precedence.

## 2026-09-03 — Report skeleton, Overview and readability extension

- ADR numbering: the specification's A.12 names `0006`–`0015` for decisions
  the tree had already numbered differently (`0006` secret fixtures, `0007`
  name denylist, `0008` readability, `0016` transport). Accepted ADRs keep
  their numbers (the repository is ground truth, C1); new gating ADRs
  continue from `0009` and take the next free number, so the A.12 names are
  retitled, never renumbered over an accepted record. `0009` statistical
  presentation, `0010` Overview information architecture and `0011` report
  taxonomy are written from decisions this branch implemented; the
  jurisdiction, third-party consent, embryo-comparison, future-child and
  density ADRs wait for their workstreams so nothing in them is invented.
- The coverage sentence (`Your file covered {x} of the {y} positions this
  estimate uses.`) renders on the estimate layer only: it names "this
  estimate", so on a variant-call report it would be a false description.
- Copilot boxes for Family and Embryos link to `/family` and `/embryos`
  while `src/app/(app)/copilot/[scope]` serves only `me` and `s-{uuid}`; a
  dead link is never shipped (same rule as the example item).
- One home per mandated sentence: the not-diagnostic line and the estimate
  definition live in `src/copy/reports/strings.ts` and Overview re-exports
  them; the nav labels live in `src/copy/navigation.ts` and every breadcrumb
  and domain heading reads them from there.
- The plain-vocabulary check reads contractions as their full words
  (`don’t` is `do not`), because the mandated label `I don’t have one yet`
  must be checked on real words and registering `dont` as a word would make
  the register lie about what is plain.
- `classification` (alias `clinical classification`) joins the jargon
  register so the mandated layer definition (brief line 1178) grades at 6.3
  under the registered-term rule instead of failing at 9.1; the sentence is
  not reworded because it ships character-for-character.
- E2E specs read the seeded template count from `data/templates` through
  `seededTemplateCount()`; no spec hard-codes the library size.
- The subject chip and the subject bar carry `data-subject-id` as §2 §4.3
  and §2 §2.3 require; neither is an ancestor of a figure, so the X4
  single-attributed-ancestor rule is unaffected.
- The printable export shows the public evidence label; the machine-readable
  JSON export keeps the enum value so its schema does not change.

## 2026-09-03 — Review round on the report and Overview surfaces

Two of the four adversarial reviewers completed before the session's usage
limit stopped the refuters; their 22 findings were triaged by hand against
the specification digest and the code. Nineteen were confirmed and fixed,
three are recorded as follow-ups. Decisions taken while fixing:

- The report `h1`, the last breadcrumb crumb and the document title are the
  template title up to the first ` · ` (§4.3 item 3); the gene symbol is
  provenance, listed under "Where this comes from" with a dbSNP link and
  `chr:pos ref→alt`. A per-variant label stays in "Your result" only when a
  template has more than one variant, so a reader can tell the blocks apart.
- The coverage sentence and the study count are counts of positions and
  citations, not result figures: they render as text with the
  `inherit-figure-exempt` marker rather than as a second attributed claim
  block (`e2e/report-skeleton.spec.ts` pins exactly one block per
  single-variant report).
- "What this doesn’t mean" ships one generic bullet, `It does not say what
  will happen to you.`, true for traits and conditions, plus `A missing
  result is not a negative result.` when a position is not covered (D16);
  the former second bullet restated the not-diagnostic line.
- The reports list keeps the search input (`#report-search`, §4.4 item 7)
  but the category strip stays inside a `Filter reports` disclosure at every
  width: subject bar (2) + Why? (1) + search (1) + eight chips + three cards
  exceeds the twelve-interactive first-viewport budget at 1280×800.
- The kind chip is derived relative to the viewer: an adult record whose
  subject account is the viewer (an accepted invitation) is the viewer's own
  genome and reads "You"; a `minor` record renders no chip (D11); "Add a
  file" renders only on the `self` record because the upload path binds every
  file to the caller's own record.
- The subject-bar file count is the count of every file in the record,
  whatever its status, because the link lands on `/files`, which lists them all.
- Overview resolves State B (any file in flight) before C/D; a record bound
  to the viewer is never listed as another adult; the ancestry line renders
  only when the too-few-markers statement is true and never a "regions
  found" count (D26); the sidebar's second disclaimer is removed.
- Follow-ups, not fixed here: runtime links still use literal paths (task:
  `src/lib/primary-routes.ts`); the report h1 identity is re-checked by
  `gate:templates` once the prose checks land; the upload path honouring a
  subject segment belongs to the Family workstream (G2.6).
- The Overview's variant-call count carries a twelve-word-cap note shortened
  from the mandated definition (`Results read from one spot in your DNA.`)
  with the full definition rendered adjacent, mirroring the estimate half;
  the definition itself is eighteen words and X9.1 caps every metric note at
  twelve. Dormant until a `variant_call` template is published.

## 2026-09-03 — Template prose: titles without jargon, no naked relative figures (W5)

- `pnpm gate:templates` applies §4 §2.4 to `report_templates.summary` and
  `variants[].interpretations` exactly as the brief's binding check defines
  adjacency (a `%`, `x`, `×` or `-fold` token within 40 characters of
  "lower", "higher", "reduction", "increase", "less likely", "more likely" or
  "times"), and additionally treats any numeric multiplier ("1.4x the odds",
  "about 5 to 7 times", "1.7-fold") as a relative figure wherever it stands,
  because §2.4 bans the odds ratio itself, not only its symbols beside a
  comparison word. An `x` counts only when a digit precedes it, so
  "X chromosome" and "x-linked" are never findings.
- Inherit holds no absolute baseline to pair a ratio with, so a rewritten
  sentence keeps the direction and replaces the number with one phrase from a
  bounded set chosen from the ratio removed: below 1.15 "a very small
  shift", 1.15–1.5 "a small shift", 1.5–2.5 "a moderate shift", above 2.5
  "a large shift" (inverses for protective results; a range spanning two
  bands reads "a small to moderate shift"). Percentages that state how common
  a result is, and absolute differences with a unit, are not relative
  figures and stay. Nothing is added: no number, study, population,
  mechanism, caveat or advice the original lacked.
- The first-glance title (G3.5) is checked on the stored title: at most
  twelve words, no term or alias from `data/jargon.json`, no bare figure
  (a decimal, a percentage, a multiplier, or an integer followed by a
  quantity word; an integer inside a name such as "Type 1 diabetes" or
  "codon 72" is not a figure). Titles keep the existing `Topic · GENE` shape
  and change only the words that fail; the report page's h1 already drops
  the gene suffix.
- ADR 0012 widened from cancer/immune/embryo to every everyday word the
  specification itself mandates in a heading or a report needs for its
  condition's name (disease, vitamin, hormone, celiac, metabolism, trait,
  genome), because a register that forbids a mandated heading is a
  contradiction, not a rule; thirteen genuine terms keep it above 200.
- Each rewrite was produced against a written rulebook and a checker, then
  reviewed sentence by sentence by a second agent for preserved meaning; the
  five sentences that rose above grade 9 only because of the register change
  were rewritten by hand with the same rules.
- Global search (§2 §1.3) is a navigation surface separate from the
  reports-list filter (§4.4 item 7): the first returns destinations and never
  a value, the second narrows the visible library in place. Both ship; the
  digest's A21 default (drop the in-page input) is not taken because the
  list's disclosure already keeps the first-viewport budget and §4.4 pins
  `#report-search` structurally.

## 2026-09-03 — Ancestry surface (W7): decisions taken from the design pass

Design: the session's W7 design document (read-only pass over brief §4.6,
A.8, G4.4, X16.5/X16.6); every decision below takes its recommended default.

- No interval is invented. The estimator returns points; each share renders
  the explicit statement `no range yet` as its figure unit and the block
  states once that no range can be computed yet (G4.4's own disjunction).
  A marker-subsampling interval belongs to the science dimension and is not
  built here.
- With no interval, the lower bound used for fill opacity and the
  well-supported toggle is the point itself (floor 0.15, dashed hairline at
  0, no hatch until a range exists); a uniform floor would discard the
  proportions the numbers already state.
- Five continental regions named for places, never peoples: Africa south of
  the Sahara; Europe; South Asia; East and Southeast Asia; Central America,
  the Caribbean and the Andes. Their polygon recipes over Natural Earth
  1:110m physical features are mapping decisions and are recorded as such
  in `data/ref/regions/PROVENANCE.md`; sample sizes come from the 1000
  Genomes phase 3 sample panel, not from memory. The public label denylist
  (demonyms and ethnonyms only, no company names) lives beside the region
  set.
- Display shares are apportioned once by largest remainder to one decimal
  over the fixed set of five regions plus the unassignable remainder, so
  shown + `u` + `h` = 100.0 exactly in both toggle states.
- Below the reliability threshold the map is grey with no percentages, no
  toggle and no chips; raw numbers stay one activation away.
- No segmented control renders while only the continental tier qualifies:
  the mother's and father's lines have no dated, cited place mapping, and
  the page says so in one sentence rather than inventing one.
- The lineage cards use the §4 §7.5 sentence, not both mandated sentences;
  the no-Y card leads with the §2 sentence and keeps the pinned support
  note and XX gloss.
- The Neanderthal card states the true reason (the marker list has not
  been built and licence-checked), registered `withheld`; the
  sub-continental absence sentence is the true §4.5 sentence, not the A.8
  licence-audit sentence, because no audit has run.
- Geometry: Natural Earth 1:110m (public domain) reduced at build time by a
  committed script with devDependencies only, shipped as quantized
  TopoJSON under `public/geo/` with provenance, decoded on the server by an
  in-repo reader, projected in-app; no map library, no fetch, no CDN. ADR
  0013 (the brief's `0012-offline-map-rendering` renumbered).
- Figure contract: `range` on an ancestry share becomes the numbers or
  `{ unavailable: true }` and stays mandatory; shares print one decimal; a
  share without a range renders at body size; `ClaimBlock` gains an
  optional `renderFigures` so the table layout keeps one attributed block.
- A synthetic 168-marker VCF fixture, generated by a committed script and
  describing no real person, gives the shown state an E2E; the map SVG is
  marked `data-density-pixel-exclusion="map-tile"`.

## 2026-09-03 — Expert path (W8): decisions taken from the design pass

Design: the session's W8 design document (read-only pass over brief §7.3,
§1.4–§1.6, §2.2, X4, X6, X13 and the route register for `genome.data` and
`genome.browser`); every decision below takes its recommended default. The
work is sequenced after the ancestry surface because both change
`eslint.config.mjs`, `e2e/upload-vcf.spec.ts` and the ancestry page's link.

- The genome browser's results table becomes one attributed `ClaimBlock`
  per table with each genotype rendered as an observed `genotype` figure
  (class `variant-call`, provenance `computed:genome/browser`); rsIDs,
  coordinates and allele letters stay plain identifier text without
  thousands grouping, marked with the exempt comment the report page
  already uses. The last `inherit/no-raw-figure` ignore is then deleted.
- The gnomAD allele-frequency and ClinVar columns are removed: no figure
  kind honestly renders a population allele frequency (an `absolute` figure
  is a per-person chance), a clinical classification beside a raw genotype
  without the report skeleton's "How sure we are" apparatus is a naked
  clinical claim, both are null on every seeded row, and their `title`
  glosses breach §1.6.
- The three example-query chips are removed and the embedded track's
  navigation is trimmed to locus search and zoom through the library's own
  display flags, so the first viewport at 1280×800 stays within the twelve
  interactive elements X6.1 allows even with the track in view.
- `expert_mode` (§7.3) exists nowhere in the schema or code. The missing
  Settings entry point to "Data and methods" is added now; the toggle is
  deferred, because no collapsed methods block lives on the two pages in
  scope and a switch that changes nothing on the surface that carries it is
  a false affordance. The migration and toggle are specified in the design
  and belong with the first surface whose methods blocks it would expand.
- The data page is titled "Data and methods", the words on all three entry
  links; its duplicate "{x}% of this score's positions" sentence goes,
  leaving the `coverage` figure as the one statement of panel coverage.
- Every string on both pages moves to `src/copy/genome/data.ts`; the
  trait-suggestion titles are resolved from `report_templates` at render
  rather than hard-coded (one is already stale); a sentence states the
  200-row result limit; locus parsing moves to a tested module and the
  rsID search uses the cross-file lookup so two files that disagree render
  the existing disagreement sentence instead of one file's genotype.
- Coverage: the three GIAB browser tests are retargeted to the figure node;
  a new `e2e/genome-data.spec.ts` on the tiny fixture pins the block, the
  four contract attributes, breadcrumbs, the heading cap, the interactive
  budget, the three entry points and the absence of percent text on the
  data page.

## 2026-09-03 — Ancestry surface (W7), part A: decisions taken while building the foundations

- The named Natural Earth features are drawn at a finer resolution than the
  1:110m land they mask, so a literal `land ∩ feature` cut produced ragged
  double coastlines and a 439 KB file. Each feature that selects land is
  simplified and dilated by 0.4° before the cut; features subtracted to keep
  a continental division (Asia and Africa from Europe, Asia and Europe from
  Africa, the Tibetan plateau from East Asia) stay exact, so the Urals,
  Caucasus and Suez lines are Natural Earth's own. Interior edges of dilated
  features therefore sit up to 0.4° outside the named feature; both
  provenance documents say so.
- The geometry file's `land` object is the land outside every region, so the
  six objects tile the map without overlap and share arcs; the page draws the
  remaining land as one path with no runtime clipping, and the build fails if
  any two regions overlap.
- Population sizes were counted from the 1000 Genomes phase 3 sample panel
  fetched by the build (55,156 bytes, SHA-256 recorded), and each `sampled_in`
  place was taken from the Ensembl populations endpoint's descriptions on the
  same day; nothing was copied from the design note.
- Citation ids on the region set use the repository's `doi:` form; the
  `allowed-external-names` register gains Natural Earth (public-domain
  reference dataset) and the raw GitHub host the provenance URLs use, because
  the names gate scans `docs/` and provenance must name its sources.
- Antarctica's land polygons are not shipped: the projection clamps latitude
  at −56° and nothing is drawn below Cape Horn.

## 2026-09-03 — Medicines category (X15): the absence is stated; the terminal status waits on a dossier

- The reports list now states in one place that Inherit has no reports about
  medicines and why, so the category is no longer silent (X15: "silence
  about a capability is never a withholding"). The statement is a paragraph,
  not a section, so no link can target an empty group.
- A read-only research pass (primary sources only, every URL and access date
  recorded in the session's research note) verified GRCh38 coordinates for
  fifteen candidate single-position pharmacogenomic reports against three
  sources and their guideline citations against PubMed and the guideline
  body's own publication table. Its findings: the guideline body's curated
  content is CC0 with attribution requested; the companion knowledge base is
  CC BY-SA 4.0 with an unresolved research-use term; the allele-definition
  registry's terms could not be read; only five candidates could render
  honestly, and each as a bare genotype rather than the response to a
  medicine the category promises; the specification puts star alleles in the
  variant-call layer, which has no renderer; and the copilot guard the
  specification requires for medicine questions does not exist.
- Decision: do not populate the category with bare-position reports. The
  terminal status is `withheld` with a dossier classified safety (primary)
  and scientific (supporting), which requires three materially different
  designs to be built and shown failing a named gate; that work is open and
  the capability register keeps the row at `not shipped` until then.

## 2026-09-03 — Ancestry surface (W7), part B: decisions taken while building the surface

- The region table has three columns, Region · Share · In words: "Markers"
  is a term of art and may not head a column, the markers-used count is a
  property of the file rather than of a region, and the range is already the
  share figure's own unit. The markers line and its coverage figure render
  once under the table inside the same claim block.
- The region panel lists each reference population as "{code} — sampled in
  {place}" without the sample count: a count of people is a number no figure
  kind carries, and the place is what the sentence is for.
- The sub-continental sentence ships as two sentences; the design's single
  sentence scored grade 9.0 in the gate.
- A subject with no stored result sees the grey map and one sentence,
  "Nothing to show until a file has been processed.", so the six headings
  stay fixed across every state.
- The §4 §7.5 single-line sentence renders only when a line was read; the
  §2 no-Y lead renders only when the stored row has no tested markers (the
  file carried no Y data), never for an insufficient call; the haplogroup
  definition renders once, on the mother's card.
- The toggle is a `<button role="switch">` at 44px because the shared switch
  primitive is 1.15rem tall; it changes only which rows, paths and chip
  values show.
- The readability gate reads "what’s", "it’s", "that’s", "there’s", "here’s",
  "who’s", "where’s" and "how’s" as two words, so the mandated toggle label
  is checked on real words; a non-word entry in the plain vocabulary was
  rejected.
- The GIAB browser test pins the grey state to the exact mandated sentence
  with the measured counts (`\d+ of \d+`), never a fixed number.

## 2026-09-03 — Expert path (W8), built: decisions taken while building the surface

- The genotype column is headed "Your two letters", the words the report page
  already uses, because the term of art may not head a column.
- Trait topics are ids in the guidance module; their user-facing phrases live
  in the copy registry, so no user-facing string remains under `src/lib`.
- The track's locus controls are named "Search by position" and "Go to
  position" so no track control shares the page's "Search" button name.
- A single-position locus query centres a 10 kb window on the position, the
  same window an rsID search uses; a reversed range is ordered, not rejected.
- A trait match whose reports are unpublished falls through to the no-match
  sentence rather than an empty suggestion box; the three example chips and
  their constant are gone.
- The region row limit is the page's constant and the truncation sentence is
  built from it, never retyped.

## 2026-09-03 — Family surfaces (W9): decisions taken from the design pass

Design: `docs/design/w9-family-surfaces.md`; every open decision below takes
its recommended default.

- A person who accepted an invitation but has granted nothing shows the
  state line "Waiting for {name} to share"; "No file yet" would be false and
  would leak whether a file exists.
- A health-picture cell renders the observed genotype figure, the layer chip
  and an "Open" link; interpretation stays on the report page.
- A shared adult's report page derives its domain crumb from the subject
  class (`Family / {name} / …`), never "My Genome" over someone else's data.
- `/family` moves to its own route group with an auth-branching layout and
  the app shell extracted, keeping the two public panels ahead of the
  signed-in hub; no second hub path is registered.
- The Tier-2 acknowledgement ("I understand this can tell me something I
  can’t un-know.") is remembered in an httpOnly session cookie cleared at
  sign-out, never in local storage, and the pages fetch nothing derived until
  it is set.
- The Portrait distribution sentence is §2's "Out of 100 possible children,
  about {n} would {outcome}."; a sub-1% category, when banded traits exist,
  renders in its own claim block at 1,000 with the exception recorded.
- No chromosomal-sex expectation card renders until a citation exists.
- Portrait registers as `shipped-degraded`; runs of homozygosity are computed
  per file where measurable and refused with the named reason otherwise.
- The refusals heading is "What Portrait will not tell you, and why".
- Joint surfaces carry no subject bar; column headers and the banner carry
  both full subject chips. The layer chip per cell is label text with the
  definition once per table.
- A family pair is created on the first portrait grant in either direction
  (status pending) so the blocking screen can name the other person's
  missing steps.
- Build order F0 (migrations, RPCs, jurisdiction reader, register rows) →
  F1 (graph, hub, person, permissions, invite copy) → F2 (health picture and
  carrier pairs) → F3 (Portrait); the pure libraries may be written in
  parallel with F1.

## 2026-09-03 — Medicines category (X15): pharmacogenomics is withheld, on three built designs

Dossier: `docs/withheld/pharmacogenomics.md`; ADR:
`docs/adr/0018-pharmacogenomics-withheld.md`; research:
`docs/design/pharmacogenomics-research-2026-09-03.md` (every URL read
2026-09-03). This closes the decision the earlier Medicines entry left open and
the brief records at line 2785.

- Three materially different designs were built and kept as evidence under
  `docs/withheld/pharmacogenomics/designs/`, each with its fixture and a
  `gate-output.md` recording the command, exit code and verbatim output of
  `pnpm gate:templates` and `pnpm gate:readability`. Guideline-level response
  statements fail both gates (`BANNED_PATTERNS`; grade 12.0 and 10.4 against 9,
  plus four unregistered title words). Bare single-position reports pass both
  and are kept as the control; they fail the taxonomy, §7.1 slot 2 and the FTC
  net-impression standard instead. The diplotype caller fails `bad ref/alt` on
  rs1142345’s two alt alleles, and its two-entry workaround passes the gate
  while dropping the *41 allele silently in `scripts/seed.ts`.
- Every run was made in an isolated worktree of `b6c6877` (`git worktree add`,
  `node_modules` symlinked) with one preparatory change applied there only:
  `"pharmacogenomics"` in the validator’s `CATEGORIES` and in the taxonomy’s
  legacy slugs and defaults (→ `medicines`), so each design fails on its own
  defect rather than on `bad category`. No fixture was ever placed under
  `data/templates/` in the main tree, and the worktree was removed afterwards.
- The obstacle is classified **safety (primary), scientific (supporting)**. Not
  legal: the guideline body’s curated content is CC0 1.0 and PubMed citation
  needs no new licence entry. Not data-availability: the research pass retrieved
  the data. Two legal questions stay live and unresolved, recorded rather than
  assumed — whether the companion knowledge base’s research-use term survives its
  CC BY-SA 4.0 grant, and the allele registry’s terms, which could not be read at
  all and are UNVERIFIED.
- The §6.4 blocklist rows enter the gate: `\bdosage\b`, `\bsupplement\b` and
  `we recommend you take` join `BANNED_PATTERNS` in
  `scripts/validate-templates.ts` under the label `treatment advice (§6.4)`,
  pinned by the new `scripts/validate-templates.test.ts`. Brief line 913 bans
  them outside a refusal string and template prose is never a refusal string.
  No shipped template uses them, so the rule lands green.
- The UI state changes from "Inherit has no reports about medicines." to
  "Inherit does not offer reports about medicines." A withholding states that the
  capability is not offered; "has no reports" reads as an inventory gap that will
  fill. The sentence is 33 words at grade 6.58 and carries none of "coming soon",
  "soon", "yet" or "currently", because dossier element 6’s conditions depend on
  outside parties: a guideline body’s published position on consumer wording, a
  net-impression judgement by a competent reviewer, and what sequencing providers
  put in a file. `e2e/report-skeleton.spec.ts` pins both the sentence and the
  absence of those four words.
- Registers moved with it: the capability register’s Pharmacogenomics row is
  `withheld` with the dossier, ADR and the three gate outputs as evidence, and
  its counts line reads withheld 1 · not shipped 9; the acceptance matrix reports
  one withheld capability at the top and G7.4’s evidence names the dossier (the
  gate stays NO while nine rows carry `not shipped`); D-015 is fixed; the
  approach registry carries one rejected row per design.

## 2026-09-03 — Embryo surfaces (W10): decisions taken from the design pass

Design: `docs/design/w10-embryo-surfaces.md`; every open decision takes its
recommended default. Where the brief's own text conflicts with a later
cross-cutting rule or a canonical row, the later rule governs (X0.1) and the
design records the superseded line:

- An embryo is named only by its ordinal, derived from the laboratory's
  column order and never from its text; no sample, cycle or clinic label is
  persisted, rendered or logged. Every embryo's disc is identical, so no
  subject colour is assigned: uniform treatment is mandated for a comparison
  where a colour would read as a verdict.
- Sex is filtered at ingest and appears in no response shape, so the
  consented sex disclosure the surface section describes is not built; it is
  a refusal, not a withheld capability.
- The comparison renders in ordinal order with no sort control and no lead
  count. The joint-selection constraint is satisfied by statement and by
  naming one real conflict, never by a computed ranking; the passages that
  would order conditions by spread or count how many rows an embryo leads
  are superseded and are not built.
- A laboratory PDF is refused before any durable byte, so the acceptance
  item requiring a stored, hashed PDF record is superseded by the accepted
  transport decision and is recorded as such rather than left failing.
- Nothing is shown for one embryo before the whole set publishes: a partial
  ingest failure resolves as one terminal transaction, and the progress
  panel carries no ordinal, count or existence signal.
- Today the condition registry is deliberately empty, so both result
  surfaces render one sentence saying no calibrated model is registered
  while the quality check remains real. That is `not shipped` with an
  honest state, not a withholding: a withheld dossier needs three built
  designs and primary-source evidence the science dimension has not
  produced.
- The result gate is shared with Family, with one cookie per domain, so an
  acknowledgement on one boundary never silently opens the other.
- Build order: platform prerequisites, then the surfaces in their honest
  states, then the ingest flow, then the findings, which wait on the science
  dimension and the mandated reviews.

## 2026-09-03 — Family surfaces (W9), part F1: decisions taken while building

- One resolver serves both domains for a subject-derived route. A family
  segment whose grants are all gone answers 404, not a gate: a reader who
  passes a gate to find nothing has learnt that the record exists, so pause
  and stop deny on the very next request in the same way an unknown record
  does.
- The jurisdiction, paused and nothing-shared states render before the
  Tier-2 gate on a person's page. A gate in front of nothing says less than
  the sentence it would hide, and neither branch fetches anything derived.
- After stop, the person's page keeps its empty state rather than answering
  404, because the mandated tombstone lives under that person's permissions
  page and a 404 would orphan it; the genome routes do answer 404.
- A person's page renders its own compact per-layer list rather than reusing
  the full report library, whose search box, filter strip and per-category
  controls would break the first-viewport interactive budget.
- The ancestry page was extended with the same family resolution and grant
  check, because the person page links to it and a link that 404s is a dead
  link.
- The invite note reaches the invitation mail through the existing draft
  route and the queued payload; the template renders it as words, never as a
  link. No other transport exists without a migration, and the migrations
  for this work are final.
- The stop operation's nonce is a short-lived keyed envelope bound to the
  session's account and counterpart rather than a stored row, because the
  existing nonce table constrains its operation column to the two
  account-deletion values.
- A display label is never the self placeholder: the counterpart's own label
  is used, then the handle's, then a neutral fallback, because no screen
  collects a display name and printing "You" as another person's name is
  wrong.
- The subject chip now reads another account's self record as a shared
  adult: the invitee's view of the inviter is that person's own self
  subject, which the previous rule chipped as the viewer.

## 2026-09-03 — Family surfaces (W9), part F1 follow-up: the independent-login marker, ADR 0014 and two spec fixes

- The independent-login marker is stamped from two places, not one. The
  register names the auth callback, but the password sign-in runs in the
  browser and never passes through a server route, so the marker would never
  be set on the common path and every Portrait grant would fail (D-023). The
  proof that the session is the invitee's own lives in
  `mark_independent_login_v1` (a server-verified session that post-dates
  every accepted invitation, stamped once), so calling it from the
  permissions page's server render loses nothing and makes the Portrait row
  real. The register is not edited: the routine's contract is unchanged, and
  the page-side call is recorded here and in ADR 0014.
- Until the marker is stamped, the Portrait row renders locked with its
  reason rather than as a control that would answer 409: a control without
  its mechanism is a dead control, and the row's state still shows.
- ADR 0014 is written from the model the F0 migration and the F1 surfaces
  implement, with the alternatives the repository's own constraints reject
  (one self subject per account, one purpose per grant, no reversible grant
  status, no device storage for the Tier-2 choice). The A.12 name is kept as
  the ADR's stated G7.1 name; the number is the next free one.
- The two browser assertions F1 added and CI first executed were wrong, not
  the product: the invitation spec's `form` locator is now scoped to the
  invite form, and the hub's axe helper reloads in each theme before
  auditing, as every other spec does (D-024, D-025).

## 2026-09-03 — Portrait copy: brief examples are not mandates; X10.1 names are

Context: the readability gate (G1.10, grade ≤ 9) failed on four Portrait
strings. Two are refusal reasons the brief introduces with "Example:"
(`brief:358`, height; and the polygenic refusal prose at `brief:1365`); one is
the Disclosure label the brief quotes verbatim (`brief:801`, "See these numbers
as a table"); one is the X10.1 trait name "Rh type".

Decision:
- A string the brief marks as an example illustrates the rule (one sentence,
  the true reason) and is not shipped verbatim; both were rewritten at or
  below grade 9 with the same meaning and no added claim.
- A string the brief quotes as the label of a control ships verbatim; its
  plain words (`these`, `numbers`, `table`) are registered in
  `data/plain-vocabulary.json`.
- "Rh type" is the name X10.1 gives the trait; `rh` is registered as a term of
  art with no plain substitute. No gate exemption was added: the gate stays
  the single ceiling for every string.

## 2026-09-03 — Carrier pairs: the closed reason table has eight rows, and runs are measured at ingest

Context: the adversarial review of the F2 commit (`c6dd140`) held eight
findings against brief line 346 and line 1349 (D-030 to D-037).

Decisions:
- The trigger is gene-level, as the brief says (line 346, "in the same
  gene"): each person's own heterozygous pathogenic or likely pathogenic
  variant in the same gene, same position or not; the block names each
  person's variant and classification. The design's same-position rule
  was narrower than the brief and the brief wins (X0). One verifier read
  the design as binding; the brief's text is quoted above.
- The closed reason table is the design's six phrases plus two: `sex-unknown`
  (an X-linked pattern, until a sourced writer for chromosomal sex exists;
  D-031 stays open) and `two-copies` (a file that shows two changed copies).
  A failed trigger never drops a pair from the panel.
- Runs of homozygosity are measured once, at ingest, from the parsed calls
  the processing route already holds, and stored per file on
  `genome_files`; no request-time read budget exists any more. The measure
  stays a fact about one file and is never compared between files.
- With no classified reference position the panel says so in words, never
  "checked the 0 positions".

## 2026-09-03 — Health picture: what `family.heritability` alone may show

Context: the register's `multiSubjectLayer` rule makes `family.heritability`
the authority for the joint comparison and never for an individual result
layer (D-038). The rework moved each cell's genotype figure and its "Open"
link behind the layer's own grant from that person.

Decision: the column itself, the carrier panel, the "No baseline" footer
and the coverage figure ("read N of the M positions" of a layer) stay on
`family.heritability` with the three capabilities. Coverage is a count of
positions a file reports, a fact about the file's reach and not a result
about the person, and the joint comparison cannot be described without
it. Anything that reads a letter from another adult's file needs that
layer's grant.

## 2026-09-03 — Runs of homozygosity follow a cited definition

Context: D-040. The brief (line 1349) mandates F_ROH from total runs of
homozygosity with the thresholds 100 Mb and 0.0156, but gives no
definition of a run; the first measure counted any two adjacent
same-reading calls and refused every real array file.

Decision: a run is defined as McQuillan et al. 2008 define it (American
Journal of Human Genetics 83(3):359–372, doi:10.1016/j.ajhg.2008.08.007;
read at PubMed Central on 2026-09-03): a stretch of at least 25
contiguous same-reading autosomal calls spanning at least 1.5 Mb, with at
most one heterozygous call inside it. F_ROH is the sum of run lengths
over the autosomal span the file covers; the paper divides by the
autosomal length its panel covers (2,673,768 kb), and Inherit's
file-covered span is the same idea applied to the file at hand, which
for a sparse file only raises F_ROH and so refuses more, never less. A
file that reports no reference-homozygous call (a differences-only VCF)
cannot show a run and is `not_measurable`. The citation renders beside
the carrier block as its provenance, and the constants have one home in
`src/lib/family/roh.ts`.

## 2026-09-04 — Copilot guard: refusal ids, ordering and transport

Context: brief line 2262 requires `src/lib/copilot/guard.ts`; the dossier
for Medicines names it as condition A item 1. The route register listed
seven refusal ids and a JSON refusal body.

Decisions:
- The refusal ids are the nine the guard emits: `selection-advice`
  (which folds the register's `ranking`, since brief line 402 gives the
  two one string), `sex-disclosure`, `prohibited-portrait`, `treatment`,
  `diagnosis`, `prognosis` (the register's `diagnosis-or-treatment` split
  in three, one fixed string each), `cross-subject`, `unsupported-number`
  and `unsupported-citation`. The register's list is updated to match.
- A message no rule matches is allowed; ambiguity is not modelled, and
  the rule set is a table in one file with a 68-row test, not a model.
- The refusal is served on the UI-message-stream transport the client
  already reads, status 200, with `x-copilot-refusal: <id>`, until a
  structured completion contract exists; the completion is buffered in
  full before its first byte, so the "streamed answer" of A9 is now a
  buffered answer delivered whole. The `feature.blocked` event has no
  table yet; the route logs the class only.
- Two consequences of the brief's regex are recorded rather than worked
  around: `1,000` splits into two allowed integers, and an ISO date yields
  negative tokens; both are pinned by tests.

## 2026-09-04 — Copilot guard: corrections after the adversarial review

Context: the four-lens review of branch `copilot-guard` (D-042 to D-051)
plus two findings that changed no rule.

Decisions:
- The checked string is everything the model authored, never only its
  visible text. Outputs of Inherit's own tools are the permitted set, not
  a claim, and are not folded in; an output a provider executed itself is
  the model's and is. Reasoning is never forwarded to the client.
- A bare-verb treatment question stays gated when its object is unnamed
  ("Should I stop?"); the over-block is the fail-closed posture the review
  accepted. The one exemption is a product object ("Can I add a second
  genome?", "Should I switch to a local model?"), read as the verb's own
  object within three words.
- A spaced "5 %" is a bare integer to the brief's regex and passes the
  small-integer range; the behaviour is pinned, not worked around.
- A citation is a whole-token match against a permitted label; an answer
  may also name a report or score by the `title` or `name` the tools
  returned, and the product by its own name, and nothing else.
- Every earlier user turn is classified again on every request. The
  client keeps its thread; the model never sees a refused turn.
- A cohort-scoped prompt cannot be sent until a cohort chat route exists;
  the spec says so, and the cohort-only rules rest on the unit table.
## 2026-09-03 — Medicines: the operator lifts the withholding for the honest subset

Context: `docs/withheld/pharmacogenomics.md` (D-015, ADR 0018) classified the
obstacle as safety (primary) and scientific (supporting) and named two
testable conditions, parts of which depend on a person's judgement rather
than on code. On 2026-09-03 the operator, in this session, approved shipping
the Pharmacogenomics ("Medicines") section in full and directed that no other
section be degraded.

Decision, and what the approval does and does not change:
- The approval is the operator's judgement on the safety class (dossier
  condition A, items 3 and 4): the "What you can do" collision is resolved by
  a Medicines-specific string that is true and is not treatment advice, and
  the category's net impression is accepted by the operator. No competent
  reviewer's claim entry exists; the register says so until one does.
- Condition A, item 1 (the Copilot intent guard of brief line 2262) is inside
  the operator's control and is built before the category renders; item 2
  (the §6.4 blocklist rows) stays in force.
- The approval does not change the science (condition B): a metabolizer
  phenotype needs the pair of gene copies, which an unphased consumer file
  cannot supply, so no report states a phenotype, a dose, a drug choice or a
  response. What ships is what is true: per-position reports in the
  `variant_call` layer, where brief line 1163 places pharmacogenomic star
  alleles, saying which letters the file shows at a position a CPIC guideline
  names, which named forms carry that letter, and what the position cannot
  tell the reader; sources are CPIC (CC0 1.0), dbSNP and PubMed only, with
  the guideline's PMID and the access date on every template.
- Candidates excluded on the research note's verified facts stay excluded and
  are named in ADR 0021: CYP2D6 (structural variation), HLA-B*57:01 (a proxy
  that must not be imputed), IFNL3 (retired), UGT1A1*28 and TPMT *3C
  (multi-allelic, outside the schema), G6PD (X-linked, no haploid key).
- The category description no longer promises "how your body may respond";
  it says what the reports are.
- Currency: every template carries the guideline PMID and the date it was
  read; the register records that CPIC content is subject to updates and
  that Inherit has no automatic detection of a superseded guideline yet.
- Nothing else is removed or weakened: the only subtraction is the absence
  paragraph the category replaces.

## 2026-09-04 — Medicines: where the category may and may not appear

Context: with eleven `variant_call` templates the reports list, which
groups by layer in the taxonomy's order (`variant_call` then `estimate`),
opens on the Specific variants group, which today is Medicines alone; and
the Overview's starter list admits covered `variant_call` templates.

Decisions:
- The layer order stays the taxonomy's: a call on specific variants is the
  higher-evidence layer of brief §1.1 and lists first. The library is a
  library; prominence there is not a nudge.
- The Overview's "reports to read first" list excludes the `medicines`
  category (alongside cancer and brain, memory and mood): a
  medication-related genotype is never offered as a first read, because the
  Overview's net impression must not steer anyone towards it.
- The Overview's split string now shows both halves ("N specific-variant
  reports · M statistical estimates"), never summed, per X5.2.

## 2026-09-04 — Medicines: corrections after the adversarial review

Context: the four-lens review of branch `medicines` (sixteen findings, one
already fixed, one a merge-order matter for the orchestrator).

Decisions:
- The reports list opens on the general library (the estimate group) when
  it has any report; the Specific variants group is a tab. This amends the
  entry above: the layer order of the tabs stays the taxonomy's, and the
  default view is the library a reader came for.
- A seed template in the `variant_call` layer is stored with a null estimate
  kind whatever the file says (`scripts/seed-layer.ts`); a reading of
  letters is not an estimate of anything.
- No title or summary claims a form from one position: the CYP2C19
  rs12248560 report is titled as a bare position, and forms are named only
  as the forms that carry a letter.
- ADR 0021 states that six of the eleven shipped positions are ones the
  research note marked exclude, and why each ships as a bare position under
  the operator's decision: every reason the note gave concerned a phenotype
  claim, which no report makes.
- "What you can do" for Medicines reads "Inherit does not say what any
  doctor should do with this result. You can show it to any doctor you
  choose." — two sentences, no implied relevance.
- The Medicines rows of `scripts/validate-templates.ts` are mechanical and
  read every prose field; a citation label is exempt only because it is the
  cited work's own title. Every Medicines sentence is at most 25 words, on
  the readability gate's splitter.
- The DPYD report leads with "This is one of the positions guidelines list
  for DPYD. C on both copies here says nothing about the other positions,
  which this report does not read." — no phenotype, no count Inherit did not
  read.
- CPIC is defined at its first mention in every summary. The CPIC endpoints
  read on 2026-09-03 exposed no version number; each source records
  `version: null` with a note, and none is invented.
- A `variant_call` report's evidence chip reads "This position is named by a
  published prescribing guideline. Inherit reads the letters only." rather
  than a sentence about replication and sibling checks.
## 2026-09-04 — Portrait page (F3b): the decisions the build took

Context: `/family/portrait/[pairId]` built on the F3 libraries and F2's
carrier pairs; ADR 0015 moved to Accepted with thirteen decisions. The
ones that depart from the design or the mockup, with their reasons:
- A missing processed file is not a blocking-screen step: whether another
  adult has a file is a derived fact the gate withholds on every Family
  surface, so it is read after the gate and rendered as the outputs'
  "no file yet" sentence.
- A paused pair renders the pause sentence, not a step nobody left undone.
- Output cards and "How sure we are" are labelled sections, not headings,
  so the page stays at three headings under the six-heading cap however
  many cards render.
- The viewer's own missing steps read in the second person.
- One refusals link after the list (to `/science` until `/science/limits`
  exists), within the interactive budget.
- One-sided readings (one parent shows a copy, the other's covered
  positions show none) render the brief's exact sentence and no
  distribution: the only cross would show zero affected, contradicting
  "not zero risk"; they are restricted to registry-recessive genes; two
  copies on one side renders nothing because the brief gives no sentence.
- Deletion is the viewer revoking their own `family.portrait` grant
  through the existing consents route and `revoke_directional_purpose_v1`,
  which removes the pair's `portrait_results` and returns the pair to
  pending; no new routine.
- Open decisions of the design: 6 (the §2 sentence form), 6b (a sub-1%
  category in its own 1,000 block, unreachable for exact fractions),
  7 (the chromosomal-sex expectation exists in copy and is not rendered
  until a citation id exists), 10 (the refusals heading), 11 (one pair
  bar with both chips). D-031 stays open: an X-linked pair renders the
  refusal; the cross exists in `mendel.ts` unrendered.
- Interface extensions on F2's side: `CarrierPairSummary.genotypes`
  (additive) and `files: number | null` on the health-picture column.
- Requests: a `--line-strong` token (the page uses `border-ink`);
  `/science/limits`; a schema note that today every `family.portrait`
  pair has two accounts, so the "opened their own account" step is
  reachable only by a future Path B record.

## 2026-09-04 — Portrait: corrections after the adversarial review

Context: the four-lens review of branch `family-f3b` (D-052 to D-058) and
three findings that changed no rule.

Decisions:
- The closed reason table has ten reasons. `runs-above-threshold` (a
  measured file above a threshold) is the only reason Portrait renders the
  brief's line-1349 refusal for; `runs-unchecked` renders the side-by-side
  page's sentence with its own phrase, "one file has more long identical
  stretches than Inherit's limit allows" for the former and "Inherit could
  not check…" for the latter, because "could not check" is false of a file
  Inherit measured. `not-covered` names a position one file does not
  report; nothing is imputed.
- The exact 25-in-100 arithmetic needs each file to report the position
  the other person's reading names; otherwise the card renders the
  cannot-calculate sentence naming that person and position, and never
  "Both files cover the positions this uses".
- A gene with a one-sided reading renders that reading alone on Portrait;
  the carrier rule's refusal for the same gene (the other side's change
  harmless or of unknown meaning) stays on the side-by-side page, where
  its sentence is about the two changes and not about a child.
- No sentence slot takes the first-person placeholder. The viewer's
  sentences have second-person forms ("Your file does not cover rs…", "You
  haven't added a file yet", "we found no second copy in you"); the other
  person is named by the graph's label.
- On an exact block the runs measure is listed under "What we checked",
  since it was measured; "What we do not check" keeps the true assumptions.
- Deleting Portrait revokes the viewer's own grant; the dialog says so and
  that the page opens again when the viewer turns Portrait on again.
- The acknowledgement form renders only when the acknowledgement is the
  viewer's one remaining step.
- Line 356's talent, athleticism, attractiveness and skin tone each have a
  refusal card. The brief's two reasons are examples, not mandates: the
  intelligence one is used as written, the height one keeps its grade-9
  rewrite (the "Portrait readability" entry above); a reason may run to two
  sentences, as the brief's own example does.

## 2026-09-04 — Embryo E1: corrections after the adversarial review

Context: the four-lens review of branch `embryo-e1` confirmed thirteen
findings (D-059 to D-066).

Decisions:
- A reason id is a member of the register's closed tables or the shape
  fails; the renderers never emit a raw value. A quality reason names a
  `quality_not_measurable` state and a result-level reason a `not_covered`
  one.
- Source strings are bounded labels from `data/embryo/source_labels.json`,
  a closed registry that is withheld and empty until reviewed organisation
  and assay names are registered; an original laboratory label never
  passes the shape and is never rendered.
- One cell never attributes two numbers to the general population: the
  embryo's own figure is captioned as the embryo's.
- `measured_inconclusive` has its own true sentence with its citation; the
  brief-1318 comparison sentence stands beside any score not shown to hold
  up between siblings.
- The figure contract gains one kind, `measure` (a value with a unit and a
  decimal count), for quantities that are neither probabilities nor
  counts: a mean read depth is the first.
- A read that fails is the design's `error` state, never an empty list, a
  404 or "Still checking the files".
- The flag-off jurisdiction refusal is proven in a browser by a second
  Playwright project against a second server from the same build; the
  main suite keeps the TEST-LOCAL flag.
- Sign-out ends both Tier-2 acknowledgements; the embryo gate's writer and
  reader are one function pair.
- The waiting sentence names whose grant is missing: the viewer's, the
  other parent's, or both parents' for an uploader who is not a parent.

## 2026-09-04 — Embryo E2, slice 1: the upload flow before E0

Context: design `docs/design/w10-embryo-surfaces.md` §10 makes E2 depend on
E0 (the eight RPCs, the nine `api.embryo-*` routes, the browser sanitiser,
the worker), none of which exists. The design's own rule for that state is
that `/embryos/upload` renders steps 1–2 and, at the file step,
`EMBRYO_INGEST_AVAILABLE = false` with "Inherit cannot take embryo files on
this site yet." and the request-data link — never a dead control.

Decisions:
- Steps 1 and 2 ship; the flow ends on the honest terminal, and the same
  sentence stands above step 1 so nobody answers questions for a control
  that does not exist on this deployment.
- One question per screen, every screen labelled "Step N of 5" with what
  is still to come (brief line 1083). Three questions on one screen would
  carry ten interactive elements against X6.1's seven; the design's step is
  a stage, not a screen.
- The second parent's contact email (brief line 383), the Tier-2 signature
  block (brief line 1752) and the identified-donor option (brief line 1732)
  are not asked for until `api.embryo-cohort-drafts` exists. Collecting a
  contact or a typed legal name that nothing records is a false
  affordance; they return with the draft route. The class attestation
  checkboxes route the flow and the screen says nothing is kept until both
  parents sign.
- "I don’t know — let me upload it and you tell me" is an answer and a
  step in one: it moves to step 2, since the file step it once led to is
  the terminal today.
- The A.6 refusals live once in `src/copy/upload/errors.ts`, re-exported at
  the brief's path `src/lib/genome/ingest-errors.ts`; the quality footers
  spread their halves from there and the self uploader's preflight reads
  the PDF, unrecognised-format and too-large sentences from there (D-067).
  The export is named `INGEST_REFUSALS`, not `*_ERRORS`, so the readability
  gate grades the sentences as the body copy they render as rather than
  as one-line statuses.
- `sniffV2` is the detector; `sniff`, `sniffHead` and `sniffFile` are thin
  wrappers with the old answers (a multi-sample VCF reads `vcf`, a table
  or a PDF reads null), so no existing caller changes behaviour.
- The synonym table also names the forbidden sex, gender and karyotype
  headers, so the browser can drop such a column before any byte leaves it
  and the server can refuse it before any write (X10.2); a forbidden
  column never resolves and is never a mapping candidate.
- The mapping plan prefers an embryo column to a sample column when both
  resolve, treats a duplicated field as a choice among its columns and a
  missing field as a choice among the unresolved permitted columns, and
  answers null beyond four decisions or with no column left — the reader
  goes to the letter, not to a spreadsheet chore.
- The embryo-ingest limits are mirrored in `src/lib/genome/ingest-limits.ts`
  with a drift test against the register, the `primary-routes` precedent;
  the `too_large` sentence's `{n}` reads that mirror for an embryo ingest
  and `LIMITS` for a subject file.
- ADR 0019 is written Accepted over the E1 surfaces as built; ADR 0020 is
  Proposed and moves to Accepted when E0 and E2's steps 3–5 land.
- The capability register's Embryo ingest row is rewritten to what the
  page shows; its former claim about the landing's closing sentence was
  stale since E1 (D-068).

## 2026-09-04 — Embryo E2, slice 1: the X6.1 budget on the repository's basis

Context: CI run 33924630411 on PR #48 counted nine interactive elements on
the "What did they send you?" screen at 1280×800. The suite's basis
(`e2e/helpers.ts#firstViewportInteractives`, X6.1) excludes the
navigation landmarks, the skip link and the Copilot entry, and the
signed-in shell deliberately leaves two persistent controls inside the
count: the global search button on every viewport and, on desktop, the
attribution link beneath the side rail (`src/components/site/app-shell.tsx`).
A flow screen therefore has five interactive elements of its own, not
seven; the request-data page and the Family flows fit because they carry
two or three.

Decisions:
- The flow is cut so that no screen carries more than five controls of
  its own, and the shell is left alone: moving the attribution into a
  navigation landmark or hiding search on flow surfaces would loosen the
  basis for every page to fit one screen.
- The first two questions share a screen: the free-text question appears
  once the first is answered "Yes" or "I’m not sure", and "No" ends the
  screen without it (three answers, the input and Continue: five).
- Screens of equal choices are actions: the four illustrated options and
  the secondary link (five) each answer and move on, and so do the four
  bases (four, with Back). Such a screen carries no primary, which brief
  line 928's "at most one" permits; radios that navigate on change were
  rejected as an accessibility fault, so the options are buttons.
- "A PDF report only" lands on its own refusal screen with the letter,
  Back and the way back to Embryos; each basis leads to its named screen
  (brief lines 1729-1735) with its sentence, Back and Continue.
- The reducer records the shell's two controls as `SHELL_INTERACTIVES`
  beside the cap, so the unit test and the browser suite assert the same
  arithmetic.

## 2026-09-04 — Embryo E2, slice 1: corrections after the adversarial review

Context: a four-lens review of the branch (fourteen agents, each finding
refuted independently) confirmed ten findings; the two rated high are the
X6.1 breach CI had already caught (D-070). The rest are D-071 to D-076.

Decisions:
- The flow's own sentences claim only what is true on every path. "Nothing
  is kept yet. A record is made in a step still to come." replaces a
  sentence that said both parents sign first, which the design's draft step
  and the single-parent bases contradict; the closing sentence says the
  later steps ask "who must sign or what must be shown" instead of naming
  the other parent's email and signature, which three bases never ask for.
- The basis labels and sentences are in the third person, because the same
  screens follow both situations: a genetic parent, and someone uploading
  with both parents' permission. "One person alone has the legal right to
  decide for these embryos"; "Both parents will sign in their own
  accounts."
- The subject uploader's preflight refuses a recognised laboratory table
  or a VCF with several samples with the register's own refusal
  (`subject_source_not_single_sample`, copy id
  `upload.subject.single-sample-required`) and a link to the Embryo flow,
  and reserves `unrecognised_format` for the "sniffV2 null" trigger the
  brief binds; a PDF refusal carries the letter link the sentence
  promises.
- `sniffV2` trusts a `#CHROM` line only when the decode window terminated
  it; a header cut by the window or by a truncated gzip member answers a
  null sample count. Trailing whitespace on the header line adds no
  sample. The table header is tokenised per RFC 4180, so a comma inside a
  quoted cell no longer shifts every later column.
- An ending that appears in place ("No") moves focus to its sentence; the
  PDF screen carries the option's own label as its heading with the
  refusal as a paragraph; the terminal's sentence is a paragraph that takes
  focus, not a heading, so a block-role sentence is never a heading in the
  DOM; no ending or sentence is a live region — focus is what gets it read.
- The ADR, the copy header and the canonical row name the consumers of
  the refusals that exist today and mark the file processor's re-sniff and
  the ingest routes as E0's; a claim about a consumer that does not exist
  is a defect (D-076).
- The terminal still carries no "Step N of 5": it stands in for steps 3–5
  rather than being one of them, and naming a step number there would
  claim a stage the reader has not reached.


## 2026-09-05 — Embryo E0, slice 1: the cohort runtime

- Decision: E0 lands in three slices and this one is the cohort runtime:
  the six legal artifacts, the embryo operation nonce store, the
  basis-authority resolver, the draft, signature, co-parent invitation,
  rights activation, acceptance, finalization, Record Key delivery,
  restriction, disposition and cohort `embryo.analysis` grant RPCs, the
  draft-expiry executor, `job_time_stats` and the forbidden-column guard,
  with their routes, libraries, mail templates and pgTAP. The finalize
  route (`api.embryo-cohorts`) ships with the ingest slice, because its
  closed response carries the ingest session that slice opens; the RPC
  exists now and pgTAP exercises it. `EMBRYO_INGEST_AVAILABLE` stays
  `false` and no page changes.
- Decision: every operation and CSRF token is a sealed HMAC token minted
  server-side (`src/lib/embryos/operation-token.ts`, the grant-token
  envelope) and consumed by inserting its SHA-256 into
  `embryo_operation_nonces` inside the RPC before any other write, so a
  replay fails with 23505 and zero side effect. One operation-typed token
  per request, placed where the register puts it (`X-Inherit-CSRF`,
  `X-Inherit-Operation-Nonce`, or the body `nonce`). The register binds the
  shape, not the issuer; the purpose-grant nonce is the precedent. The
  public activation form (`api.rights-activate`) is the one token bound to
  no account: its form nonce is consumed the same way inside
  `activate_rights_session_v1`, but the register's candidate cookie is not
  issued or checked, because the `/withdraw/request` page that would set it
  does not exist yet (defect D-084).
- Decision: Record Keys use the Crockford base32 alphabet
  (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, 20 characters, 100 bits from 13
  random bytes). The register's "uppercase base32 without ambiguous glyphs"
  is read as the alphabet designed for that purpose; it drops I, L, O and U
  rather than the digits. Only the SHA-256 is stored; raw keys exist in the
  one bounded response.
- Decision: `donorAttributionIntent: "identified-donor-subject"` is refused
  with 422 in E0. No `consent.embryo-donor-attribution` artifact is seeded,
  so accepting the intent would store a donor contact that nothing could
  ever consume; the anonymous-donor basis is the only donor path until the
  attribution artifact and its invitation kind exist.
- Decision: every cohort-draft signature, including the two
  acknowledgements, uses the register's Tier-2 `cohortDraftId` body with a
  typed name; the register publishes no Tier-1 body for a draft target.
- Decision: the co-parent acceptance body carries `jurisdictionCode` only.
  The register's `jurisdictionAttestationVersion`, `-Hash` and `-Affirmed`
  fields name a `policy.jurisdiction` artifact the repository does not
  hold; inventing a hash to satisfy the shape would be a fabricated record
  (defect D-083).
- Decision: embryo mail links carry the token in the URL fragment
  (`/withdraw/request#<token>`), the register's issuance form; the adult
  path keeps its URL-path form and is recorded as defect D-081.
- Decision: disposition state lives in `embryos.status`; the QC values
  count as the "unknown" disposition of the register's state machine, and
  the QC verdict itself also lives in `embryo_qc`.
- Decision: draft expiry deletes what `docs/retention.md` lists for
  `embryo.cohort-draft-30d`: the draft row, its parent principals, every
  invitation, candidate, token hash, rights session, outbox row, contact
  reference and HMAC index, and the signatures and attestations tied only
  to the draft. Only the audit event, the retention rows and any refusal-bar
  HMAC survive. A lapsed disposition proposal is closed by the same executor
  (`embryo.disposition-proposal-7d`), and `propose` closes a lapsed
  proposal itself so an embryo is never locked by one.
- Decision: the forbidden-column guard is an event trigger created only
  when the migrating role may create one; elsewhere a notice is raised.
  pgTAP asserts the guard exists and refuses a sex column, so the local
  stack and CI prove it; a hosted database where the role cannot create
  event triggers would carry the notice in its migration log.
- Decision: `job_time_stats` withholds percentiles under twenty completed
  jobs; it is the only authenticated-executable function this slice adds.
- Decision: pgTAP was run locally on a stand-in cluster (PostgreSQL 16 with
  the roles, `auth`, `storage` and `extensions` objects the migrations
  reference, and pgTAP from the distribution) because no Docker daemon
  exists in this environment; CI's Supabase stack remains the authority
  and the gates ledger records both runs.
- Decision: the closed-shape serializer's blocked response (`blockedResponse`
  in `src/lib/embryos/api.ts`) logs a coded event and writes no legal audit
  row, although `embryo-closed-schema-v1` asks for one pseudonymized event
  per blocked attempt; no route-callable audit RPC exists yet. Recorded as
  defect D-085 rather than claimed.
- Decision: the co-parent path is reachable by API only in this slice. The
  mailed link (`/withdraw/request#<token>`) and the activation redirect
  (`/withdraw/session`) are the register's registered paths, but neither
  page exists; a person following the link today reaches the adult
  invitation page's "cannot be used" state (defect D-084). The mail is only
  ever queued under `INHERIT_TEST_JURISDICTION=1` through the API.
- Consequence: retention rows and due phases are written for the draft,
  the proposal, the donated-or-discarded and the transferred-claim-window
  classes, but only the draft-expiry phase has an executor. The capability
  register declares the others as recorded-without-executor until the
  withdrawal slice.

## 2026-09-05 — Resume E0 with the bounded transport layer

- The resumed checkout starts at PR #49 head `725eeb1`. GitHub Actions run
  `33966931548` passed every configured step on that exact head, including
  real local Supabase, pgTAP and both browser projects. The old local
  readability checkout is preserved; development continues in a separate
  worktree. PR #49 remains draft and open at this check.
- The scratchpad architect plans cited in the handoff are absent from the
  pushed tree. The committed route register and ADRs 0016/0020 therefore
  govern this implementation; missing scratch files are not assumed to
  contain additional implemented code.
- `embryo-ingest-session-v1.transportWireV1` now owns the explicit VCF and
  table transport formats. Both browser rewrites and server validators
  consume existing registered limits. Every request repeats its own exact
  header and challenge. The browser uses only in-memory source identities;
  the server matches random handles against its session's ordinal map and
  returns only whole-chunk-validated per-embryo data.
- Preserve missing calls, copy counts, read depths, genotype quality,
  allele depths, sample-filter failure and reference-block spans. Discard
  source phase-set identifiers and dephase calls so separate blocks cannot
  silently become one block. Table calls also carry no phase claim.
  Structural/breakend alleles need a separately reviewed representation;
  their arbitrary contig-bearing strings are refused by this transport.
- Primary format references, accessed 2026-09-05: the official
  [VCF 4.3 specification](https://samtools.github.io/hts-specs/VCFv4.3.pdf),
  sections 1.6.1–1.6.2, and the
  [VCF 4.5 specification](https://samtools.github.io/hts-specs/VCFv4.5.pdf),
  section 5.5. Independent reviewer `embryo_transport_audit` checked those
  semantics and found D-087 through D-090; all four receive regression
  tests before publication. This is a code review, not human comprehension
  evidence.
- No upload is enabled by a parser passing. Session creation and quotas,
  the mapping/chunk/complete routes, attempt-failure unwind, worker
  publication, lifecycle executors, and E2 screens still need integration.
  ADR 0020 stays Proposed and the embryo capability rows remain not shipped.
  Source-reported contamination/dropout ingestion and downstream QC remain
  worker work; the transport does not fabricate those measurements.

## 2026-09-05 — Report basis is not evidence replication or assay coverage

- Report citation counts now name cited sources, not supporting studies.
  The existing metadata does not distinguish independent studies from
  guidelines, reviews or repeated reports of one cohort. No confidence level
  is inferred from the number of links.
- Keep the brief's exact layer chips and six-heading contract. Add precise
  per-template method context: position-based association, guideline-position
  reading, or a named polygenic model. A model identifier is provenance, not
  proof that the individual's score has been calculated or validated. An
  inconsistent or absent score identifier gives unavailable method context.
- Show existing citation `accessedOn` dates as source-read dates; absence
  stays explicit. Neither a current date nor a deployment date stands in for
  scientific review. Existing citation links retain their original targets.
- With revealed results only, partition the resolver's available positions
  into interpreted, conflicting, no-call, unrecognized and unavailable.
  Repeated rsIDs count once. Conflict overrides a retained call and does not count toward the existing
  interpreted-position coverage sentence. The new counts explicitly do not
  measure total assay coverage: current report loading does not recover all
  explicit VCF reference and no-call rows. No source absence is interpreted
  as a negative finding.
- This adds no new clinical classifications, allele-frequency claims,
  reference-data imports, PRS estimates, calibrated risks, treatment advice,
  permissions or publication capability. Unsafe coordinate-only enrichment
  remains outside this renderer. The user's requested expansion of useful
  genetic evidence still requires source curation, allele-bound observations,
  independently reviewed interpretation and full report verification; this
  change is not evidence that the larger request or any acceptance gate is done.
- Independent scientific review found two new-slice defects before commit:
  a generic variant-call template was described as a Medicines guideline,
  and repeated rsIDs inflated the position count. Both are corrected with
  regression tests; guideline prose is restricted to the Medicines category.

## 2026-09-05 — Correct the job timing disclosure contract

- The existing under-twenty suppression decision remains. It did not approve
  exact counts, a 30-day window or p90 in place of the brief's p95.
- `job_time_stats(p_kind)` now returns coarse `n_bucket`, p50 and p95 over
  ninety days for the three registered embryo/family turnaround kinds only.
  Both percentiles are withheld below twenty eligible, complete jobs.
- The RPC name and argument survive; unsafe response fields do not. There
  are no tracked application callers, so no consumer or timing copy changes.
- See `docs/job-timing-privacy.md` for duration filtering, the intentional
  authenticated cross-account aggregate, tests and remaining password-setting
  eligibility/disclosure checks. No hosted settings were changed.

## 2026-09-05 — Database-owned default mail deadline

- The normal account-mail deadline is chosen by the database from one captured
  clock value. The application omits that argument unless the caller supplies
  an explicit deadline. There is no added retention slack: explicit expired
  deadlines and deadlines beyond the existing thirty-day cap remain refused.
- The ten-argument RPC identity, service-only privileges, required guard inputs,
  contact handling and semantic idempotency remain. Only its final argument has
  a null default. A replay never updates an existing outbox deadline. Generated
  types change only that argument's optional marker; no main RPC is omitted.
- The former application default was exactly its own clock plus thirty days,
  checked against a different database clock. Controlled rollback diagnostics
  accepted the database maximum and refused a deadline just 25 milliseconds
  later. Earlier report-ready warnings are consistent with this defect; the
  precise historical clock offset was not captured and is not proven.
- Verification on main `3f6050c`: 1,544 unit tests, including ten new helper
  assertions; 21 new rollback database assertions and all eleven original mail
  assertions; typecheck, scoped lint and security advisors. A production-build
  browser test signs in a fresh synthetic account, processes its file, observes
  one queued report-ready notice, repeats processing and verifies identical
  deadline/contact identity and zero provider attempts. No email is submitted.
- The new function was applied only to local test databases, without a reset,
  shared seed or hosted change. Deploy the migration before the application
  starts omitting the argument. Old ten-argument callers remain compatible.
  Reverting application code requires no database rollback; reverting the
  function first would break new callers. Already missed notifications are
  not automatically replayed by this change.
