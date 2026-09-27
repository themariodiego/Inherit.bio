# APC I1307K report correction

Source access and agent review: 23 September 2026. Applies only to
`colorectal-apc-i1307k`; no clinical approval or human signoff is claimed.

[Laken 1997](https://pubmed.ncbi.nlm.nih.gov/9288102/): author abstract only,
including the T-to-A identity at APC coding position 3920. Full-paper access
is not claimed. The current [NCBI RefSNP record](https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/1801155)
independently places that change on GRCh38 at chromosome 5:112839514, forward
T>A. The local snapshot preserves its complete top-level placement and the
full response hash. C/G alternatives are not treated as I1307K.

[Valle 2023, full paper](https://www.ukcgg.org/media/12580/insight-apc-pi1307k.pdf):
read the methods, ancestry definitions, colorectal association results,
homozygote section, heterogeneity discussion and conclusions (printed pages
1035–1041). Visually checked the non-Jewish study table and homozygote section
on page 1039. The 19-study Ashkenazi Jewish meta-analysis reports 566/4940
carriers among cases and 928/12945 among controls; adjusted odds ratio 1.78
(95% CI 1.54–2.06). Other populations have weaker evidence, with heterogeneous
ancestry definitions and controls. Two-copy risk cannot be ranked from the
limited homozygote observations. This is a systematic review with an original
meta-analysis, not a new individual-level cohort.

[Allen 2025, published primary paper](https://repository.icr.ac.uk/server/api/core/bitstreams/99e2e771-711d-4bdd-b509-f58f0a8610f1/content):
read Methods, Results, Table 1 and Discussion; visually inspected Table 1 on
PDF page 3. Use the published analysis, not its earlier preprint: 466315 UK
Biobank participants and 8944 colorectal cancer cases. The Ashkenazi Jewish
comparison had only two carriers among 39 cases; odds ratio 0.71 (0.17–2.95).
The non-Ashkenazi white comparison had seven carriers among 8688 cases; odds
ratio 1.05 (0.50–2.22). Both intervals are too broad to settle the association.
Non-significance is not proof of no effect. The authors' proposed management
approach is interpretation, not evidence of equal effects across ancestries.

The summary and AT explanation now qualify the population evidence; TT no
longer promises unelevated cancer risk or standard screening. AA preserves
the limited evidence for two copies. None of these strings supplies an
individual probability, infers the reader's ancestry or sets a care plan.
The four exact strings are canonical claims. Source links on declared
surfaces are not proof of a hosted journey or complete catalog review.

The short quotations in `data/citations.json` are the only new verbatim
publication excerpts. Papers and table images remain outside the repository.
