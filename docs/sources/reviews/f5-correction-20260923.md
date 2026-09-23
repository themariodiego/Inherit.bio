# Factor V Leiden: one called position, not overall clot risk

Reviewed on 23 September 2026. This is an agent source review, not human
signoff or clinical approval. The report keeps its emerging evidence tier,
title, GRCh38 coordinate, allele metadata and existing resolver behavior.
Only its summary, three genotype explanations and dated source bindings change.
No other report is reviewed by this change.

The old CC paragraph inferred usual clot risk from one absent variant. That
is not supported. The other paragraphs used broad magnitude labels, population
frequency and lifetime reassurance without enough scope in the cited abstract.
The revised text reports file letters, distinguishes a group association from a
personal probability, and names the Danish population behind the risk direction.
It gives no advice about medicines, screening or care.

## Sources actually read

- [Bertina and colleagues, Nature 1994](https://pubmed.ncbi.nlm.nih.gov/8164741/),
  PMID 8164741, DOI 10.1038/369064a0: the complete publisher author abstract and
  publication metadata were read on 23 September. It connects the legacy
  nucleotide/protein naming to resistance to activated protein C. The full
  paper was subscription-only; no methods, tables or supplement were read.
  Later direct retries failed at the publisher redirect. No genotype-specific
  personal risk or population prevalence is taken from this abstract.
- [Juul and colleagues, 2004](https://pubmed.ncbi.nlm.nih.gov/14996674/),
  DOI 10.7326/0003-4819-140-5-200403020-00008: the complete author abstract was
  read through the indexed primary PubMed record; an independent agent also
  read the direct page. The cohort followed 9,253 randomly selected Danish
  adults for 23 years, recording hospitalization and death from venous
  thromboembolism. Both carrier groups had higher estimated hazards than
  noncarriers; the homozygous estimate was higher and imprecise. The reported
  absolute risk varied with age, smoking and body mass index. These findings
  support direction and context, not a personal probability, lifelong immunity,
  or transport to every ancestry. No full paper or tables were read.
- [NCBI ClinVar VCV000000642.133](https://www.ncbi.nlm.nih.gov/clinvar/variation/VCV000000642.133):
  the independent agent directly read Variant Details on the official page,
  including Location, HGVS, Other names, Canonical SPDI and Links. The scoped
  local excerpt in `docs/sources/clinvar/rs6025-2026-09-23.json` records only
  identity: forward GRCh38 chromosome 1 position 169549811 C>T corresponds to
  NM_000130.5:c.1601G>A and p.Arg534Gln, historically R506Q/Arg506Gln. Thus the
  transcript letters and report letters have opposite orientations, not opposite
  effects. The GRCh37 reference at this locus differs; reference status is not
  evidence of benignity. No submitted clinical classification, frequency or
  uploaded assay validation is used. Direct dbSNP access failed, and no direct
  dbSNP read is claimed.

The canonical register keeps only short supporting excerpts. No full article
or web page is copied. Each source's quotation is below 25 words. The coordinate
and source identity do not validate the input file, infer an uncalled genotype,
or establish a diagnosis. CC only describes absence of T at this called site.

## Current templates and historical results

These strings apply to newly generated reports that use the corrected template.
Captured catalogue snapshots and saved DNA calls are not rewritten. The exact
superseded four strings are registered in `data/report-scientific-corrections.json`
against prior commit `fe09e3e89784729be0cde0bee025b2b05c586b49`
and actual correction commit `5eb72318047c66bf378eb3a63270f05a5ff4d3e4`.
The seven prior batches remain unchanged. The existing notices and Copilot
boundary now recognize this exact old F5 wording without rewriting the original
DNA calls or saved prose. Unknown text is not assumed wrong. Old prose must not
borrow the new attribution.

The targeted regression checks allele orientation, all three genotypes, missing
and no-call data, an unrelated allele, exact source edges, and old/wrong-identity
attribution refusal. It does not prove a hosted deployment, full catalogue
accuracy, uploaded assay validity or clinical acceptance.
