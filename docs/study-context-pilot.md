# Study context pilot

Three existing adult reports have original, brief primary-paper summaries.
This is explanatory depth for those reports, not a broader catalog, new
personal result, evidence upgrade or validated risk model. No bulk content
was imported. The source identifiers and read dates travel with each context
inside the existing citation JSON. Each field names its paper location.

All sources below were read on 2026-09-05. These are factual paraphrases;
no reuse licence for publisher prose, figures or tables is asserted.

| Report / primary source | Claim-level source trail | Editorial scope boundary |
| --- | --- | --- |
| `earwax-type-abcc11`, [PMID 16444273](https://pubmed.ncbi.nlm.nih.gov/16444273/), [DOI 10.1038/ng1733](https://doi.org/10.1038/ng1733) | Abstract: earwax association, cell activity and rare deletion. Figure 5: cell assay. Supplementary Table 1 description: 118 and 126 Japanese participants, self-report in the first stage and ear examination in the second. | Cell transport is not an individual's odor measurement. The common position is not the whole gene. |
| `bitter-taste-tas2r38`, [PMID 12595690](https://pubmed.ncbi.nlm.nih.gov/12595690/), [DOI 10.1126/science.1080190](https://doi.org/10.1126/science.1080190) | Pages 1221–1223: blind PTC test, Utah and NIH samples, European and East Asian groups. Page 1223 and Table 3: three-position patterns and group taste scores. | PTC sensitivity is not food choice. This two-position report does not establish the full three-position pattern or phase. |
| `lactase-persistence-lct-rs4988235`, [PMID 11788828](https://pubmed.ncbi.nlm.nih.gov/11788828/) | Abstract: enzyme activity, nine Finnish families, 236-person association sample from four populations, linked marker agreement in 229 cases. | Enzyme activity is not meal symptoms. Linked markers are not independent confirmations. Sample coverage is not universal population validation. |

The displayed scope boundaries are Inherit's interpretation of what the
measured outcome and study design can establish, not extra experimental results.
One pre-existing reversed taste association was corrected, not strengthened.
The [Ensembl VEP primary annotation](https://rest.ensembl.org/vep/human/id/rs1726866?content-type=application/json)
read on 2026-09-05 maps GRCh38 chr7:141972905 G/A on the forward strand to
TAS2R38 transcript ENST00000547270 on the negative strand: ALT A changes
Ala to Val at residue 262 (`gCt/gTt`). Forward G therefore encodes Ala262;
forward A encodes Val262. Kim 2003 Table 2 associates Val262 with non-taster
status; the PAV pattern has Ala262. The old text had the association reversed
despite correctly naming the amino acids. The three position-specific strings
now state the source-backed pattern association without claiming complete
patterns or a personal taste score. The summary no longer claims that two
positions establish a three-position pattern or an unsupported population rate.
Other existing template interpretations still require their own scientific review;
adding context is not validation of those separate claims.

## Storage and display

`study-context.ts` validates and projects the four fields. The seed gate and
writer share that validation. Explicit null means not recorded; an absent or
malformed object produces no context panel. `CitationItem` reuses the existing
source identifier and source-read date display. No route, permission, reveal
gate, personalized resolver, database grant or top-level heading changes.

## Verification

Tests cover exactly three ungated pilot reports, unchanged evidence labels,
seed JSON round trips, source-bound rendering, explicit unknowns, legacy
citations, malformed objects and missing source metadata. Their original prose
is included in template language checks and the sentence cap is tested.

Local verification passed: 1,376 unit tests, 32 targeted assertions after the
final edits, all 162 template validations, typecheck, lint, readability, name
and secret gates. One production-browser test visits all three pilot reports
against the local `sequence` database (API 54321, database 54322). It proves
stored source facts and identifiers render under the six unchanged headings,
without genotype figures for the account with no upload. No hosted seed or
schema change was made; publishing the code alone does not update hosted
template data. The seed writer preserves the added citation JSON on rollout.
