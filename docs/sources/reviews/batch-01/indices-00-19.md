# Agent source review: citation indices 00–19

Review date: 2026-09-06 (UTC). Agent review only; not clinical review, author signoff, publication approval, or acceptance credit. No report text or evidence labels were changed.

## Selection and receipt convention

Source checkout: `7dd7a111c9570b1cab22f0f695c10c1062219079`. Iterate the arrays in `data/templates/*.json`; use `pmid:<pmid>` when a citation has PMID, otherwise `doi:<doi>`; deduplicate and apply JavaScript default `.sort()`. There are 186 keys. This file covers exactly indices 0–19, including every associated report. DOI aliases below identify the same publication, not additional sources or additional quote budgets.

Field pointers are relative to the report object selected by the exact `slug` in the named JSON file. For example, `/variants/0/interpretations/AG` is not an array index across the whole catalog. A claim not supported by this citation is not necessarily disproved by all research; companion citations outside this batch remain separate review work.

All 19 PMID records below were actually read on 2026-09-06 through the Europe PMC REST core record, including its author abstract when present. The exact primary-record request URL is `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:<PMID>%20AND%20SRC:MED&format=json&resultType=core`, substituting the listed PMID. This is the MED publication record, not a secondary consumer interpretation. Each entry additionally links its human-readable identifier. Full-paper URLs actually read are explicitly identified. No access date is asserted for a linked DOI landing page unless separately stated as read.

There is exactly one bounded excerpt per publication below, no more than 25 words. Metadata titles are identifiers, not a second excerpt. Full abstracts/papers are not reproduced. Abstract-only reviews do not certify GRCh38 coordinates, forward alleles, genotype frequencies, penetrance, causality, or unreported subgroup comparisons. Such checks remain explicit below.

## 00 — doi:10.1186/2044-7248-1-22

Publication: Eriksson et al., *A genetic variant near olfactory receptor genes influences cilantro preference* (2012). DOI: [10.1186/2044-7248-1-22](https://doi.org/10.1186/2044-7248-1-22). Full published paper read 2026-09-06: [author-hosted PDF](https://ai.stanford.edu/~chuongdo/papers/cilantro.pdf), pages 1–6, especially Table 2 and Results/Methods.

> The C allele is associated with both detecting a soapy smell and disliking cilantro.

Report: `basic-traits.json` → `cilantro-soapy-taste-or6a2`.

Supports `/summary` and A-versus-C direction in all three interpretations: 14,604 European-ancestry discovery participants reported soapiness; 11,851 independent participants reported liking, a different outcome. Table 2 defines the A-allele association; page 4 supports the approximately 0.5% variance statement. The source uses build 37 forward alleles, not the template’s build 38 coordinate.

Needs correction/qualification: `/summary` receptor explanation should preserve OR6A2 as a candidate, not the demonstrated causal explanation; OR10A2 is another candidate. `/variants/0/interpretations/CC` says exposure and cooking habits strongly shape preference, but this study discusses environmental modulation as a possibility rather than measuring those effects. Clarify the different replication outcome. Resolve coordinate conversion independently; genotype-specific absolute probabilities are not supplied.

## 01 — pmid:10192379

Publication: North et al., *A common nonsense mutation results in alpha-actinin-3 deficiency in the general population* (1999). [PMID 10192379](https://pubmed.ncbi.nlm.nih.gov/10192379/); DOI `10.1038/7675`. PubMed record also read 2026-09-06. Publisher full-text attempt was unsuccessful; no full-paper access is claimed.

> No abstract available

Report: `basic-traits.json` → `sprint-power-actn3`.

Status: identifier-only receipt. The resolved title identifies the protein-deficiency topic but is not evidence approval of `/summary` or any genotype interpretation. `/summary` says TT causes no illness and gives population and athlete frequencies; `/variants/0/interpretations/CT` orders sprint performance and declares effects unnoticeable outside elite sport; `/variants/0/interpretations/TT` asserts protein replacement, endurance economy, and no known health effect. None was verified from readable primary text in this receipt. Companion PMID 12879365 needs its own sports-claim review.

Unresolved: obtain the two-page original paper, distinguish observed lack of a particular clinical phenotype from universal absence of health effects, and verify rs1815739/build/allele mapping and numerical frequencies. This is not a failed-study or disproved-claim classification.

## 02 — pmid:10233211

Publication: Sachse et al., *Functional significance of a C-->A polymorphism in intron 1 of the cytochrome P450 CYP1A2 gene tested with caffeine* (1999). [PMID 10233211](https://pubmed.ncbi.nlm.nih.gov/10233211/); DOI `10.1046/j.1365-2125.1999.00898.x`. [PMC full paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC2014233/) Results and Discussion read 2026-09-06 by direct HTTPS after browser retrieval failed.

> no significant differences were seen between the C/C and A/C group

Report: `lifestyle-wellness.json` → `caffeine-metabolism-cyp1a2-rs762551`.

Supports the corrected `/summary` and smoking-qualified `/variants/0/interpretations/AA`, `/AC`, and `/CC`: 185 nonsmokers had no significant three-genotype difference; among 51 smokers the AA–AC comparison differed, while CC did not significantly differ from either group. The endpoint was a caffeine-metabolite ratio after 100 mg caffeine, not subjective coffee response or a universally applicable speed class.

Limitations: the source describes possible inducibility or linkage, not proven variant causality. The exact five-person CC count in `/variants/0/interpretations/CC` was not independently recovered from the text portions read here; retain it as a specific figure/sample-size check against the earlier source receipt. The paper’s intron numbering is not an independent GRCh38 coordinate validation. No new contradictory scientific claim identified in the corrected scope.

## 03 — pmid:10973253

Publication: Altshuler et al., *The common PPARgamma Pro12Ala polymorphism is associated with decreased risk of type 2 diabetes* (2000). [PMID 10973253](https://pubmed.ncbi.nlm.nih.gov/10973253/); DOI `10.1038/79216`. Author abstract read.

> increase in diabetes risk associated with the more common proline allele

Report: `metabolic-obesity.json` → `type-2-diabetes-pparg-pro12ala`.

Supports `/summary` disease-association direction at the amino-acid level: over 3,000 participants, family-based design and replication, modest association with Pro12. It does not directly establish absolute personal risk.

Unverified extensions: `/summary`, `/variants/0/interpretations/CG`, and `/GG` assert better insulin response/sensitivity; `/GG` gives a separately ordered homozygous outcome; `/CC` and `/GG` give European genotype frequencies. The abstract reports a proline allele frequency, not those genotype percentages. `/CC` also infers a small individual contribution because a genotype is common, which is not a valid general inference from frequency alone. `/GG` ranks other influences without a measured comparison.

Required checks: full-paper genotype-specific estimates, insulin-sensitivity evidence, study populations, and forward C/G-to-Pro/Ala/build mapping. Preserve the supported association while distinguishing these unanswered claims.

## 04 — pmid:10999835

Publication: Pérez Mayorga et al., *Ovarian response to follicle-stimulating hormone (FSH) stimulation depends on the FSH receptor genotype* (2000). [PMID 10999835](https://pubmed.ncbi.nlm.nih.gov/10999835/); DOI `10.1210/jcem.85.9.6789`. Author abstract read.

> Peak estradiol levels, number of preovulatory follicles, and number of retrieved oocytes were similar

Report: `reproductive-family.json` → `ovarian-fsh-response-fshr-asn680ser`.

Supports the core `/summary` and genotype-associated basal-FSH/stimulation comparisons: 161 ovulatory women under 40 undergoing controlled stimulation; Asn/Asn, Asn/Ser, Ser/Ser had progressively higher mean basal FSH and ampoule use with similar achieved outcomes. Infertility was attributed to male/tubal factors in the couples, not to demonstrated infertility caused by the variant.

Overextensions to check: `/variants/0/interpretations/CC` generalizes a cohort’s approximately quarter frequency to people generally; `/CT` says most common in most populations and describes how clinicians rely on measured hormones; neither generalization is established here. `/TT` stronger response to a given dose is a dose-response interpretation, not a randomized fixed-dose comparison. `/summary` normal fertility is not directly measured by this treatment study.

Unresolved: two linked receptor forms (307/680), forward nucleotide mapping, receptor mechanism versus clinical association, wider populations and fertility outcomes.

## 05 — pmid:11381111

Publication: Egan et al., *Effect of COMT Val108/158 Met genotype on frontal lobe function and risk for schizophrenia* (2001). [PMID 11381111](https://pubmed.ncbi.nlm.nih.gov/11381111/); DOI `10.1073/pnas.111134598`. [PMC paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC34453/) cognition/method context read 2026-09-06; author abstract read in full.

> the load of the low-activity Met allele predicted enhanced cognitive performance

Reports: `brain-health.json` → `executive-function-comt-rs4680`; `mental-health.json` → `stress-anxiety-comt-rs4680`.

Supports a limited cognition result: 175 patients with schizophrenia, 219 siblings, 55 controls; executive-test errors and small fMRI subgroups, not general intelligence. Supports the reported functional enzyme difference as background, but not direct measurement of each user’s dopamine.

Not supported by this study: executive report `/summary`, `/variants/0/interpretations/GG` sudden-stress advantage and `/AA` stress/pain response; stress report `/summary` female anxiety, `/GG` anxiety/sudden-stress claims, `/AG` intermediate anxiety and comparative life-factor importance, `/AA` anxiety/stress claims. These are different outcomes. The stress report’s companion citation remains separately reviewable; it cannot silently lend support to all claims in the executive report.

Unresolved: original genotype mapping and whether any cited study actually tests each added outcome or additive ordering. Retain the measured cognition association with its study population.

## 06 — pmid:11385576

Publication: Hugot et al., *Association of NOD2 leucine-rich repeat variants with susceptibility to Crohn's disease* (2001). [PMID 11385576](https://pubmed.ncbi.nlm.nih.gov/11385576/); DOI `10.1038/35079107`. Author abstract read.

> a frameshift variant and two missense variants of NOD2

Report: `autoimmune.json` → `crohns-disease-nod2`.

Supports `/summary` identification of NOD2 susceptibility associations and a proposed microbial-recognition mechanism. The abstract distinguishes three independent associations but does not give the two missense identifiers or their genotype-specific estimates.

Unresolved claims: `/summary` and `/variants/0/interpretations/TT`, `/variants/1/interpretations/CC` two-copy effect size and ileal emphasis; `/variants/0/interpretations/CT` and `/variants/1/interpretations/CG` allele frequencies and penetrance; each reference-homozygote interpretation equates absence of this allele with population-baseline odds, which is not established by a case-control reference category. The paper does not provide a personal absolute-risk calibration in the abstract.

Next evidence required: full-paper tables binding R702W/G908R to the actual alleles and cohorts, phase/compound-genotype treatment, measured phenotype location, contemporary mechanistic source if asserting the exact cell-wall ligand. No genotype or reference-baseline claim approved from this abstract alone.

## 07 — pmid:11385577

Publication: Ogura et al., *A frameshift mutation in NOD2 associated with susceptibility to Crohn's disease* (2001). [PMID 11385577](https://pubmed.ncbi.nlm.nih.gov/11385577/); DOI `10.1038/35079114`. Author abstract read.

> a frameshift mutation caused by a cytosine insertion, 3020insC

Report: `autoimmune.json` → `crohns-disease-nod2`.

Supports the existence of an associated NOD2 frameshift and cell-based NF-kappaB response findings. That frameshift is explicitly not one of this report’s two displayed missense readings.

Do not bind this citation alone to `/variants/0/interpretations` (R702W) or `/variants/1/interpretations` (G908R) as evidence for their precise effects, genotype frequencies, ileal involvement or absolute risk. Those need the other paper or additional directly applicable evidence. `/summary` modern bacterial-cell-wall sensing should not convert the paper’s lipopolysaccharide-response experiment into a verified modern ligand claim.

Limitations/unresolved: source is a positional/association and laboratory investigation, not clinical penetrance calibration. Read the full paper before attributing any additional missense analyses to it; the abstract only identifies the insertion result. Shared report findings under index 06 remain unresolved, not counted twice as independent replication of every statement.

## 08 — pmid:11788828

Publication: Enattah et al., *Identification of a variant associated with adult-type hypolactasia* (2002). [PMID 11788828](https://pubmed.ncbi.nlm.nih.gov/11788828/); DOI `10.1038/ng826`. Author abstract read.

> completely associates with biochemically verified lactase non-persistence

Report: `gastrointestinal.json` → `lactase-persistence-lct-rs4988235`.

Supports adult lactase activity, with nine Finnish families and 236 people from four populations; the second marker associated in 229/236, not perfect independent confirmation. The existing study-context distinction between enzyme activity and symptoms is appropriate.

Overreach in older personal prose: `/summary` infers most dairy is tolerated; `/variants/0/interpretations/AG` promises usual dairy amounts without symptoms; `/AA` infers dairy tolerance and another cause of symptoms; `/variants/1/interpretations/TT` infers comfortable dairy digestion. These clinical symptom/food-quantity outcomes were not established by the abstract’s biochemical classification. `/variants/1/interpretations/CT` calls the linked marker confirmation, obscuring its imperfect association and lack of independence.

Unresolved: separate symptom evidence, servings/fermented-food claims in `/variants/0/interpretations/GG`, population-specific persistence mechanisms, and full-paper forward-strand conversion of historical -13910/-22018 nomenclature. Preserve the useful enzyme finding without treating it as a symptom test.

## 09 — pmid:11792841

Publication: Arking et al., *Association of human aging with a functional variant of klotho* (2002). [PMID 11792841](https://pubmed.ncbi.nlm.nih.gov/11792841/); DOI `10.1073/pnas.022484299`. [PMC paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC117395/) Results, Table 2, Figure 2 and Discussion read 2026-09-06.

> a heterozygote advantage was seen in the Bohemian Czech population

Report: `longevity.json` → `longevity-klotho-kl-vs-rs9536314`.

Supports reduced representation of KL-VS homozygotes in elderly cohorts. The heterozygote survival result occurred in the Czech cohort, not either Baltimore population. KL-VS was six linked variants including F352V and C370S; the single-site proxy is not itself the complete form. Cell experiments found different effects for the individual substitutions versus their combination.

Qualify `/summary` and `/variants/0/interpretations/GT`: this paper is not evidence of a broadly replicated one-copy survival benefit or thinking performance. `/GG` frequency of 2–3% is not population-universal; Table 2 varies by ancestry/age. `/TT` no harm from lacking the variant is not a tested universal health conclusion. Extra-klotho mouse lifespan and cognitive claims require their own sources, not this study.

Unresolved: source-bound modern strand/coordinate mapping and direct sources for those extra outcomes. Preserve the cohort-specific finding and the already stated uncertainty.

## 10 — pmid:12060782

Publication: Sipe et al., *A missense mutation in human fatty acid amide hydrolase associated with problem drug use* (2002). [PMID 12060782](https://pubmed.ncbi.nlm.nih.gov/12060782/); DOI `10.1073/pnas.082235799`. [PMC paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC123078/) functional results and Discussion read 2026-09-06.

> normal catalytic properties but an enhanced sensitivity to proteolytic degradation

Report: `addiction.json` → `problem-substance-use-faah-rs324420`.

Supports AA-associated self-reported problem drug use and reduced protein stability in the reported assays. It does not establish reduced catalytic activity as the same phenomenon. The paper discusses linkage and questionnaire-grouping confounding; heterozygotes were not associated with the drug-use outcome.

Unsupported by this source: `/summary` directly raised human anandamide levels, later stress/cannabis effects and replication failures; `/variants/0/interpretations/AC` raised baseline signaling and stress/reward conclusions. The discussion instead hypothesizes approximately maintained endocannabinoid balance in heterozygotes. `/AA` later-study inconsistency also requires actual later citations. These are not harmless restatements of the original endpoint.

Unresolved: in-vivo human biochemical evidence, later replication/outcome studies, precise forward rsID/build binding. Retain the explicitly preliminary AA association, but do not infer a personal substance-use tendency from laboratory protein behavior.

## 11 — pmid:12419833

Publication: Yokoyama et al., *Genetic polymorphisms of alcohol and aldehyde dehydrogenases and glutathione S-transferase M1 and drinking, smoking, and diet in Japanese men with esophageal squamous cell carcinoma* (2002). [PMID 12419833](https://pubmed.ncbi.nlm.nih.gov/12419833/); DOI `10.1093/carcin/23.11.1851`. Author abstract read.

> 234 Japanese men with esophageal squamous cell carcinoma and 634 cancer-free Japanese men

Report: `gastrointestinal.json` → `alcohol-flush-aldh2-rs671`.

Supports the qualitative cancer sentences in `/variants/0/interpretations/AG` and their population/exposure limits: the case-control comparison included heterozygous inactive ALDH2 and working-form groups, with an association in the defined light-drinking group as well as larger exposure groups. Current prose does not display a naked relative-risk number or claim personal absolute risk.

Limits: male Japanese case-control sample, reported drinking categories, multiple correlated exposures and genotypes. The source’s heterozygote comparison must not be extrapolated to AA, women, all populations, safe intake, or a calibrated lifetime cancer probability. Enzyme/flushing and two-AA-liver observations belong to the report’s other citations, not this paper.

Unresolved: this abstract’s ALDH2*1/*2 nomenclature is not a fresh independent GRCh38 nucleotide mapping. No new mismatch found in the specifically corrected qualitative cancer wording.

## 12 — pmid:12540637

Publication: Gloyn et al., *Large-scale association studies of variants in genes encoding the pancreatic beta-cell KATP channel subunits Kir6.2 (KCNJ11) and SUR1 (ABCC8) confirm that the KCNJ11 E23K variant is associated with type 2 diabetes* (2003). [PMID 12540637](https://pubmed.ncbi.nlm.nih.gov/12540637/); DOI `10.2337/diabetes.52.2.568`. Author abstract read.

> did not show familial association with diabetes

Report: `metabolic-obesity.json` → `type-2-diabetes-kcnj11-e23k`.

Supports a modest K-allele association in the UK case-control sample and combined case-control analysis, including KK findings. The family component was not positive; the study should not be described as uniformly replicated across its designs.

Unverified extensions: `/summary`, `/variants/0/interpretations/CC` and `/TT` assert measured reduction of insulin secretion as the causal path; the abstract establishes channel background and association, not that physiological comparison. `/CT` and `/TT` European genotype percentages are not provided. `/CT` says weight, age and family history dwarf the shift without measuring that comparison.

Required checks: full-paper functional references, population frequencies, genotype-specific estimates and forward GRCh38 T-to-K mapping. Preserve the modest disease association rather than deriving a patient’s secretion level or absolute diabetes risk.

## 13 — pmid:12553913

Publication: Egan et al., *The BDNF val66met polymorphism affects activity-dependent secretion of BDNF and human memory and hippocampal function* (2003). [PMID 12553913](https://pubmed.ncbi.nlm.nih.gov/12553913/); DOI `10.1016/s0092-8674(03)00035-7`. Author abstract read.

> Neurons transfected with met-BDNF-GFP showed lower depolarization-induced secretion

Reports: `brain-health.json` → `memory-plasticity-bdnf-rs6265`; `mental-health.json` → `mood-stress-resilience-bdnf-rs6265`.

Supports human episodic-memory/imaging association and a separate transfected-neuron secretion experiment. It does not equate the latter with measured BDNF release in the brains of genotyped people.

Concrete gap: the mood report’s sole citation does not support `/summary` stressful-life-event/depression claims or `/variants/0/interpretations/CC`, `/CT`, `/TT` mood/resilience conclusions. The memory report’s `/summary` and all secretion wording need the experiment/population distinction; `/CT` genotype frequency and assertion that sleep/exercise/education matter much more, and `/TT` above-average-person frequency, are not established here.

Unresolved: full sample and genotype subgroup estimates, strand mapping, independent studies for actual mood outcomes and replication. The memory finding can remain useful with measured-outcome limits. The mood content requires different direct evidence or substantive correction, not simply an access-date stamp.

## 14 — pmid:12595690

Publication: Kim et al., *Positional cloning of the human quantitative trait locus underlying taste sensitivity to phenylthiocarbamide* (2003). [PMID 12595690](https://pubmed.ncbi.nlm.nih.gov/12595690/); DOI `10.1126/science.1080190`. Full published paper read 2026-09-06: [institution-hosted PDF](https://www.bioutils.ch/ckeditor_assets/attachments/960/Amer_cloning_science2003.pdf), pages 1221–1223, Tables 1–3.

> The haplotype association with taster status was more definitive than for individual SNPs

Reports: `basic-traits.json` → `bitter-taste-tas2r38`; `gastrointestinal.json` → `bitter-taste-tas2r38-rs713598`.

Supports PTC threshold and three-position pattern associations; the reviewed two-position summary and rs1726866 interpretations preserve that distinction. Table 2 also supports association at Ala49, but shows tasters among Ala49 homozygotes; AAV is a counterexample to treating Ala49 as the whole AVI pattern.

Correct both reports’ `/variants/0/interpretations/CC`, `/CG`, `/GG` where site identity becomes full taster form, certainty of sensation, or vegetable bitterness. The gastrointestinal `/summary` conflates test compounds with chemicals in vegetables and adds intake findings not measured here. Basic-report vegetable claims likewise need another directly applicable source. The source uses coding-strand letters in Table 1, so direct copying would reverse the current genomic-forward labels.

Unresolved: complete forward mapping receipt and separate PROP/food evidence. Keep a qualified marker association, not a food-preference prediction.

## 15 — pmid:12648968

Publication: Rey et al., *Thrombophilic disorders and fetal loss: a meta-analysis* (2003). [PMID 12648968](https://pubmed.ncbi.nlm.nih.gov/12648968/); DOI `10.1016/S0140-6736(03)12771-7`. Author abstract read. This is a meta-analysis of 31 studies, not a new individual-level primary experiment; source type must remain accurate.

> varies, according to type of fetal loss and type of thrombophilia

Report: `reproductive-family.json` → `pregnancy-thrombosis-factor-v-leiden`.

Supports a fetal-loss association differentiated by early/late and recurrent/non-recurrent outcomes. `/summary` and `/variants/0/interpretations/CT` compress those distinct outcomes into one moderate shift and need the outcome qualification.

Not established by this source: pregnancy/postpartum venous-clot estimates, heterozygote/homozygote frequency, estrogen interaction, most-carriers-never-affected penetrance, or clinical confirmation/advice statements in `/summary` and `/variants/0/interpretations/CT`, `/TT`. Those require applicable primary cohorts or current guidance; the companion discovery citation alone does not settle them.

Unresolved: underlying study heterogeneity and confounding, genotype-specific pregnancy VTE evidence, modern forward mapping, current clinical sources. Do not represent pooled odds of fetal loss as an absolute personal probability or as the same outcome as thrombosis.

## 16 — pmid:12692541

Publication: Lindesmith et al., *Human susceptibility and resistance to Norwalk virus infection* (2003). [PMID 12692541](https://pubmed.ncbi.nlm.nih.gov/12692541/); DOI `10.1038/nm860`. Author abstract read.

> none of these individuals developed an infection after challenge, regardless of dose

Report: `gastrointestinal.json` → `norovirus-secretor-fut2-rs601338`.

Supports a specific human Norwalk challenge observation: non-secretors did not become infected, while some functional-FUT2 participants also resisted infection. This is evidence for a strain/experiment-specific association, not blanket stomach-bug immunity.

Unsupported by this sole citation: `/summary` and `/variants/0/interpretations/AA` extend to outbreak studies and many GII.4 strains; `/GG` adds microbiome/B12; `/AA` adds B12/Crohn’s; `/AG` equates common-strain risk with GG. The abstract does not independently identify rs601338, establish all secretor alleles, or report the template’s 20%-European frequency. `/AA` near-complete genetic protection must remain tied to the actual studied challenge, not the unreviewed extensions.

Unresolved: full-paper variant/genotype table, strain-specific evidence for each extension and direct biochemical/disease studies. Preserve the interesting observed challenge result with its exact scope.

## 17 — pmid:12724780

Publication: Ueda et al., *Association of the T-cell regulatory gene CTLA4 with susceptibility to autoimmune disease* (2003). [PMID 12724780](https://pubmed.ncbi.nlm.nih.gov/12724780/); DOI `10.1038/nature01621`. Author abstract read.

> candidates for primary determinants of risk

Report: `autoimmune.json` → `autoimmune-thyroid-ctla4`.

Supports autoimmune association mapping to a noncoding CTLA4 region and correlation with soluble-transcript levels. Candidate regional variation and correlated expression are not proof that this individual marker is causal.

Not verified from this abstract: `/summary` exact CT60 G-risk assignment, per-copy model, replication and relative strength across Graves’, hypothyroidism and type 1 diabetes; `/variants/0/interpretations/AA`, `/AG`, `/GG` ordered genotype effect sizes and population prevalence. The current small-versus-moderate adjectives are not traceable to an abstract genotype table.

Required checks: full-paper CT60 table/strand, populations and effect-model comparisons, independent replication sources, and separation of mechanistic correlation from causation. Preserve a qualified regional susceptibility result only after matching the marker and alleles; do not certify the personal genotype wording from the title or pathway plausibility.

## 18 — pmid:12825092

Publication: Alsene et al., *Association between A2a receptor gene polymorphisms and caffeine-induced anxiety* (2003). [PMID 12825092](https://pubmed.ncbi.nlm.nih.gov/12825092/); DOI `10.1038/sj.npp.1300232`. Author abstract read. Publisher page resolved initially but subsequent content fetch failed; no full-paper review claimed.

> reported greater increases in anxiety after caffeine administration than the other genotypic groups

Report: `brain-health.json` → `caffeine-sleep-adora2a-rs5751876`.

Supports greater self-reported anxiety in 1976T/T participants among 94 healthy infrequent caffeine users after 150 mg caffeine versus placebo, with a linked second marker. This is an acute anxiety endpoint.

Not supported by this paper: `/summary` and all three `/variants/0/interpretations` sleep-direction claims; `/CT` assumes an intermediate group although the abstract compares TT against other groups, not an additive ordering; `/TT` late-caffeine response and all metabolism-speed modifiers require other evidence. The second citation, PMID 17329997, needs direct review before declaring the same allele direction for sleep as anxiety. This receipt does not resolve that direction.

Unresolved: full genotype tables, forward rsID/build mapping, sleep comparator and independent replication. Keep the acute anxiety result separate from sleep instead of using the report title to connect them.

## 19 — pmid:12843179

Publication: Bonafè et al., *Polymorphic variants of insulin-like growth factor I (IGF-I) receptor and phosphoinositide 3-kinase genes affect IGF-I plasma levels and human longevity: cues for an evolutionarily conserved mechanism of life span control* (2003). [PMID 12843179](https://pubmed.ncbi.nlm.nih.gov/12843179/); DOI `10.1210/jc.2002-021810`. Author abstract read.

> subjects carrying at least an A allele at IGF-IR have low levels of free plasma IGF-I

Report: `longevity.json` → `longevity-igf1r-rs2229765`.

Supports the carrier-level association with lower **free** plasma IGF-I and representation among long-lived people, including interactions with another gene. It is not a demonstrated effect on total circulating IGF-I or a causal extension of lifespan.

Qualify `/summary` and `/variants/0/interpretations/AA`, `/AG`, `/GG` to identify free IGF-I. `/AA` separately asserts a homozygous result although the abstract pools carriers; verify that subgroup. `/summary` Italian population/sample size and worm/fly/mouse claims are not all established by this abstract; `/AG` predicts the likely size of a lifespan effect without a measured estimate.

Unresolved: cohort size/selection, genotype subgroup tables, codon-1013-to-rs2229765 forward mapping, prospective survival versus long-lived enrichment and independent replication. Keep the early carrier association without inventing a personal longevity effect.

## Completion boundary

Twenty citation keys inspected; 22 distinct associated report objects read. Six publications had relevant full-paper portions read (cilantro, CYP1A2, COMT, KLOTHO, FAAH, TAS2R38); thirteen other records had author abstracts read; ACTN3 had only a resolved record without abstract. This is review coverage, not approval coverage. Several statements have concrete mismatches; others remain unverified due to source granularity. No new source dates were written to templates, no confidence levels upgraded, and no published conclusions changed.
