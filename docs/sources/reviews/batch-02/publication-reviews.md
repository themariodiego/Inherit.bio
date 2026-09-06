# Agent publication reviews

Every entry has source access date **2026-09-06** and read scope **complete PubMed abstract**. See the adjacent README for retrieval timestamps and limitations. All paths are relative to the repository; selectors are exact current slugs and rsIDs.

## 20 · pmid:12879365

**ACTN3 genotype is associated with human elite athletic performance.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/12879365/)

Excerpt: “Both male and female elite sprint athletes have significantly higher frequencies of the 577R allele than do controls.”

Fields: `data/templates/basic-traits.json` → `sprint-power-actn3` → `summary`, `variants[rsid=1815739].interpretations.*`; `data/templates/lifestyle-wellness.json` → `muscle-composition-actn3-rs1815739` → same fields.

Supports absence of alpha-actinin-3 in healthy stop-codon homozygotes, approximately 18% in the described white population, and enrichment of the protein-producing allele in elite sprinters. The authors propose compensation by alpha-actinin-2; this is not an experimentally established explanation in the abstract. **Partial support:** the heterozygote association differs by sex; a universal intermediate-performance gradient is not demonstrated. Individual endurance economy, an imperceptible effect outside elite sport, and broad athletic prediction are not established by this case-control abstract. Unresolved: current forward C/T binding, genotype-specific effect sizes, and generalization beyond the sampled athletes.

## 21 · pmid:1394429

**Molecular basis of human hypertension: role of angiotensinogen.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/1394429/)

Excerpt: “found significant differences in plasma concentrations of angiotensinogen among hypertensive subjects with different AGT genotypes”

Fields: `data/templates/heart-cardiovascular.json` → `blood-pressure-agt-m235t` → `summary`, `variants[rsid=699].interpretations.*`.

Supports AGT linkage/association with hypertension and genotype-related plasma differences in two geographically separated hypertensive-sibship panels. **Insufficient exact-claim support:** the abstract does not identify rs699, its forward G/Thr235 assignment, the claimed 10–20% concentration difference, or an AA/AG/GG dose gradient. It does not establish reference homozygotes as the population-average risk group. Unresolved: full-paper variant identity, strand/protein binding, quantitative genotype contrasts, and applicability to an individual rather than affected families.

## 22 · pmid:14559957

**Unique lipoprotein phenotype and genotype associated with exceptional longevity.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/14559957/)

Excerpt: “Those probands with the VV genotype had increased lipoprotein sizes and lower serum CETP concentrations.”

Fields: `data/templates/longevity.json` → `longevity-cetp-i405v-rs5882` → `summary`, `variants[rsid=5882].interpretations.*`.

Supports VV enrichment and larger particles in an Ashkenazi Jewish exceptional-longevity case-control study. The 213 probands had mean age 98.2, not a cohort consisting exclusively of people who reached 100. Proband enrichment was 2.9-fold in men and 2.7-fold in women. **Partial support:** “about three times” is reasonably close for these probands, but the centenarian-only description is narrower than the actual sample. AG's intermediate particle result is not established by the abstract. Unresolved: forward G-to-Val binding and genotype-specific comparison details. Case-control enrichment is not a prospective survival probability or proof of causality.

## 23 · pmid:15130757

**Modest implication of interleukin-6 promoter polymorphisms in longevity.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/15130757/)

Excerpt: “increase in the frequency of interleukin-6 -174GG homozygotes with age”

Fields: `data/templates/longevity.json` → `longevity-il6-rs1800795` → `summary`, `variants[rsid=1800795].interpretations.*`.

Supports a modest age-associated increase in promoter -174GG among 1,710 Danish participants aged 47–100. The paper explicitly describes contradictory prior promoter-level and disease findings. **Partial support:** this is an age-frequency comparison, not an individual survival forecast. The CG intermediate-expression claim is not established by this abstract. Unresolved: promoter-to-forward GRCh38 allele binding and direct genotype-specific expression evidence; the reported association does not validate a general inflammatory-health ranking.

## 24 · pmid:15208781

**A missense single-nucleotide polymorphism in a gene encoding a protein tyrosine phosphatase (PTPN22) is associated with rheumatoid arthritis.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/15208781/)

Excerpt: “we report the association of RA susceptibility with the minor allele of a missense SNP in PTPN22”

Fields: `data/templates/autoimmune.json` → `rheumatoid-arthritis-ptpn22` → `summary`, `variants[rsid=2476601].interpretations.*`.

Supports replicated association in white case-control samples and disruption of a protein-interaction motif by the risk allele. **Partial support:** the abstract's approximately 17% general-population figure describes individuals carrying the allele, not AA homozygote frequency. It does not validate the template's approximately 1% AA frequency, several-fold AA comparison, seropositive-specific result, or forward A-to-620W binding. Unresolved: full-paper genotype strata and modern assembly orientation. A noncarrier comparator is not automatically the population-average risk baseline.

## 25 · pmid:15565110

**Polymorphisms in FKBP5 are associated with increased recurrence of depressive episodes and rapid response to antidepressant treatment.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/15565110/)

Excerpt: “Individuals carrying the associated genotypes had less HPA-axis hyperactivity during the depressive episode.”

Fields: `data/templates/mental-health.json` → `stress-response-fkbp5-rs1360780` → `summary`, `variants[rsid=1360780].interpretations.*`.

Supports FKBP5 associations with antidepressant response, recurrence, and intracellular protein expression in two samples. **Endpoint mismatch:** the template's prolonged/stronger cortisol response conditional on early adversity is not the comparison presented in this abstract. The observed depression-episode HPA result cannot simply be restated as higher acute stress response; these are different conditions and endpoints. No early-adversity interaction, TT prevalence, or CT intermediate response is demonstrated here. Unresolved: rs1360780-specific allele/strand assignment, exposure-specific primary evidence, and whether another source supports the claimed direction. This is not proof that every later FKBP5 interaction finding is false.

## 26 · pmid:15723792

**The molecular basis of individual differences in phenylthiocarbamide and propylthiouracil bitterness perception.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/15723792/)

Excerpt: “Functional expression studies demonstrate that five different haplotypes from the hTAS2R38 gene code for operatively distinct receptors.”

Fields: `data/templates/basic-traits.json` → `bitter-taste-tas2r38` → `summary`, `variants[rsid=713598].interpretations.*`, `variants[rsid=1726866].interpretations.*`.

Supports functional receptor differences across haplotypes and correlation with measured PTC/PROP perception. **Partial support with internal inconsistency:** the summary and rs1726866 interpretations correctly disclose incomplete three-position patterns; rs713598 interpretations still describe a single-position genotype as a nontaster/taster type with personal taste-strength expectations. This abstract tests haplotypes, not a universally sufficient isolated-position classifier. Vegetable liking is not the measured endpoint. Unresolved: exact forward allele/protein mapping and quantitative single-position effects. This review does not infer phase, a complete PAV/AVI pattern, or a personal taste score. The separate Kim citation needs its own review.

## 27 · pmid:15732191

**Variation in the human TP53 gene affects old age survival and cancer mortality.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/15732191/)

Excerpt: “in a prospective study of 1226 people aged 85 years and over”

Fields: `data/templates/longevity.json` → `longevity-tp53-pro72-rs1042522` → `summary`, `variants[rsid=1042522].interpretations.*`.

**Correction after checking every citation on this template:** the initial review wrongly treated this publication as the sole support for the numerical story. It is not. This abstract reports 1,226 participants aged at least 85 and different survival/cancer-mortality measures, but the template also cites [PMID 17535973](https://pubmed.ncbi.nlm.nih.gov/17535973/), *Tumor suppressor p53 Arg72Pro polymorphism and longevity, cancer survival, and risk of cancer in the general population*. That complete abstract was independently read through NCBI efetch on **2026-09-06T01:03:05.173Z**, HTTP 200. It explicitly supports 9,219 Danish participants aged 20–95, twelve-year survival comparisons, and the three-year median-survival difference. Its reported survival increases are 3% for Arg/Pro and 6% for Pro/Pro versus Arg/Arg; the favorable heterozygote direction is therefore supported as well. No additional quotation from that publication is stored in this batch, avoiding duplicate quote allocation with its assigned review batch.

**Revised conclusion:** no mismatch in those whole-template numbers or genotype ordering. Keep the two cohorts and their effect measures distinct; neither study yields a calibrated individual lifespan prediction. Unresolved in this bounded pass: forward G/Pro binding, the independent basis for broad replication/debate wording, and causal interpretation. The earlier request to replace the existing numerical story was a false positive and is withdrawn.

## 28 · pmid:15733200

**Beyond heritability: neurotransmitter genes differentially modulate visuospatial attention and working memory.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/15733200/)

Excerpt: “Increasing gene dose of the C allele of the CHRNA4 gene”

Fields: `data/templates/brain-health.json` → `attention-chrna4-rs1044396` → `summary`, `variants[rsid=1044396].interpretations.*`.

Supports a C-dose association with benefits of valid cues and reduced costs of invalid cues in an 89-person healthy-adult task. CHRNA4 was not associated with working-memory performance; the separate 103-person working-memory experiment concerned DBH. **Narrow association supported:** the template should remain specific to that cueing experiment, not general attention ability. Unresolved: the literature C versus template forward G conversion, exact rsID/placement, and effect precision. The abstract supports neither a diagnosis nor individual cognitive-performance prediction.

## 29 · pmid:15902657

**Genetic variation in the human androgen receptor gene is the major determinant of common early-onset androgenetic alopecia.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/15902657/)

Excerpt: “The X-chromosomal location of AR stresses the importance of the maternal line in the inheritance of AGA.”

Fields: `data/templates/aesthetic-cosmetic.json` → `male-pattern-baldness-ar-rs6152` → `summary`, `variants[rsid=6152].interpretations.*`.

Supports AR-region association with early-onset male-pattern hair loss and X-linked inheritance context. The abstract nominates a GGN repeat as a plausible functional variant. **Insufficient exact-claim support:** it does not identify rs6152's forward risk allele or establish an AG intermediate effect in people with two X chromosomes. An observed genotype alone must not determine sex or expected chromosome count. Unresolved: exact tag association, population linkage, ploidy-aware interpretation, and genotype-specific effect estimates. Association with a linked marker is not proof that this single SNP causes hair loss.

## 30 · pmid:15956988

**COMT polymorphisms and anxiety-related personality traits.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/15956988/)

Excerpt: “with effects confined to women.”

Fields: `data/templates/mental-health.json` → `stress-anxiety-comt-rs4680` → `summary`, `variants[rsid=4680].interpretations.*`.

Supports sex-limited associations with personality-inventory traits in 497 undergraduates and consideration of a three-SNP haplotype. The authors caution that rs4680 alone is unlikely to explain the relationship. **Partial support:** personality traits are not the same as acute stress steadiness, a diagnosis, or a universal AA/AG/GG response gradient. The abstract does not specify the effect allele for these associations. Unresolved: forward genotype binding, magnitude, and acute-stress extrapolation. The template's separate PMID 11381111 is outside this batch; this receipt does not judge evidence it may provide for working memory or enzyme activity.

## 31 · pmid:16044172

**A regulatory variant of the human tryptophan hydroxylase-2 gene biases amygdala reactivity.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/16044172/)

Excerpt: “a relatively frequent regulatory variant (G(-844)T) of hTPH2 biases the reactivity of the amygdala”

Fields: `data/templates/mental-health.json` → `emotional-reactivity-tph2-rs4570625` → `summary`, `variants[rsid=4570625].interpretations.*`.

Supports association of a TPH2 regulatory variant with an amygdala-response measure. **Insufficient exact-claim support:** the abstract does not state the T direction, separate GT/TT results, or exact rsID. It names G(-844)T whereas the template calls the site -703; these could use different transcript coordinates and are not declared contradictory without checking. Unresolved: identity/coordinate reconciliation, forward G/T mapping, stimulus details, and effect precision in the full primary paper. An imaging response is not a personal emotional-health prediction.

## 32 · pmid:16415884

**Variant of transcription factor 7-like 2 (TCF7L2) gene confers risk of type 2 diabetes.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/16415884/)

Excerpt: “Compared with non-carriers, heterozygous and homozygous carriers of the at-risk alleles”

Fields: `data/templates/metabolic-obesity.json` → `type-2-diabetes-tcf7l2-rs7903146` → `summary`, `variants[rsid=7903146].interpretations.*`.

Supports replicated TCF7L2 association across Icelandic, Danish, and US cohorts. The abstract's named marker is microsatellite DG10S478, with relative risks 1.45/2.41 and carrier proportions 38%/7%. **Partial support:** those figures cannot automatically be transferred to rs7903146 without the full-paper SNP/linkage analysis. The abstract proposes a proglucagon/Wnt mechanism; it does not demonstrate the template's insulin-secretion or lifestyle-trial claims. Unresolved: exact SNP/effect-allele mapping, genotype frequencies, primary intervention source, and the time-sensitive “largest common” comparison.

## 33 · pmid:16444273

**A SNP in the ABCC11 gene is the determinant of human earwax type.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/16444273/)

Excerpt: “The AA genotype corresponds to dry earwax, and GA and GG to wet type.”

Fields: `data/templates/aesthetic-cosmetic.json` → `earwax-body-odor-abcc11-rs17822931` → `summary`, `variants[rsid=17822931].interpretations.*`; `data/templates/basic-traits.json` → `earwax-type-abcc11` → same fields and `citations[pmid=16444273].studyContext`.

Supports coding-strand 538G>A association with earwax, geographic allele-frequency differences, lower cell transport for A, and a rare deletion. The excerpt uses the paper's coding strand, not the template's forward C/T labels. **Endpoint overreach in cosmetic interpretations:** deodorant benefit and a CT intermediate body-odor magnitude are not tested here. Basic-trait study-context comparisons and the cell-versus-odor limitation fit the abstract; its participant counts/stage descriptions require the cited supplement, not this abstract-only pass. Unresolved: current forward complement binding and any independent body-odor/utility source. Existing template access dates were not changed or re-certified.

## 34 · pmid:16642438

**Sequence and haplotype analysis supports HLA-C as the psoriasis susceptibility 1 gene.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/16642438/)

Excerpt: “These results strongly suggest that HLA-Cw6 is the PSORS1 risk allele”

Fields: `data/templates/autoimmune.json` → `psoriasis-hla-c-0602` → `summary`, `variants[rsid=10484554].interpretations.*`.

Supports HLA-Cw6 association using sequenced haplotypes and 678 early-onset-psoriasis families. **Insufficient tag-specific support:** the abstract does not validate rs10484554 as a tag in the intended populations, its forward T assignment, CT/TT risk ordering, or the fraction of carriers who never develop psoriasis. Unresolved: direct evidence for tag sensitivity/linkage, genotype-specific risk and absolute penetrance. A tag is not equivalent to direct HLA typing, and a non-tag genotype is not proof of absence of the named HLA form or population-average disease risk.

## 35 · pmid:17053149

**Common Kibra alleles are associated with human memory performance.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/17053149/)

Excerpt: “A genomic locus encoding the brain protein KIBRA was significantly associated with memory performance”

Fields: `data/templates/brain-health.json` → `episodic-memory-kibra-rs17070145` → `summary`, `variants[rsid=17070145].interpretations.*`.

Supports memory association in three cognitively normal Swiss/US cohorts, expression in memory-related structures, and genotype-related hippocampal activation. **Insufficient exact-claim support:** the abstract does not identify rs17070145's T direction or show that TT performs better than CT. A carrier comparison must not silently become a three-genotype additive gradient. Unresolved: exact locus binding, delayed-recall measure, genotype-stratified contrast, magnitude, and replication limitations. These findings do not provide an individual's memory score.

## 36 · pmid:17068223

**A genome-wide association study identifies IL23R as an inflammatory bowel disease gene.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/17068223/)

Excerpt: “An uncommon coding variant (rs11209026, c.1142G>A, p.Arg381Gln) confers strong protection against Crohn's disease”

Fields: `data/templates/autoimmune.json` → `inflammatory-bowel-disease-il23r` → `summary`, `variants[rsid=11209026].interpretations.*`.

Supports this exact coding variant's protective Crohn's association and replicated IL23R associations in Crohn's/ulcerative-colitis cohorts. **Partial support:** the abstract does not quantify the AA-versus-AG protection gradient, prove weaker signaling for this allele, or establish psoriasis protection. Coding notation still needs explicit current assembly/forward binding. Unresolved: homozygote evidence, population frequencies, disease-specific replication, and functional mechanism. Noncarriers are the study comparator, not automatically the population-average risk group.

## 37 · pmid:17158188

**Novel genes identified in a high-density genome wide association study for nicotine dependence.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/17158188/) · DOI `10.1093/hmg/ddl441`.

Excerpt: “none of the individual findings is statistically significant after correcting for multiple tests”

Fields: `data/templates/addiction.json` → `nicotine-dependence-chrna5-rs16969968` → `citations[pmid=17158188].label`, `summary`, `variants[rsid=16969968].interpretations.*`.

**Concrete bibliographic mismatch:** the record's first author is Bierut, while the template label says Saccone. The abstract describes 1,050 nicotine-dependent cases and 879 nondependent smoking controls, nominating NRXN1 and the beta3 receptor among candidate findings. It does not establish rs16969968's A/Asn398 assignment, an additional cigarette per day, or the template's dose gradient. This does not prove the SNP is absent from all tables or supplements; complete full text was not successfully reviewed. Unresolved: correct supporting primary publication, endpoint/effect size, and genotype binding. Do not treat the current citation as verified support for those specific claims.

## 38 · pmid:17329997

**A genetic variation in the adenosine A2A receptor gene (ADORA2A) contributes to individual sensitivity to caffeine effects on sleep.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/17329997/) · DOI `10.1038/sj.clpt.6100102`.

Excerpt: “habitual caffeine consumption is associated with reduced sleep quality in self-rated caffeine-sensitive individuals”

Fields: `data/templates/brain-health.json` → `caffeine-sleep-adora2a-rs5751876` → `title`, `summary`, `variants[rsid=5751876].interpretations.*`.

Supports ADORA2A c.1083T>C genotype-related subjective sleep sensitivity and sleep electrical-activity responses to caffeine. **Endpoint/direction unresolved:** anxiety is not the measured endpoint described in this abstract. The abstract does not state which homozygote is sleep-sensitive or establish an intermediate CT effect. Thus it cannot substantiate the template's combined TT-more-anxiety-and-sleep-disruption ranking. Unresolved: full-paper genotype direction, rsID/strand equivalence, and a separate anxiety source. No allele reversal is asserted from memory, and no personal caffeine threshold is inferred.

## 39 · pmid:17339269

**A common haplotype of the annexin A5 (ANXA5) gene promoter is associated with recurrent pregnancy loss.** [Primary record](https://pubmed.ncbi.nlm.nih.gov/17339269/)

Excerpt: “four consecutive nucleotide substitutions in the ANXA5 promoter, which were transmitted as a joint haplotype (M2)”

Fields: `data/templates/reproductive-family.json` → `recurrent-pregnancy-loss-anxa5-m2` → `summary`, `variants[rsid=112782763].interpretations.*`.

Supports a joint four-change promoter haplotype, in-vitro promoter activity of 37–42% of the comparator, and association in 70 selected German recurrent-loss patients. Odds ratios differ by control selection: 2.42 with unselected controls, 3.88 with prior-successful-pregnancy controls. **Insufficient single-tag/dose support:** the abstract does not establish that rs112782763 alone identifies M2 in every population, or a separately estimated TT-versus-CT clinical effect. Unresolved: tag linkage/forward allele binding, homozygote data, prevalence, and replication. Reporter activity is not an individual's clinical prognosis; no reproductive or treatment conclusion is approved here.
