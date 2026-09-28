# Photic sneeze reflex (ZEB2 report): the two studies point to opposite alleles

Applies to `photic-sneeze-reflex-zeb2`. Source review on 28 September 2026;
agent review, not clinical or human signoff.

## The defect

The report said "Studies in both European-ancestry and Chinese groups link the
C allele to a higher chance of the reflex", and its CC and TT explanations said
both cited studies linked C. The Chinese study links the **T** allele, not C, so
the report contradicted one of its own sources.

## Sources actually read (28 September 2026)

- [Eriksson et al., PLoS Genet 2010, PMID 20585627](https://pubmed.ncbi.nlm.nih.gov/20585627/):
  PMC full text read. Table 10 gives the photic-sneeze counts by rs10427255
  genotype in 5,390 northern-European participants: sneeze in 40.1% of CC,
  32.1% of TC and 27.6% of TT, so the C allele is linked to more reports
  (OR 1.32). This is the report's registered European finding.
- [Wang et al., Sci Rep 2019, PMID 30899065](https://pubmed.ncbi.nlm.nih.gov/30899065/):
  PMC full text read. In 3,417 Chinese participants the minor allele of
  rs10427255 is **T** (frequency 0.44), and each T copy conferred 68% higher
  odds of the reflex (OR 1.68). So the Chinese study implicates the T allele.
- Ensembl gives rs10427255 as C/T on the forward strand, with C at 0.50 in
  Europeans and T at 0.56 in East Asians, confirming the two studies name
  opposite alleles rather than a strand artefact this review can resolve.

## What changed

The summary and the CC and TT explanations now state the finding accurately: the
European study linked the C allele to more reports, while the later Chinese study
linked the T allele, so the two groups point to opposite alleles. The CT
explanation was already direction-neutral and is unchanged. Wang 2019 is dated
now that it has been retrieved and confirmed to support the locus association it
is cited for. The old wording is registered in
`data/report-scientific-corrections.json` so saved reports show the correction
notice.

This is a limited correction. It does not establish a personal prediction, and
it does not claim the reflex mechanism is understood.
