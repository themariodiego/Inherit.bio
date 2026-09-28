# Habitual caffeine intake AHR report: cited the wrong paper, now corrected

Applies to `caffeine-intake-ahr-rs4410790`. Source review on 28 September 2026;
agent review, not clinical or human signoff.

## The defect

The report cited PMID `21357676` (Sulem et al., Hum Mol Genet 2011) for
rs4410790. That paper reports a **different** AHR SNP (rs6968865), a per-allele
effect of about 0.2 cups a day, and a sample of about 11,000 coffee drinkers.
It does not name rs4410790. The report also said "hundreds of thousands of
people", which no cited source supported.

## Sources actually read (28 September 2026)

- [Cornelis et al., PLoS Genet 2011, PMID 21490707](https://pubmed.ncbi.nlm.nih.gov/21490707/):
  author abstract and PMC full text read. "Genome-wide meta-analysis identifies
  regions on 7p21 (AHR) and 15q24 (CYP1A2) as determinants of habitual caffeine
  consumption", in 47,341 individuals of European descent. Table 1 gives
  rs4410790 as the top 7p21 SNP (P = 2.4e-19) with effect allele T and
  beta -0.15, so the C allele associates with more caffeine. Table S3 legend and
  Results give a crude homozygote difference of 44 mg/day for rs4410790, which is
  about a third of a cup of coffee at the paper's assumed 137 mg per cup. This
  paper names rs4410790 and matches the report's C = more direction.
- [Coffee and Caffeine Genetics Consortium (Cornelis et al.), Mol Psychiatry 2015, PMID 25288136](https://pubmed.ncbi.nlm.nih.gov/25288136/):
  PMC full text read. Table 2 states the rs4410790 C allele is the allele
  associated with increased coffee consumption, confirming the direction in a
  larger sample.

## What changed

- The citation `21357676` (Sulem 2011) is replaced with `21490707`
  (Cornelis 2011), the paper that actually reports rs4410790.
- The summary "Studies of hundreds of thousands of people" becomes "A study of
  tens of thousands of people", matching Cornelis 2011's 47,341 participants.
- The magnitude wording is aligned to the source's 44 mg/day homozygote
  difference: the summary now says the two homozygous groups differed by about a
  third of a cup of coffee a day, and the CC explanation says about a third of a
  cup more than TT (it previously said a quarter). The C = more direction, which
  the source supports, is unchanged.

Genotype directions and the rest of the report are unchanged. This is a limited
correction and does not claim a personal prediction or clinical validity.
