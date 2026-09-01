# Readability audit

Date: 2026-09-01

Baseline: `864736979c92a08ba77e8580d61946eba6864918`

Run:

```sh
pnpm gate:readability
```

The deterministic extraction currently covers 1,440 user-visible blocks:

- 905 long blocks from static TSX, the 151 report templates, rendered provider
  fields, and seeded consent artifacts;
- 393 short strings selected by rendered role;
- 252 onboarding, consent-summary, result-headline, status, and error blocks
  subject to the 25-word sentence cap.

The pinned ten-case scorer self-test passes. The short-role vocabulary and
sentence-length rules are clean. The command currently exits non-zero with
240 long-block grade findings, concentrated in the existing report-template
library and long marketing/legal copy. There is deliberately no baseline
allowance and the command is not yet wired into CI.

The first remediation pass removed 22 genuine findings from application UI and
reusable components without deleting caveats. It also corrected the extractor
so a parent status or list container no longer concatenates its nested heading
and paragraph into a synthetic copy block. Three regression tests prove that
nested blocks remain separate, inline markup remains part of its block, and
visible text attributes are still extracted. Two Copilot paragraphs remain in
the application-route set because the brief separately requires their current
wording verbatim; that conflict must be resolved without silently exempting
them from G1.10.

The second remediation pass removed all 24 findings from non-legal marketing
and science pages. It also aligned the About and home pages with the provider
directory: marked affiliate links may earn a commission, but the buyer still
pays the lab directly. The open-source link now names the current
`themariodiego/Inherit.bio` repository. Legal, privacy, terms, provider-data,
and report-template wording were intentionally left for their own review
batches.

The third remediation pass removed all 27 findings from displayed provider
metadata: 16 privacy-practice notes, 10 shipping descriptions, and one
clinician-ordering description. The rewrites retain country exclusions,
consent and opt-out choices, policy dates, laboratory locations, ordering
rules, and shipping costs or delays. Prices, product compatibility, source
URLs, and verification summaries were not changed.

The fourth remediation pass removed all 32 findings from the lifestyle and
wellness report category: 10 summaries and 22 genotype interpretations. The
rewrites retain each allele direction, phenotype, effect size or population
frequency, evidence status, study limitation, and measurement caveat. A
category-level regression keeps this template file at zero findings while the
remaining report categories are remediated.

The fifth remediation pass removed all 28 findings from the brain-health report
category: 10 summaries and 18 genotype interpretations. The rewrites preserve
the tested allele direction, population or effect size, evidence label, study
design, replication status, and limits on individual prediction. A second
category-level regression keeps this template file at zero findings.

The sixth remediation pass removed all 27 findings from the gastrointestinal
report category: 9 summaries and 18 genotype interpretations. The rewrites
retain allele direction, population and effect-size qualifiers, clinical
penetrance, medication and test caveats, study limits, and the distinction
between inherited tendency and current health. A category-level regression
keeps the file at zero findings.

The seventh remediation pass removed all 27 findings from the longevity report
category: 8 summaries and 19 genotype interpretations. The rewrites retain
allele direction, odds and cohort sizes, population qualifiers, biological
trade-offs, replication status, and limits on individual prediction. A
category-level regression keeps the file at zero findings.

The eighth remediation pass removed all 25 findings from the mental-health
report category: 8 summaries and 17 genotype interpretations. The rewrites
retain allele direction, odds and population baselines, gene-environment
interactions, biological trade-offs, replication status, study limits, and
limits on individual prediction. A category-level regression keeps the file
at zero findings.

Before G1.10 can become YES, the extractor must also prove coverage for strings
assembled entirely from runtime data and for chart-axis labels registered by a
chart component. Those surfaces are not claimed by the current static corpus.

Remediation must keep every uncertainty, applicability, and provenance clause.
Punctuation-only splits are acceptable only when both resulting sentences are
grammatical. Any wording change to a scientific template must retain the same
direction, magnitude, population, evidence status, and limitation before the
gate can be promoted to required CI.
