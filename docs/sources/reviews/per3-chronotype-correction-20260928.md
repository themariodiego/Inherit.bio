# Chronotype PER3 report: wrong sleep-disorder type and residue number

Applies to `chronotype-per3-rs228697`. Source review on 28 September 2026;
agent review, not clinical or human signoff.

## The defect

The report said the minor G allele was more frequent "in people with delayed
sleep-wake phase disorder", and named the change "Pro415Ala". The cited study
found the G enrichment in free-running type, and explicitly reported no
association with delayed sleep-phase type. The residue number was also wrong.

## Source actually read (28 September 2026)

- [Hida et al., Sci Rep 2014, PMID 25201053](https://pubmed.ncbi.nlm.nih.gov/25201053/):
  PMC full text read. Screening of clock-gene polymorphisms in 182 delayed
  sleep-phase (DSPT), 67 free-running (FRT) and 925 control individuals. The
  PER3 SNP rs228697 was associated with diurnal preference: the minor G allele
  was more common in evening than morning types (OR 2.48). The G allele was also
  more frequent in free-running type individuals than controls (OR 2.02). The
  paper states directly that "DSPT was not associated with any polymorphisms in
  the PER3 gene", and names the amino-acid change P864A.
- Ensembl VEP gives rs228697 as a Pro/Ala missense at protein position 864 on
  the main PER3 transcripts (C/G on the forward strand, G the minor allele at
  0.10 in Europeans), confirming Pro864Ala and the minor-G direction.

## What changed

The summary and the CG explanation now say the G allele was more frequent in
evening types and in people with a free-running circadian rhythm sleep disorder,
and the summary adds that the study found no link to delayed sleep-phase type.
The residue "Pro415Ala" becomes "Pro864Ala". The evening-preference direction,
which the source supports, is unchanged; the CC and GG explanations are
unchanged. Hida 2014 is dated now that it has been retrieved and confirmed. The
old summary and CG wording is registered in
`data/report-scientific-corrections.json` so saved reports show the correction
notice.

This is a limited, early-evidence correction and claims no personal prediction.
