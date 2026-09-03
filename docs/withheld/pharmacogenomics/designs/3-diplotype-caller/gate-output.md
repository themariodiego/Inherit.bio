# Design 3 — a diplotype caller over unphased calls

**What was built.** `medicines.json` in this directory: two templates that try to
name a pair of gene forms rather than report one position — TPMT over rs1800462,
rs1800460 and rs1142345 (the pair the 2025 guideline, PMID 41618934, is keyed
on), and G6PD over rs1050828 and rs1050829 (PMID 36049896). The caller itself is
written as a pure function, `callTpmtDiplotype`, in
`src/lib/genome/pharmacogenomics-withheld.test.ts`, over the six CPIC TPMT forms
the research pass verified (*1, *2, *3A, *3B, *3C, *41). Coordinates, allele
definitions and PMIDs are from `docs/design/pharmacogenomics-research-2026-09-03.md`
(§3.1, §3.2, §3.4), read 2026-09-03. No frequency and no effect size appears
anywhere.

`medicines.two-entry.json` is the workaround: the same TPMT template with
rs1142345 listed twice, once as `T>C` (*3C) and once as `T>G` (*41), which is the
only way the one-`ref`/one-`alt` schema can mention both alt alleles.

**How it fails.**

1. `pnpm gate:templates` — `bad ref/alt`. CPIC assigns `T>C` to TPMT *3C and
   `T>G` to *41 at rs1142345, so the variant has two alt alleles. The schema
   carries one `alt` per variant and the validator requires `/^[ACGT]+$/`, so
   `alt: "C,G"` is rejected, and the two genotype keys the validator then derives
   — `"C,GT"` and `"C,GC,G"` — are strings no parser can ever produce.
2. **The workaround passes the gate and loses the allele silently.** With
   rs1142345 listed twice, `pnpm gate:templates` and `pnpm gate:readability` both
   return 0. But `scripts/seed.ts` keys `refVariants` on the rsID and keeps the
   first entry only (`if (!refVariants.has(v.rsid))`), so `ref_variants` learns
   `T>C` and never learns `T>G`: the *41 allele is dropped with no error. On the
   `T>C` entry `resolveVariant` returns `unrecognized` for `T/G` and for `C/G`,
   and the report page renders `unrecognized` as a no-call. A *41 carrier is told
   nothing, and is told it in the same words as someone whose file could not be
   read.
3. **Phase.** The caller returns `indeterminate` for `*1/*3A` versus `*3B/*3C` on
   identical inputs, because unphased calls carry no phase and those two pairs
   produce the same genotypes at all three positions. The two pairs are not
   cosmetically different: the reference implementation’s own disclaimer
   (`https://pharmcat.clinpgx.org/Disclaimers/`, read 2026-09-03) states that
   "the *1/*3A genotype is returned though the possibility of *3B/*3C cannot be
   ruled out", and the guideline gives them different statuses.
4. **The X chromosome.** `genotypeKeys()` in `scripts/validate-templates.ts` emits
   haploid keys only for chromosome 24 (Y) and 25 (MT), so a G6PD template on
   chromosome 23 is validated against diploid keys, and `resolveVariant` returns
   `unrecognized` for a one-letter call. Every subject with one X chromosome gets
   a no-call — including one who carries the reference base.

Failures 2, 3 and 4 are pinned by `src/lib/genome/pharmacogenomics-withheld.test.ts`,
each with the rule named in the assertion message.

**Two runs are recorded below.** Run 1 is the design as written. Run 2 is the
two-entry workaround, which passes both gates and is therefore the evidence for
failure 2: the gate cannot see the dropped allele, only the unit test can.

**Environment.** Isolated worktree of `b6c6877` (`git worktree add`),
`node_modules` symlinked from the main tree, P0 applied there only:
`"pharmacogenomics"` in the validator’s `CATEGORIES` and in the taxonomy’s
`LEGACY_CATEGORY_SLUGS`/`LEGACY_CATEGORY_DEFAULTS` (→ `medicines`). The validator
includes the §6.4 rows added by this work. The fixture is copied to
`data/templates/medicines.json` in the worktree for the run and removed
afterwards; it is never placed under `data/templates/` in the main tree.

## Run 1 — the design as written (rs1142345 with alt "C,G")

Fixture copied to `data/templates/medicines.json` in the worktree (`b6c6877` + P0); removed after the run.

```
$ pnpm gate:templates

> inherit@0.1.0 gate:templates /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/validate-templates.ts

templates: 153 across 16 categories
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
  pharmacogenomics: 2
  reproductive-family: 10

3 error(s):
  - medicines.json:tpmt-three-positions-diplotype: bad ref/alt
  - medicines.json:tpmt-three-positions-diplotype: missing interpretation for genotype key "C,GT"
  - medicines.json:tpmt-three-positions-diplotype: missing interpretation for genotype key "C,GC,G"
 ELIFECYCLE  Command failed with exit code 1.
[exit code: 1]
```

```
$ pnpm gate:readability

> inherit@0.1.0 gate:readability /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/readability-gate.ts

readability gate passed: 1690 blocks, 977 long, 460 short-role, 269 sentence-capped, 248 copy-registry
[exit code: 0]
```

## Run 2 — the two-entry workaround (rs1142345 listed twice, alt C and alt G)

Fixture copied to `data/templates/medicines.json` in the worktree (`b6c6877` + P0); removed after the run.

```
$ pnpm gate:templates

> inherit@0.1.0 gate:templates /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/validate-templates.ts

templates: 152 across 16 categories
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
  pharmacogenomics: 1
  reproductive-family: 10
all template seeds valid
[exit code: 0]
```

```
$ pnpm gate:readability

> inherit@0.1.0 gate:readability /tmp/claude-0/-home-user-Inherit-bio/b3c1c41b-e9f8-5631-9c73-1b5e9b8faf86/scratchpad/wt-pgx
> tsx scripts/readability-gate.ts

readability gate passed: 1683 blocks, 974 long, 459 short-role, 268 sentence-capped, 248 copy-registry
[exit code: 0]
```

