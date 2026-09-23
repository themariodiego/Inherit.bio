# ALDH2 addiction-report correction

Applies only to `alcohol-dependence-aldh2-rs671` in
`data/templates/addiction.json`. Sources read on 23 September 2026.
This is agent source-content review, not clinical or human signoff.

## Defect and scope

The old AG and AA explanations grouped little drinking with no drinking and
said the risk did not apply. The AA explanation also assigned the highest
cancer risk, without a measured AA-versus-AG cancer comparison. The GG text
treated a single position as proof of normal enzyme function and no genetic
flushing. The report title framed the result as protection.

The correction removes those claims. It keeps the exact rs671 position,
genotype resolver, category, evidence tier and access rules. The current file
letters remain observations; the study results remain group findings. No
personal cancer probability, dependence prediction, safe intake or treatment
advice is added. The separate gastrointestinal ALDH2 report is unchanged.

## Sources actually read

| Source | Actual access scope | Supports and limits |
| --- | --- | --- |
| [Brooks 2009, PMID 19320537](https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.1000050) | Full publisher article, especially the genetics primer, exposure-related cancer discussion and social/cultural drinking discussion. This is a research review, not a primary cohort. | Enzyme mechanism, flushing and exposure-dependent drinking patterns. It distinguishes non-drinkers from drinking groups and describes heterozygotes as the group with greatest observed alcohol-related esophageal cancer risk. It does not establish the old AA ranking or a personal prediction. |
| [Rwere 2024, PMID 39075523](https://doi.org/10.1186/s12967-024-05507-x) | Full article XML: recruitment/selection methods, human results, Figure 2/3 text and limitations. No rendered-figure visual inspection is claimed. | Eight AG and eight matched GG volunteers; AA excluded. Recruitment sought people reporting flushing. Other ALDH2 variants also affected the response. This supports the limits of a single rs671 reading; it does not measure dependence or cancer incidence. |
| [Yokoyama 2002, PMID 12419833](https://pubmed.ncbi.nlm.nih.gov/12419833/) | Complete author abstract from the official Europe PMC record; no full-paper access is claimed. | 234 Japanese male cases and 634 controls. The heterozygote comparison includes the study's light-drinking group. It does not establish an AA comparison, an absolute individual risk or a safe drinking threshold. |
| [Enomoto 1991, PMID 2024727](https://pubmed.ncbi.nlm.nih.gov/2024727/) | Author abstract from the official Europe PMC record, explicitly truncated at 250 words. No full-paper or complete demographic review is claimed. | No measurable liver ALDH2 activity in two mutant-homozygote samples and higher blood acetaldehyde after alcohol than in the reference-homozygote group. It measures metabolism, not cancer risk or general symptom severity. |

The two abstract records were retrieved using the Europe PMC search API with
the exact PMID, `SRC:MED` and `resultType=core`. The full Rwere article was read
from the [official XML](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11288122/fullTextXML).
The Brooks review is retained as a review source rather than relabelled a
primary experiment. The revised AG cancer sentence rests on Yokoyama's actual
primary abstract. Neither the low-drinking association nor absence of an AA
comparison is converted into a universal risk ranking.

## Exact statement bindings

- Summary: Brooks for enzyme/flushing and drinking context; Rwere for the
  response study and its limits. The final sentence defines what this report
  cannot infer, not what health outcomes are impossible.
- GG: Rwere for the distinction between this common position and other
  ALDH2 changes. Absence of A does not prove whole-gene function or symptoms.
- AG: Yokoyama for the bounded Japanese male cancer association; Rwere for
  acetaldehyde clearance in its selected AG/GG comparison.
- AA: Enomoto for the two liver samples and blood measurement. That study
  supplies no AA-versus-AG cancer result.

The four strings are canonical claims. Source access dates are actual reads;
older source-review dates elsewhere are left intact. New short snippets use
the same publication-level quotation budget as earlier receipts. In
particular, Yokoyama's new two-word snippet leaves room for the existing
15-word population excerpt in the batch-01 review.

Independent review re-read the relevant source passages and also checked
[NCBI's rs671 mapping record](https://www.ncbi.nlm.nih.gov/snp/rs671) and
[ClinVar's HGVS mapping](https://www.ncbi.nlm.nih.gov/clinvar/variation/18390/):
GRCh38 12:111803962 G>A, Glu504Lys, also called ALDH2*2. These mapping records
are not used as cancer evidence. The variant identity is unchanged.

## Validation boundary

Focused tests pin the precise genotype/result distinction, reject the old
reassurance and cancer ranking, validate exact canonical claim/source edges,
and render the actual report components. They also refuse citation borrowing
after text, genotype or position changes. This is bounded regression evidence,
not clinical validation, a hosted template update or a complete rendered
export/email corpus.

G1.11 and G4.7 stay NO: this is one corrected report and four statements.
Other catalog and surface claims remain unreviewed. Hosted publication and
combined CI validation are separate from this source correction.
