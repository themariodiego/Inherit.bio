# Personal report previews

The report library now shows a short personal takeaway on four existing
trait cards when the user's own file supplies a matching call. These cards
come first within their existing category so the first-page card limit does
not hide them. Other card order, titles, categories and finding layers stay
unchanged. This is a reading aid, not a health ranking.

The **With results** filter includes every report with an interpreted call,
not just these four. Missing, no-call, unrecognized and conflicting calls
are not results. The existing sensitive-report reveal behavior is unchanged;
sensitive cards receive no personal interpretation or preview in client props.

## Four reviewed associations

`src/copy/reports/personal-previews.ts` records each source identifier,
source-read date and paper location alongside the reviewed genotype mapping.
Only the selected statement and its short qualifier leave the server.

| Trait | Primary source | What the preview says and does not say |
| --- | --- | --- |
| Earwax, rs17822931 | [Yoshiura 2006, PMID 16444273](https://pubmed.ncbi.nlm.nih.gov/16444273/), abstract | Wet/dry type association; no inferred odor intensity. |
| Lactase, rs4988235 | [Enattah 2002, PMID 11788828](https://pubmed.ncbi.nlm.nih.gov/11788828/), abstract | Adult enzyme activity association with the European-population qualifier; no symptom prediction or food advice. The linked position is not a second independent finding. |
| Bitter taste, rs1726866 | [Kim 2003, PMID 12595690](https://pubmed.ncbi.nlm.nih.gov/12595690/), page 1223, Tables 2 and 3 | The form found in the associated pattern; no full-pattern, phase or food-preference inference. The forward-allele mapping and primary-source trace are in `study-context-pilot.md`. |
| Alcohol flush, rs671 | [Rwere 2024, PMID 39075523](https://pubmed.ncbi.nlm.nih.gov/39075523/), Figure 3; [Enomoto 1991, PMID 2024727](https://pubmed.ncbi.nlm.nih.gov/2024727/), abstract | Alcohol by-product clearance, not overall tolerance or intake advice. Both citations must remain present. The AA support is separate from the newer AG/GG comparison; see `metabolism-report-context.md`. |

These original paraphrases use the primary sources read on 2026-09-05.
The source-backed study context remains on the linked full report. Evidence
labels and the six full-report headings are unchanged. This does not validate
all older interpretation text in the catalog or add a score/risk model.

## Personal-data boundary

The existing route must resolve the signed-in account first. The preview
loader additionally requires the account's own `self` subject, matching owner,
and no Family handle. It queries only that account/subject's annotated files
with a known supported source build. The ingest pipeline stores their calls
in canonical GRCh38 coordinates, including lifted GRCh37 inputs.

A preview requires the reviewed slug, rsID, chromosome, position and template
REF/ALT, the cited primary identifier, and a forward diploid genotype supported
by both the preview map and current template. Recorded call REF/ALT must agree;
array calls can lack those alleles. There is no strand guessing. Conflicts win,
and any mismatch or missing call withholds the preview, not the library.
The source database does not track assay-versus-imputation provenance, so copy
says what the file shows and does not claim a clinically verified measurement.
Explicit VCF 0/0 reference calls are stored separately and are not yet read by
this loader. An observed homozygous call in an array file is supported; missing
VCF variant rows are never treated as observed reference genotypes.

## Verification

Unit tests cover all twelve mapped calls, wrong loci/alleles, absent and invalid
calls, conflicts, source/template drift, self-account scope, query scoping and
unavailable data. Production-browser tests upload a synthetic GRCh38 file,
read four takeaways without a new gate, filter/search real interpreted results,
open the linked six-heading source-backed reports, check narrow-screen wrapping,
reject a wrong-coordinate rsID, and prove a second empty account receives no
personal preview in rendered HTML or the serialized server response.

No schema, hosted data, endpoint, permission or catalog-wide review is added.

The original three-preview slice was verified locally on 2026-09-05: 1,532 unit tests, 28 final targeted tests,
typecheck, targeted lint and readability. Eight production-browser tests pass:
the two new workflows, five unchanged sensitive-gate regressions and the pilot
source-context test with its corrected no-genotype selector. A separate
browser check confirmed the final desktop and narrow-screen takeaways and
filter, with no page errors. The local `sequence` stack was used without a
reset, with fresh synthetic users/files only. No hosted seed was run.
