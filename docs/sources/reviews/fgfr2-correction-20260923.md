# FGFR2 report correction

Applies to `breast-cancer-fgfr2-rs2981582`. Primary-source review on
23 September 2026; agent review, not clinical approval or human signoff.

[Easton 2007, full paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC2714974/)
and [publisher supplement](https://www.nature.com/articles/nature05887#MOESM272)
were read: main Table 2, FGFR2 fine mapping, pattern-of-risk results,
Discussion, Methods, and Supplementary Tables 4, 7 and 8. Supplementary
Table 8 page 14 was also rendered and visually checked. The separate
supplementary XLS was not read. The author abstract alone was not used
to establish the genotype ordering. DOI: `10.1038/nature05887`;
PMID: `17529967`.

Table 2 gives stage-3 odds ratios of 1.23 (95% CI 1.18–1.28) for AG and
1.63 (1.53–1.72) for AA, each compared with GG. Its minor-allele ordering
is resolved by Supplementary Table 8 page 14: the rs2981582 row lists G/A,
and footnote 1 identifies the first allele as the commoner G associated
with lower risk. These are case-control associations, not an individual's
future probability. Methods stratify European and Asian study groups;
the paper reports a smaller effect in the Asian groups. Discovery cases
were women, and stage 1 excluded known BRCA1/2 mutation carriers.

[NCBI RefSNP](https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/2981582)
and [Ensembl](https://rest.ensembl.org/variation/human/rs2981582?content-type=application/json)
were read on the same date. Both confirm forward A/G at GRCh38
10:121592803. NCBI gives reference A on NC_000010.11, with zero-based
SPDI offset 121592802. Reference status does not imply lower risk.
NCBI also lists rare alternatives; this review supports only the A/G
comparison. Opposite-strand letters need the existing file normalization,
not an assumption based only on the rsID.

The correction removes a European-wide frequency claim: Discussion gives
about 14% UK rare homozygotes. It removes the unsupported statement that
GG is the most common genotype. The paper's receptor-binding speculation
concerns another marker; the sections and tables read do not establish
an estrogen-receptor-positive outcome for this report. Comparative claims
about other risk factors and clinical testing or screening instructions
are also removed. The study does not validate those instructions.

The four corrected strings retain the supported genotype ordering and
state the limits of one marker. Their canonical publication excerpt is
11 words; this note adds no verbatim quotation. The coordinate and evidence
tier are unchanged. Registering these four strings does not complete
the cancer catalog, establish clinical validity, or certify a release row.
