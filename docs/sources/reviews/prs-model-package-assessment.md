# Adult CAD model-package assessment

Independent agent research, accessed **2026-09-06**. This is a bounded review of two candidate model packages, not an exhaustive impossibility claim, human clinical approval, publication authorization, or acceptance of a statistical-report gate. No user genomes were read, no authors contacted, and no product or hosted data changed. Source descriptions below are original paraphrases; source files remain outside the repository.

## Current implementation and required result

Code inspection revision: `8cbece97a1a9a66fbc4953eafc60c180889b2677` in the renderer integration worktree. The three committed scores are PGS000011 (GRS50, CAD, 50 positions), PGS000115 (LDL-C_20, 223 positions), and PGS004602 (PRS424_T2D, 424 positions). None of the 162 report templates at that revision has a non-null `pgs_id`.

`src/lib/genome/prs.ts` produces a weighted sum and an analytic independent-variant frequency approximation, not a measured reference-panel percentile or calibrated disease risk. Its palindrome exclusion leaves at most 44/50, 208/223, and 369/424 score positions respectively, even with otherwise complete input. The process route's score input uses normalized variant records, not the newer report-only observed-reference/QC projection; duplicate positions become last-write-wins. These are code/data-policy gaps to resolve, not reasons to infer missing calls. `scripts/seed.ts` provides weights/basic metadata, not a fitted absolute-risk package. Public chat/export serialization deliberately exposes coverage only; that is not delivery of the requested quantitative result.

The brief's §§2.2–2.7, §§3.2–3.4 and X16.4 require an applicable baseline and model, age/sex/ancestry matching, ancestry-specific liability-scale performance with uncertainty, named reference-panel context, coverage-aware intervals, and condition-specific rare-variant suppression. Below 80% coverage quantities are withheld; 80–95% requires widened uncertainty. A percentile cannot substitute for the required absolute-risk result and interval. The existing combined-sex/lifetime risk registry fields do not supply a general adult age/sex-specific fitted predictor or its covariance. Training/calibration on user genomes is prohibited by the brief. These requirements remain unchanged.

## Candidate 1: the existing CAD50 score

Primary publication: Tada et al., *Risk prediction by genetic risk scores for coronary heart disease is independent of self-reported family history*, PMID **26392438**, DOI **10.1093/eurheartj/ehv462**; published online 2015, journal volume 2016. [Primary article](https://pmc.ncbi.nlm.nih.gov/articles/PMC4744619/), [official full-text XML](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4744619/fullTextXML), [official supplementary-file archive](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC4744619/supplementaryFiles). Article and supplementary DOCX methods/tables were actually read.

**Supplies:** 50-position weights, genotyped proxies and alleles (supplement Table 1); score construction and study scaling (GRS50 mean 3.82, SD 0.43); endpoint definitions; a 23,595-person Swedish Malmö cohort; adjustment-variable definitions; grouped outcomes and discrimination/reclassification evaluations. The CHD endpoint includes coronary revascularization, myocardial infarction and ischemic death. The ten-year risk analysis used a fitted Cox model, not a score-only lookup. The study scaling describes this cohort/full score, not a validated partial-score reference panel.

**Actual clinical inputs:** age, sex, systolic blood pressure, antihypertensive treatment, current smoking, apolipoprotein A-I, apolipoprotein B, prevalent diabetes, and GRS50; an expanded model also uses parental/sibling myocardial-infarction history. Additional analyses include age interactions. Age/sex/family history alone therefore cannot reproduce the reported clinical model.

**Prospective missingness issue:** participants with more than ten missing genotypes were excluded. Remaining missing genotypes were randomly sampled from observed genotype frequencies separately for participants who did and did not develop CHD. That outcome-conditioned research procedure cannot be applied to a new person's unknown future outcome. Fully observed inputs avoid that particular issue, but do not supply the missing fitted risk model. A deployment package needs a prospectively usable missingness policy with validation.

**Not located in the checked article/supplement:** the complete fitted clinical coefficient vector and covariance, baseline survival/cumulative hazard, executable fitted predictor, individual uncertainty procedure, or the brief's ancestry-specific liability-scale performance/calibration package. Supplement Table 6 gives broad age/score-group event rates per person-time, not individual absolute probabilities. Grouped incidence, hazard ratios and cohort score scaling are not interchangeable with these missing artifacts.

## Candidate 2: an open CAD meta-prediction implementation

Chen et al., *Meta-prediction of coronary artery disease risk*, PMID **40240837**, DOI **10.1038/s41591-025-03648-0**, published 2025-04-16. [DOI record resolving to the publisher article and its supplementary materials](https://doi.org/10.1038/s41591-025-03648-0). The publisher's public abstract, extended figures and code availability were read, along with its supplementary-tables workbook **`41591_2025_3648_MOESM2_ESM.xlsx`**, retrieved from the official publisher media service. The version-of-record body is subscription-restricted and was **not** read. [2025-08-19 correction](https://doi.org/10.1038/s41591-025-03925-y) concerns an author name and figure-label formatting, not a replacement fitted model. The receipt below preserves the actual downloaded workbook's local path and hash; the DOI link is its parent publication record, not a direct workbook download.

Author repository: [CAD_meta_prediction](https://github.com/TorkamaniLab/CAD_meta_prediction), checked HEAD **`ff8293bfa11f6a11ea033eb77e87c89f1724ec4f`** ([pinned README](https://raw.githubusercontent.com/TorkamaniLab/CAD_meta_prediction/ff8293bfa11f6a11ea033eb77e87c89f1724ec4f/README.md)). Public recursive file inventory and training implementation were inspected. The checked executable example and `expected_output/final_pipeline__xgb_classifier__cardio.joblib` concern a demonstration cardiovascular dataset, not the paper's released fitted clinical predictor.

**Supplies:** a reusable training framework; primary reporting of ten-year incident CAD prediction developed in UK Biobank and externally evaluated in All of Us; feature descriptions and hyperparameters. Supplement Tables 15 and 24 describe nested genetic and measured clinical inputs; Tables 20 and 23 describe training settings. Published hyperparameters are not fitted trees or a calibration function.

**Not a PGS-only model:** the reported generalizable model includes clinical measurements/history. Its mapped inputs include age, sex, smoking history, systolic blood pressure, medications, lipids, HbA1c, creatinine, body measurements and family history. Extended Data Figure 2 also evaluates reduced models, including age/sex plus 12 scores, but does not release those models' fitted parameters and individual-risk calibration. Their existence does not establish that the full model's calibration transfers to a reduced input set.

**Not located in the checked release:** the paper-specific fitted preprocessing/meta-feature/final prediction objects, deployable calibration mapping, individual uncertainty package, or required liability-scale performance bundle. Access to research cohort data would not itself provide a ready-to-deploy validated model; retraining would be a separate research project.

## Receipt chain

Local receipts are operator-machine artifacts, not portable repository assets. SHA-256 values identify the bytes actually read; an archive regenerated by the source may differ in packaging. No copyrighted full paper/workbook is committed.

| Receipt | Local path | SHA-256 |
| --- | --- | --- |
| Official CAD50 supplementary archive | `/tmp/inherit-prs-model-review.uuMrYS/epmc-supplements.zip` | `e3131eb6ac57eee4d68ae27b87fc79bb2aff448ad767d658cd95b9be6bbdda05` |
| Extracted CAD50 methods and six tables | `/tmp/inherit-prs-model-review.uuMrYS/epmc/ehv462supp.docx` | `412e4766fd2fa05e8fe6acdf7510cf2ab4338d6d7a899c4e573bd98a9a82afce` |
| Chen supplementary tables | `/tmp/inherit-prs-model-review.uuMrYS/chen2025-tables.xlsx` | `da3fa909222bcee8e907cb47571652d8afb8d3b4e516bb78b25e86facbb628ed` |

The checked committed PGS000011 JSON has SHA-256 `62f0e3737dc2ee80018fb44ff05de80c3b092ab7e3e2e4c43a011d77ec29b41f`. The local copy is a weight input, not a model-calibration receipt.

## Recommended next dependency and exact artifact request

The most direct first request is to the CAD50 authors because the existing small score is already represented. This is a proposed request only, not external contact:

> Please provide the fitted established-risk-factor plus GRS50 model, coefficient covariance, exact centering/scaling and predictor coding, baseline survival or cumulative hazard, competing-risk specification, calibration/validation results, a prospectively usable missing-genotype policy, and permitted deployment terms. Please include synthetic input profiles with expected predictions and uncertainty calculations. Is there a separately validated age/sex plus GRS50 model? For either model, please identify target age, sex and ancestry applicability, reference-panel details, baseline-risk uncertainty, and available ancestry-specific liability-scale performance estimates with confidence intervals and sample sizes.

Alternatively request the Chen reduced age/sex-plus-12-score model's **own** fitted objects, preprocessing, calibration, uncertainty and validation, not merely the larger model's coefficients or headline performance.

A minimal optional clinical form is justified only by an obtained model's exact validated input contract. Do not fill missing laboratory/history values with guessed population means or call a clinical model PGS-only. An executable engine such as [iCARE](https://pmc.ncbi.nlm.nih.gov/articles/PMC7001949/) supplies methodology, not the disease-specific coefficients, incidence, reference covariate distribution and validation needed here.

After obtaining and independently reviewing a suitable package, build one complete adult CAD result: reproduce published/synthetic reference predictions and intervals; validate input allele/QC/missingness and array/VCF parity; test coverage boundaries and model applicability/suppression; and verify the same authorized risk contract across report, chat and export. Until then, further coverage-only helpers do not close the requested result milestone. This bounded search identifies a concrete artifact dependency, not proof that no suitable model exists elsewhere.
