# Design 2 — bare single-position reports in the variant_call layer

**What was built.** `medicines.json` in this directory: five templates, one per
candidate the research pass found could render honestly — VKORC1 rs9923231,
CYP2C19 rs4244285, CYP2C9 rs1799853 and rs1057910, SLCO1B1 rs4149056
(`docs/design/pharmacogenomics-research-2026-09-03.md` §5, read 2026-09-03).
Each says only which letters the file shows at one position, which CPIC forms
carry that letter, and what the position cannot tell the reader. No drug
response, no metabolizer status, no dose. `layer` is `variant_call`, where brief
line 1163 places pharmacogenomic star alleles. No frequency and no effect size
appears anywhere.

This is the design that passes the two prose gates. It is recorded here as the
control: it proves that the other two designs fail on their own content and not
on some accident of the fixture.

**How it fails.** Not on a prose gate — on the taxonomy, on the brief’s own slot
rules, and on what the category then says to a reader:

1. **The taxonomy has nowhere to put it.** `categoryFor` in
   `src/lib/genome/taxonomy.ts` is a total function with a per-legacy-category
   default and a named exception list; no legacy slug maps to `medicines`. With
   `category: "pharmacogenomics"` (P0 only, and P0 is not in the main tree) the
   shipped mapping throws `Unknown legacy category "pharmacogenomics"`; re-slugged
   to any shipped legacy category the templates land under someone else’s
   heading — `lifestyle-wellness` puts all five under "Food, drink and
   metabolism". Pinned by `src/lib/genome/pharmacogenomics-withheld.test.ts`.
2. **§7.1 slot 2** (brief line 949) requires the plain summary to state "the
   single most important thing it cannot tell you". Here that sentence is the
   report: every summary below ends by saying the position cannot tell the reader
   how they respond to the medicine. A category whose every report’s most
   important sentence is a denial does not keep the promise
   `src/copy/reports/strings.ts` makes for it ("How your body may respond to some
   common medicines.").
3. **The FTC net-impression standard** (brief line 1902): claims are judged by
   the advertisement’s net impression as a whole, and hedges such as "may" are
   inadequate qualifiers. A page headed "Medicines" showing a clopidogrel-related
   genotype reads as medication guidance however carefully each sentence is
   worded.
4. **The rendered category is a heading over five denials.** `e2e/report-skeleton.spec.ts`
   pins `#medicines` at count 0 today. Populating it renders the section — and
   the E2E that would prove what a reader meets needs the local Supabase stack in
   CI, which is why the evidence here is the gate runs plus the unit test rather
   than a browser run.

**Environment.** Isolated worktree of `b6c6877` (`git worktree add`),
`node_modules` symlinked from the main tree, P0 applied there only:
`"pharmacogenomics"` in the validator’s `CATEGORIES` and in the taxonomy’s
`LEGACY_CATEGORY_SLUGS`/`LEGACY_CATEGORY_DEFAULTS` (→ `medicines`). The validator
includes the §6.4 rows added by this work. The fixture is copied to
`data/templates/medicines.json` in the worktree for the run and removed
afterwards; it is never placed under `data/templates/` in the main tree.

## Run — validator with the §6.4 patterns, P0

Fixture copied to `data/templates/medicines.json` in the worktree (`b6c6877` + P0); removed after the run.

```
$ pnpm gate:templates

> inherit@0.1.0 gate:templates /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/validate-templates.ts

templates: 156 across 16 categories
  addiction: 10
  aesthetic-cosmetic: 10
  autoimmune: 10
  basic-traits: 10
  brain-health: 10
  cancer-risk: 10
  environmental-sensitivity: 11
  gastrointestinal: 10
  heart-cardiovascular: 10
  lifestyle-wellness: 10
  longevity: 10
  mental-health: 10
  metabolic-obesity: 10
  neurodegenerative: 10
  pharmacogenomics: 5
  reproductive-family: 10
all template seeds valid
[exit code: 0]
```

```
$ pnpm gate:readability

> inherit@0.1.0 gate:readability /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/readability-gate.ts

readability gate passed: 1694 blocks, 991 long, 463 short-role, 272 sentence-capped, 248 copy-registry
[exit code: 0]
```

