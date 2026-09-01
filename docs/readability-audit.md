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
72 long-block grade findings, concentrated in the existing report-template
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

The ninth remediation pass removed all 24 findings from the basic-traits
report category: 8 summaries and 16 genotype interpretations. The rewrites
retain allele direction, trait direction, effect sizes, study and population
sizes, ancestry qualifiers, functional findings, replication limits, and the
distinction between group trends and individual outcomes. A category-level
regression keeps the file at zero findings.

The tenth remediation pass removed all 21 findings from the addiction report
category: 9 summaries and 12 genotype interpretations. The rewrites retain
allele and effect direction, effect sizes, ancestry and exposure qualifiers,
alcohol-related cancer warnings, medication non-dosing language, study-size
and replication limits, and the distinction between group trends and
individual outcomes. A category-level regression keeps the file at zero
findings.

The eleventh remediation pass removed all 20 findings from the aesthetic and
cosmetic report category: 9 summaries and 11 genotype interpretations. The
rewrites retain allele and trait direction, effect and population sizes,
ancestry and X-chromosome qualifiers, functional findings, sun-protection and
melanoma language, and the distinction between group trends and individual
outcomes. A category-level regression keeps the file at zero findings.

The twelfth remediation pass removed all 19 findings from the heart and
cardiovascular report category: 8 summaries and 11 genotype interpretations.
The rewrites retain allele and effect direction, absolute-versus-relative risk
language, exposure interactions, ancestry qualifiers, direct-test and clinical
follow-up guidance, and limits on individual prediction. The CETP B2B2 copy
also corrects the coronary odds comparison from about 20% lower to about 10%
lower versus B1B1, consistent with the cited review's per-allele estimate. A
category-level regression keeps the file at zero findings.

The thirteenth remediation pass removed all 22 findings from the privacy
policy. The rewrites retain the named infrastructure providers and processor
limits; bans on tracking, analytics, sale, and sharing; consent-gated AI chat;
law-enforcement limits; immediate deletion and free export; child-data rules;
change-of-control protections; legal separation from Plus Bio; and every
listed GDPR and CCPA/CPRA right. A page-level regression keeps the privacy
policy at zero findings.

The fourteenth remediation pass removed all 17 findings from the environmental
sensitivity report category. The rewrites retain allele and effect direction,
population and ancestry limits, exposure and non-genetic factors, effect sizes,
study design, replication status, and limits on individual prediction. The
photic-sneeze copy also corrects its cross-population comparison: both cited
studies associate the C allele with higher odds, rather than reporting opposite
directions. A category-level regression keeps the file at zero findings.

The fifteenth remediation pass removed all 16 findings from the reproductive
and family report category. The rewrites retain carrier-screening and clinical
confirmation limits, inheritance probabilities, allele and effect direction,
effect sizes, ancestry and population qualifiers, study design and replication
status, clinical follow-up, and limits on individual prediction. The FSHR copy
now attributes the higher average stimulation requirement specifically to early
IVF studies rather than presenting it as a universal result. A category-level
regression keeps the file at zero findings.

The sixteenth remediation pass removed all 15 findings from the metabolic and
obesity report category. The rewrites retain allele and effect direction,
effect sizes, ancestry and lifestyle qualifiers, hormone and metabolic
measures, study design, and limits on individual prediction. The APOA2
gene-diet result remains labeled preliminary, and the GIPR diet-response copy
still identifies its single-trial basis and lack of a high-fat genotype effect.
A category-level regression keeps the file at zero findings.

The seventeenth remediation pass removed all 14 findings from the
neurodegenerative report category. The rewrites retain allele and effect
direction, effect sizes, ancestry qualifiers, absolute-risk limits, clinical
confirmation guidance, disease distinctions, and limits on individual
prediction. The LRRK2 copy now cites later family cohorts for its age-80
penetrance range instead of relying on the older study's higher estimate. The
GBA1 copy now attributes the five-fold estimate to the cited study's combined
variant group rather than to N370S alone. Later primary studies were also added
for the UNC13A frontotemporal findings and the TMEM106B C9orf72 modifier. A
category-level regression keeps the file at zero findings.

Before G1.10 can become YES, the extractor must also prove coverage for strings
assembled entirely from runtime data and for chart-axis labels registered by a
chart component. Those surfaces are not claimed by the current static corpus.

Remediation must keep every uncertainty, applicability, and provenance clause.
Punctuation-only splits are acceptable only when both resulting sentences are
grammatical. Any wording change to a scientific template must retain the same
direction, magnitude, population, evidence status, and limitation before the
gate can be promoted to required CI.
