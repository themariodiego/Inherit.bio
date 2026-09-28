# Motion sickness report: rs66800491 allele direction was reversed

Applies to `motion-sickness-susceptibility`. Source review on 28 September 2026;
agent review, not clinical or human signoff.

## The defect

For rs66800491 the report said AA is linked to somewhat lower car sickness and
GG to more. The cited source reports the opposite direction.

## Source actually read (28 September 2026)

- [Hromatka et al., Hum Mol Genet 2015, PMID 25628336](https://pubmed.ncbi.nlm.nih.gov/25628336/):
  PMC full text read. Genome-wide association study of car sickness in 80,494
  23andMe participants. Table 2 lists rs66800491 (alleles A/G) with an effect of
  -0.078 per copy of the alphabetically second allele, on a four-point scale of
  increasing motion sickness; the table footnote defines the sign this way. So
  each G copy lowers the motion-sickness score and each A copy raises it: A is
  the higher-susceptibility allele, G the lower. Ensembl gives rs66800491 as G/A
  on the forward strand with G the major allele (0.70 in Europeans), matching the
  table's second (G) allele.
  The second variant, rs2153535 (effect +0.046 per second allele G), matches the
  report's existing "G = more car sickness" direction and is unchanged.

## What changed

The rs66800491 AA and GG explanations are corrected: AA is now associated with
somewhat higher reported car sickness and GG with less, matching the source. The
rs66800491 AG explanation and both rs2153535 explanations were already correct or
neutral and are unchanged. Hromatka 2015 is dated now that it has been retrieved
and confirmed to support the corrected report. The old AA and GG wording is
registered in `data/report-scientific-corrections.json` so saved reports show the
correction notice.

The report's cytoband label for rs66800491 (3q13.2) is left as written; the
correction is limited to the allele direction, which is the finding a reader
acts on. This is a limited correction and claims no personal prediction.
