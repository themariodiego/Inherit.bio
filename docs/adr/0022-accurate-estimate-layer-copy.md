# ADR 0022: Describe the reports we actually publish

- Status: Accepted
- Date: 2026-09-05
- Supersedes: the estimate definition in brief §4 §1.3 and the matching Overview note only; clarifies the unavailable-score count in §4 §2.2.

## Context

The brief explicitly classifies all 151 original templates as single-locus
associations (X5.1), but its quoted layer definition calls every estimate a
polygenic score. The library also counted every single-locus report in the
unavailable-number notice. This made useful nonnumeric results look like
unfinished scores. The user's current direction is to deliver meaningful,
easy-to-read results without unnecessary gates.

## Decision

Keep the two layers, category structure, evidence labels and access rules.
Replace the contradictory estimate definition with:

> Links between DNA and traits found in studies. Some reports use one spot; polygenic scores combine many. Neither says what will happen to you.

Use the same shared definition everywhere it already appears. Correct the
Overview note and Family permission explanation so neither implies that the
whole estimate layer combines many positions. Embryo-specific polygenic
wording is not changed.

Keep the exact unavailable-number sentence and its science link for actual
polygenic reports. Count only polygenic templates in the allowed estimate
layer. Current polygenic outputs are coverage-only; validated personal score
publication does not exist. The count must be revisited with that feature.
Malformed or legacy model identifiers still count as unavailable, rather
than silently disappearing. Single-position reports keep their individual
limitations, evidence, source explanations and missing-call states.

## Alternatives and limits

Keeping false copy verbatim would contradict X5.1. Removing all unavailable
score disclosures would hide a real limitation. Neither is adopted. This
change does not validate risk models, certify legacy catalog claims, alter
numeric publication rules or loosen sensitive-report access.

Tests replace the inaccurate fixed-string expectations, retain the exact
unavailable-score sentence, and add mixed-template counting and browser
proof that a single-locus library is not advertised as failed scores.
