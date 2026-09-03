# Design 1 — guideline-level response statements

**What was built.** `medicines.json` in this directory: three templates that say
what the CPIC guideline says — a metabolizer status for CYP2C19 and clopidogrel,
a starting-dose direction for warfarin from VKORC1 and two CYP2C9 positions, and
a statin muscle-symptom statement from SLCO1B1. Every coordinate, allele
definition and PMID is from `docs/design/pharmacogenomics-research-2026-09-03.md`
(§3.1, §3.2), read from primary sources on 2026-09-03. No allele frequency and no
effect size appears anywhere, because the research pass retrieved none and marks
every such figure UNVERIFIED.

This is the design that keeps the category’s promise: "How your body may respond
to some common medicines." It is the only one of the three that answers the
question a reader arrives with.

**How it fails.** Two named gates, in two different ways, plus one rule no gate
can see:

1. `pnpm gate:templates` — `BANNED_PATTERNS`. The guideline’s operative content
   is treatment content, so the prose trips `treatment claim` (`\bcures?\b|\btreats?\b`),
   `deterministic claim` (`you (have|will develop|are going to)`) and, once the
   §6.4 blocklist rows are in the validator, `treatment advice (§6.4)`
   (`\bdosage\b`, `\bsupplement\b`, `we recommend you take`).
2. `pnpm gate:readability` — the metabolizer sentences score grade 12.0 and 10.4
   against the ceiling of 9, and three titles carry drug names that are not in
   `data/plain-vocabulary.json` (`clopidogrel`, `warfarin`, `statin`, `symptoms`).
   The words cannot be swapped for plainer ones: they are the names of the
   medicines the report is about.
3. Not gate-visible, and fatal on its own: brief line 630 fixes "What you can do"
   to "There is nothing you need to do about this result. It does not change what
   any doctor would advise for you today." For a report that has just told a
   reader they are a poor metabolizer, that string is false; replacing it with
   advice is what §6.4 forbids. `src/app/(app)/genome/[subject]/reports/[slug]/page.tsx`
   renders `NOTHING_TO_DO` unconditionally, so the collision has no escape.

Subtracting the failing language leaves a report that states a genotype and no
response — which is design 2, and design 2 fails elsewhere.

**Two runs are recorded below.** Run 1 is the validator as it stood before this
work, so the §6.4 rows are absent and the first four errors are the pre-existing
rows. Run 2 is the validator after `\bdosage\b`, `\bsupplement\b` and
`we recommend you take` were added to `BANNED_PATTERNS` in the main tree under
the label `treatment advice (§6.4)` (`scripts/validate-templates.ts`, pinned by
`scripts/validate-templates.test.ts`): three further errors, one per template.

**Environment.** Both runs are in an isolated worktree of `b6c6877`
(`git worktree add`), with `node_modules` symlinked from the main tree and P0
applied there only: `"pharmacogenomics"` added to the validator’s `CATEGORIES`
and to the taxonomy’s `LEGACY_CATEGORY_SLUGS`/`LEGACY_CATEGORY_DEFAULTS`
(→ `medicines`), so that the design fails on its real defects rather than on
`bad category`. The fixture is copied to `data/templates/medicines.json` in the
worktree for the run and removed afterwards; it is never placed under
`data/templates/` in the main tree.

## Run 1 — validator as committed (P0 only; before the §6.4 patterns)

Fixture copied to `data/templates/medicines.json` in the worktree (`b6c6877` + P0); removed after the run.

```
$ pnpm gate:templates

> inherit@0.1.0 gate:templates /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/validate-templates.ts

templates: 154 across 16 categories
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
  pharmacogenomics: 3
  reproductive-family: 10

4 error(s):
  - medicines.json:clopidogrel-response-cyp2c19-rs4244285: banned language (deterministic claim)
  - medicines.json:clopidogrel-response-cyp2c19-rs4244285: banned language (treatment claim)
  - medicines.json:warfarin-response-vkorc1-cyp2c9: banned language (treatment claim)
  - medicines.json:statin-muscle-symptoms-slco1b1-rs4149056: banned language (deterministic claim)
 ELIFECYCLE  Command failed with exit code 1.
[exit code: 1]
```

```
$ pnpm gate:readability

> inherit@0.1.0 gate:readability /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/readability-gate.ts

READABILITY GATE FAILED (6)
  - data/templates/medicines.json:1: grade 10.4 exceeds 9 (Two *2 copies: a poor metabolizer under the guideline’s status table. The medicine treats )
  - data/templates/medicines.json:1: grade 12.0 exceeds 9 (One *2 copy: an intermediate metabolizer, with less of the active drug formed. We recommen)
  - data/templates/medicines.json:1: short heading uses unregistered word 'clopidogrel' (Clopidogrel response · CYP2C19)
  - data/templates/medicines.json:2: short heading uses unregistered word 'warfarin' (Warfarin response · VKORC1 and CYP2C9)
  - data/templates/medicines.json:3: short heading uses unregistered word 'statin' (Statin muscle symptoms · SLCO1B1)
  - data/templates/medicines.json:3: short heading uses unregistered word 'symptoms' (Statin muscle symptoms · SLCO1B1)
 ELIFECYCLE  Command failed with exit code 1.
[exit code: 1]
```

## Run 2 — validator with the §6.4 patterns (treatment advice (§6.4)), P0 re-applied

Fixture copied to `data/templates/medicines.json` in the worktree (`b6c6877` + P0); removed after the run.

```
$ pnpm gate:templates

> inherit@0.1.0 gate:templates /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/validate-templates.ts

templates: 154 across 16 categories
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
  pharmacogenomics: 3
  reproductive-family: 10

7 error(s):
  - medicines.json:clopidogrel-response-cyp2c19-rs4244285: banned language (deterministic claim)
  - medicines.json:clopidogrel-response-cyp2c19-rs4244285: banned language (treatment claim)
  - medicines.json:clopidogrel-response-cyp2c19-rs4244285: banned language (treatment advice (§6.4))
  - medicines.json:warfarin-response-vkorc1-cyp2c9: banned language (treatment claim)
  - medicines.json:warfarin-response-vkorc1-cyp2c9: banned language (treatment advice (§6.4))
  - medicines.json:statin-muscle-symptoms-slco1b1-rs4149056: banned language (deterministic claim)
  - medicines.json:statin-muscle-symptoms-slco1b1-rs4149056: banned language (treatment advice (§6.4))
 ELIFECYCLE  Command failed with exit code 1.
[exit code: 1]
```

```
$ pnpm gate:readability

> inherit@0.1.0 gate:readability /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/readability-gate.ts

READABILITY GATE FAILED (6)
  - data/templates/medicines.json:1: grade 10.4 exceeds 9 (Two *2 copies: a poor metabolizer under the guideline’s status table. The medicine treats )
  - data/templates/medicines.json:1: grade 12.0 exceeds 9 (One *2 copy: an intermediate metabolizer, with less of the active drug formed. We recommen)
  - data/templates/medicines.json:1: short heading uses unregistered word 'clopidogrel' (Clopidogrel response · CYP2C19)
  - data/templates/medicines.json:2: short heading uses unregistered word 'warfarin' (Warfarin response · VKORC1 and CYP2C9)
  - data/templates/medicines.json:3: short heading uses unregistered word 'statin' (Statin muscle symptoms · SLCO1B1)
  - data/templates/medicines.json:3: short heading uses unregistered word 'symptoms' (Statin muscle symptoms · SLCO1B1)
 ELIFECYCLE  Command failed with exit code 1.
[exit code: 1]
```

