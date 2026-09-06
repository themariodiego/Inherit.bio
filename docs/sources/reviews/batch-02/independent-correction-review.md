# Independent correction review: BDNF, COMT, FAAH

Agent review on **2026-09-06**, not clinical or publication signoff. No report templates were edited. This supplements, rather than replaces, batch 01's receipts. No new verbatim excerpts are included, preserving the existing per-publication quotation allocation. Initial suggestions followed the existing genotype labels; the final addendum below subsequently verifies their exact forward-allele mappings against current primary annotation responses.

## Read evidence

- Complete primary publication abstracts for [Egan BDNF, PMID 12553913](https://pubmed.ncbi.nlm.nih.gov/12553913/), [Egan COMT, PMID 11381111](https://pubmed.ncbi.nlm.nih.gov/11381111/), [Stein COMT, PMID 15956988](https://pubmed.ncbi.nlm.nih.gov/15956988/), and [Sipe FAAH, PMID 12060782](https://pubmed.ncbi.nlm.nih.gov/12060782/) independently read via NCBI efetch, HTTP 200, at **2026-09-06T01:03:05.173Z**. Stein's full genotype table was not accessible, so its effect direction is not inferred from the old template.
- [Sipe FAAH full primary paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC123078/): research-subject methods, Tables 2–3, functional Results, and Discussion read from the official PMC indexed response on 2026-09-06. A separate NCBI PMC efetch at 01:04:29.936Z returned its abstract, not proof of a second complete full-text retrieval.
- [Hosang 2014, PMID 24433458, publisher full paper](https://link.springer.com/article/10.1186/1741-7015-12-7): Results, Discussion, and Limitations read on 2026-09-06. This is a published meta-analysis, not a new participant experiment.
- [Zhao synthesis, PMID 29102837](https://pubmed.ncbi.nlm.nih.gov/29102837/): complete abstract read from the primary publication record on 2026-09-06; not full text.
- [Border 2019, PMID 30845820, full primary paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC6548317/): abstract, Methods, polymorphism-level Results, BDNF row in Table 2, and Discussion read from the official PMC indexed response on 2026-09-06. Later direct-open requests returned a challenge page; this does not negate the earlier readable response or justify claiming additional material was read.

## BDNF: retain the experimental distinction; do not rank resilience

Targets: `brain-health.json` → `memory-plasticity-bdnf-rs6265`; `mental-health.json` → `mood-stress-resilience-bdnf-rs6265`.

Egan separates human memory/imaging associations from secretion measured in transfected neurons. Activity-induced secretion differed in that cell experiment; constitutive secretion did not. It does not establish someone's brain BDNF level or a mood outcome. Preserve that distinction in summary and every genotype interpretation.

Hosang pooled 22 studies/14,233 participants using a Met-dominant model: CT and TT belong to the same carrier group. Life-event findings were stronger than childhood-adversity findings, whose pooled P value was .051. Combining P values did not supply a pooled effect magnitude. Zhao's 31-study/21,060-participant synthesis also reports that interaction strength could not be estimated. Neither supports describing TT as a stronger or quantitatively larger mood response than CT.

Border directly examined rs6265 in preregistered large-sample analyses, not merely the gene region. Its BDNF main and interaction findings did not meet the study's corrected criteria. This is substantial counterevidence against presenting the older candidate-gene signal as an established personal mood or stress effect. The result does not erase the separate cell experiment or human memory experiment.

Scientifically defensible distinctions:

- **CC:** two Val copies; this was the non-Met comparison group in older interaction research, not a demonstrated resilient or low-depression-risk group.
- **CT:** one Met copy; older studies often combined this with TT. They do not provide a separate middle mood/stress score.
- **TT:** two Met copies; membership in that older carrier group does not establish a larger effect than CT.

For all three, a mood report may explain the historical hypothesis and later nonconfirmation, but should say the evidence does not establish a personal mood/resilience estimate. If the report remains, add the directly relevant synthesis and larger counterstudy rather than citing the cell/memory paper alone. Do not convert inconsistent evidence into a claim that the true individual effect is known to be small. No recommendation about deletion, consolidation, or publication is made here.

## COMT: molecular forms and specific task findings, not acute-stress ranking

Targets: `brain-health.json` → `executive-function-comt-rs4680`; `mental-health.json` → `stress-anxiety-comt-rs4680`.

Egan supports a Met-dose association with fewer perseverative errors on the Wisconsin Card Sorting Test, explaining 4% of variance in the studied sample: 175 patients with schizophrenia, 219 unaffected siblings, and 55 controls. Its working-memory experiment measured fMRI physiology in small subgroups. Those are not general planning/working-memory performance scores in an unselected healthy population. The source describes the lower-activity Met form, not each reader's measured dopamine concentration.

Stein studied 497 undergraduates using personality-inventory traits, with associations limited to women and stronger for extraversion than neuroticism. It warns that rs4680 alone does not explain the COMT association. The abstract does not establish genotype direction or an additive anxiety gradient. Sudden-stress steadiness and pain are not established endpoints of either cited study.

Scientifically defensible distinctions:

- **GG:** two Val copies, the higher-activity molecular form; the zero-Met group in Egan's specific task comparison.
- **AG:** one Val and one Met; the one-Met-dose group, not a proven intermediate anxiety or stress-response group.
- **AA:** two Met copies, the lower-activity molecular form; Egan associated higher Met dose with fewer errors on that particular task, not a general intellectual or emotional advantage.

Retain those study-specific functional/task facts with population context. Remove unsupported acute-stress/pain wording. Anxiety direction should remain unassigned until the actual applicable genotype table or another direct primary source is read; adding a disclaimer to an unverified AA/AG/GG anxiety ranking is insufficient. Border's depression outcome is not a substitute for directly replicating Stein's extraversion endpoint.

## FAAH: protease susceptibility and observed AA association

Target: `addiction.json` → `problem-substance-use-faah-rs324420`.

The protein experiments support protease susceptibility, not globally reduced stability or catalytic rate. In-vivo levels remained unresolved. Table 2 supports questionnaire-defined problem drug/alcohol association; street-use-only significance did not survive multiple-comparison correction. Keep endpoints distinct.

- **CC:** two Pro copies; comparison genotype, not proof of normal signaling or absent substance-use risk.
- **AC:** one Thr copy; not overrepresented in the reported problem-use group, not proven protective or intermediate-risk.
- **AA:** two Thr copies; enriched in that group, not a diagnostic prediction.

Use precise experimental protease-breakdown wording. Remove uncited later stress/cannabis, human anandamide, and replication claims unless additional reviewed evidence supports them. Do not infer a personal tendency from the assay or the early association.

## Final current-object review

Read the complete current diff of the three report objects on 2026-09-06. Verdict terms refer only to this **agent scientific-content review**, not human signoff, clinical validation, source licensing approval, runtime verification, or publication authority. Earlier recommendations above describe the pre-correction text; the verdicts below assess the revised objects.

### Exact allele binding

Fresh HTTP 200 responses from official Ensembl VEP were read at the timestamps below. These establish the displayed site/form mapping, not enzyme quantity or a personal trait. Protein numbering is transcript-specific; representative returned transcripts matching the named forms are recorded rather than claiming every isoform uses that numbering.

| Template site | Actual response read (UTC) | Verified GRCh38 placement and forward alleles | Matching returned transcript |
| --- | --- | --- | --- |
| [BDNF rs6265](https://rest.ensembl.org/vep/human/id/rs6265?content-type=application/json) | 2026-09-06T01:11:47.852Z | chr11:27658369 C/T; T changes Val to Met on the negative-strand gene | ENST00000356660, residue 66 |
| [COMT rs4680](https://rest.ensembl.org/vep/human/id/rs4680?content-type=application/json) | 2026-09-06T01:11:48.547Z | chr22:19963748 G/A; A changes Val to Met on the positive-strand gene | ENST00000207636, residue 158; ENST00000449653 also returns residue 108 |
| [FAAH rs324420](https://rest.ensembl.org/vep/human/id/rs324420?content-type=application/json) | 2026-09-06T01:11:49.243Z | chr1:46405089 C/A; A changes Pro to Thr on the positive-strand gene | ENST00000243167, residue 129 |

All nine displayed genotype-to-form mappings agree with those responses. No phase, full-gene state, or clinical effect is inferred.

### Verdicts and exact pointers

Selectors below identify the complete current objects and fields, with stable slugs plus citation identifiers.

| Object and exact field selector | Verdict | Reason |
| --- | --- | --- |
| `data/templates/mental-health.json` → `stress-anxiety-comt-rs4680` → `title`, `summary` | approved | Describes molecular activity and the measured female personality association without assigning an unverified anxiety allele or stress advantage. |
| Same object → `variants[rsid=4680].interpretations.GG`, `.AG`, `.AA` | approved | Correct form mapping, higher/lower activity distinguished from personal dopamine concentration; no anxiety interpolation. |
| Same object → `citations[pmid=11381111].studyContext.{measured,population,comparison,limitation}` | approved | Task, main-sample counts, smaller scan groups, and Met-dose error result match the abstract; limitations retain the actual endpoints. |
| Same object → `citations[pmid=15956988].studyContext.{measured,population,comparison,limitation}` | approved | Correct sample, personality measures, female-specific association, multi-site/haplotype analysis and interpretive boundary. No unavailable full-table direction asserted. |
| `data/templates/mental-health.json` → `mood-stress-resilience-bdnf-rs6265` → `title`, `summary` | approved | Historical association is balanced by larger later nonconfirmation, not promoted to a personal resilience estimate. |
| Same object → `variants[rsid=6265].interpretations.CC`, `.CT`, `.TT` | approved | Correct form mapping; comparator versus pooled carriers preserved; no TT-over-CT gradient, reassurance, or individual risk score. |
| Same object → `citations[pmid=12553913].studyContext.{measured,population,comparison,limitation}` | approved | Human versus cell endpoints and stimulated versus constitutive release remain separate. Unestablished population detail is null rather than invented. |
| Same object → `citations[pmid=24433458].studyContext.{measured,population,comparison,limitation}` | approved | Correct synthesis size, broad ancestry description, pooled-carrier model, stressor distinction, and lack of personal-effect magnitude. |
| Same object → `citations[pmid=30845820].studyContext.{measured,population,comparison,limitation}.text` | approved | Preregistered design, subsample range, actual rs6265 test, correction for multiple comparisons, and non-universal inference limit are supported. |
| Same object → `citations[pmid=30845820].studyContext.comparison.locator` | approved after revision | The initial Table 1 pointer was incorrect. The author changed it to Table 2; the current locator was re-read and matches the rs6265 result. No associated body claim needed alteration. |
| `data/templates/addiction.json` → `problem-substance-use-faah-rs324420` → `title`, `summary` | approved | Uses the combined problem drug/alcohol endpoint and precise experimental protease susceptibility, not standalone street-use significance or inferred human signaling. |
| Same object → `variants[rsid=324420].interpretations.CC`, `.AC`, `.AA` | approved | Correct forms; observed comparison, non-overrepresentation, and enrichment stay distinct; no half-dose risk or causal/behavior prediction. |
| Same object → `citations[pmid=12060782].studyContext.{measured,population,comparison,limitation}` | approved | Survey and lab endpoints, selected study population, genotype comparison and confounding limits are supported. |
| All three objects → reviewed `citations[*].accessedOn` values | approved | 2026-09-06 is an actual read date for these cited sources, not a date inferred from metadata or copied solely to pass validation. |

Residual **unresolved**, not asserted by the revised text: personal trait calibration; effect size of the older BDNF interaction; a separate TT-versus-CT mood effect; Stein's genotype-specific anxiety direction; in-vivo FAAH signaling levels. The revised objects appropriately avoid those claims. Existing evidence-tier policy, gates, result binding and rendering are outside this scientific reread; tests are owned by the parent agent.

No substantive scientific-content blocker found. The single source-locator revision was completed by the author and independently re-read. Final agent verdict: **approved for this scoped scientific-content review**, with the unresolved boundaries above, not human or clinical signoff. No report template was modified by this reviewer.

Exact reviewed object receipts: SHA-256 of `JSON.stringify(parsedTemplateObject)`, without whitespace, after the locator correction:

- `stress-anxiety-comt-rs4680`: `1cc7d055d21a9e9520e9892f133d8f9c19fbe0cd3f20e03e17e11c12efe3490a`
- `mood-stress-resilience-bdnf-rs6265`: `f005cd05fb0f576f35b3cbd1858db24cc185befef3ad5d62b8d979e7f3ad5638`
- `problem-substance-use-faah-rs324420`: `debc18bc119dfc8a2a10ac6046f61250ca24bc540556d0aeb1b1d858e5b56abf`
