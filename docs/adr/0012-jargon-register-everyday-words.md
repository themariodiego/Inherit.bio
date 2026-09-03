# ADR 0012: Everyday words leave the jargon register

- Status: Accepted
- Date: 2026-09-03

## Context

`data/jargon.json` has two jobs (X7.3): a term in it must carry a definition on
first use, and it may never appear in a heading. G3.5 adds that the first
heading on any result page contains no term from the register. The register
also feeds the readability scorer, which replaces a registered term with a
one-syllable placeholder before grading. X7.3 allows the register to be
shortened only by an ADR.

The register contained words that need no definition for any reader and that
the specification itself mandates in headings: `Cancer` is a mandated category
heading, `Immune system and allergies` another, `Embryos` a domain heading and
a navigation label, and report titles name diseases, vitamins and hormones.
With those words registered, every such heading failed G3.5 by construction,
and the only way to pass would have been to rename Alzheimer's disease,
vitamin D or breast cancer into something less exact — more words, not fewer
claims.

## Decision

The following leave the register: `cancer` (with aliases `tumor`, `tumour`),
`immune`, `embryo` (`embryos`), the aliases `disease` and `diseases` of
`condition`, `vitamin` (`vitamins`), `hormone` (`hormones`), `celiac`,
`metabolism` (`metabolic`), `trait` (`traits`) and the aliases `genome` and
`genomes` of `gene`. They are everyday words, the name of a condition, or words
the specification mandates in headings (`Food, drink and metabolism`,
`Everyday traits`, `My Genome`); a reader who does not know them is not helped
by a genetics definition, and a report about celiac disease cannot be titled
without its name.

Thirteen genuine terms of genetics and statistics join the register, each with
a plain definition of at most 25 words: `prevalence`, `incidence`, `pathogenic`
(`likely pathogenic`), `hazard ratio` (`hazard ratios`), `odds ratio`
(`odds ratios`), `genome-wide association study` (`gwas`), `linkage
disequilibrium`, `reference panel` (`reference panels`), `z-score`
(`z-scores`), `missense`, `frameshift`, `heritability` and `autosomal`. The
register stays above the 200-entry floor (203 terms and aliases).

## Alternatives rejected

- Keeping the words and renaming the mandated headings. Rejected: the nine
  category labels and the navigation labels ship character-for-character, and
  a report title that avoids the name of the condition it reports is less
  exact, which X0.1 forbids.
- Removing the words without adding terms. Rejected: G3.5 requires at least
  200 entries, and the words added are terms a reader does meet in report
  prose and sources.
- Exempting headings from the register check case by case. Rejected: X0.2
  allows one rule, not a rule with a list of exceptions that grows with every
  new surface.

## Consequences

Twelve template sentences and one legal sentence rose above the grade ceiling
once these words were scored as ordinary words; the legal sentence was
shortened in the same change and the template sentences are rewritten with
the naked-relative-figure remediation (they all carried one). Report titles
are checked by `pnpm gate:templates` against the register as it now stands
(`src/lib/genome/template-prose.ts`). Adding a word back to the register is a
plain edit; removing another needs a new ADR.
