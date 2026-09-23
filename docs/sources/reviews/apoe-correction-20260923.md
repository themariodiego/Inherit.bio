# APOE report correction — 23 September 2026

Scope: seven strings in `apoe-e4-alzheimers-risk`, preserving its title,
forward alleles, coordinates, emerging evidence tier and per-marker coverage.
This is source review, not clinical approval or human signoff. No new APOE
caller, phase inference, personal probability or assay validation is supplied.

## Sources actually read

- [Corder 1993, PMID 8346443](https://pubmed.ncbi.nlm.nih.gov/8346443/?dopt=Abstract),
  DOI `10.1126/science.8346443`: complete author abstract through primary
  PubMed indexing, read 2026-09-23. It describes 42 late-onset Alzheimer
  disease families. Its family-specific dose and onset findings cannot be
  treated as a reader's lifetime probability. Direct article access did not
  provide the paper; full text, Methods and tables were not read.
- [Farrer 1997, PMID 9343467](https://pubmed.ncbi.nlm.nih.gov/9343467/) and the
  [publisher abstract](https://jamanetwork.com/journals/jama/article-abstract/418446),
  DOI `10.1001/jama.1997.03550160069041`: complete author abstract, including
  Data Sources, Main Outcome Measures, Results and Conclusions, read
  2026-09-23. The analysis included 5,930 cases and 8,607 controls contributed
  by 40 teams. It reports higher odds for ε3/ε4 and ε4/ε4 relative to ε3/ε3,
  with variation by population, age and sex. It also reports increased odds
  for ε2/ε4 in the European clinic/autopsy subset: a T at rs7412 is not a
  stand-alone lower-risk result. Full paper and tables were inaccessible.
- [NCRAD genotype chart](https://ncrad.iu.edu/bank-samples/apoe-genotyping/):
  Methodology, Apolipoprotein E text and genotype table, plus its research-use
  limitation, read 2026-09-23. The table requires both positions and lists
  two distinct APOE types for CT/CT. The short local excerpt and selected
  factual rows are in `docs/sources/ncrad/apoe-genotypes-2026-09-23.json`.
  It is a scoped primary method dataset, not a full-page copy. NCRAD's assay
  procedures do not validate this application or an uploaded DNA file.

The canonical register contains the only publication excerpts added here:
11 words for Corder and 12 for Farrer. The NCRAD excerpt is 11 words; the
snapshot adds two short factual table rows. No full paper was archived.

## Forward allele and build identity

The actual allele-description sections of primary NCBI records were read,
without using their condition classifications as personal risk evidence:
[rs429358](https://www.ncbi.nlm.nih.gov/clinvar/RCV000991302.2/) maps to
GRCh38 `NC_000019.10:g.44908684T>C`, `NM_000041.4:c.388T>C` and
`NP_000032.1:p.Cys130Arg`; [rs7412](https://www.ncbi.nlm.nih.gov/clinvar/variation/VCV000017848.34/)
maps to `NC_000019.10:g.44908822C>T`, `NM_000041.4:c.526C>T` and
`NP_000032.1:p.Arg176Cys`. These exact versioned pages support the template's
existing positions and forward letters. Direct dbSNP access did not return
usable content; no successful dbSNP read or latest-record claim is made.

## What changed and what remains

`resolveTemplate` resolves each marker independently and considers a report
covered if either marker resolves. It does not join or phase APOE markers.
The old text could therefore assign an ε type with a missing or no-call
partner, give incompatible type claims for CC/TT, or assume ε2/ε4 for dual
CT calls. The new six explanations report file letters and explicitly state
that this report does not assign an APOE type or personal disease risk.
The summary retains a qualified group association and the phase limitation.

The summary binds both papers and the joint-marker chart; the six genotype
paragraphs bind the chart's method limit. File letters and the implementation
limitation are checked against the actual resolver, not attributed to a paper.
No evidence tier, coverage rule, stored call or publication workflow changes.

This correction applies to newly generated reports using the corrected
template. Historical captured templates retain their original interpretation
text and remain a separate release follow-up. They are not silently rewritten;
regressions require their old strings to remain unregistered rather than
borrowing attribution from the correction.

Provenance: the original object from `109089d143e2efd723f7461cf7e493eac45fb4ae`
has SHA-256 `d6123d978c79d96723338308ecf837cfdd4e67790f2d5afdf04e4ca7d25c9b4d`
using UTF-8 compact JSON in original key order, no ASCII escaping or trailing
newline (the same encoding as `JSON.stringify`). Sorted-key serialization
produces a different digest for the same object. The corrected object is
bound by the focused regression; TREM2 and all other report objects remain
unchanged. Independent review and test execution are recorded separately.

## Source-name registration scope

The two reviewed NCRAD and JAMA URL paths are added as source-name aliases.
The existing classifier uses a path substring on the same line; these entries
are not per-file controls or strict URL authorization and do not reject every
query or child-path suffix. Bare hosts, unrelated paths, lookalikes and private
denied names remain refused. No scanner or private-denylist control changes.
