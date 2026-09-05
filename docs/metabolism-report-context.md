# Two metabolism report corrections

This bounded follow-up adds one personal preview and corrects two existing
reports. The catalog count, evidence labels, gates, six headings and risk
publication rules are unchanged. No other report's prose is validated here.

## Source trail

All sources were read on 2026-09-05. The citation JSON contains original
paraphrases with exact paper locations; no publisher prose or figure is reused.

- Alcohol: [Rwere 2024, PMID 39075523](https://pubmed.ncbi.nlm.nih.gov/39075523/),
  [full primary paper](https://doi.org/10.1186/s12967-024-05507-x),
  Methods / Human alcohol challenge and Participant recruitment; Results /
  Human subjects studies; Figures 2–3. The personal AG comparison maps here.
- Alcohol: [Enomoto 1991, PMID 2024727](https://pubmed.ncbi.nlm.nih.gov/2024727/),
  [DOI](https://doi.org/10.1111/j.1530-0277.1991.tb00532.x), abstract methods
  and liver-activity/blood results. This is the separate AA evidence source.
  Full population details were unavailable in the abstract and remain null.
- Caffeine: [Sachse 1999, PMID 10233211](https://pubmed.ncbi.nlm.nih.gov/10233211/),
  [full primary paper](https://doi.org/10.1046/j.1365-2125.1999.00898.x),
  Methods; Results / Figure 2 and post-hoc comparisons; Discussion paragraphs
  2–5. The template now explains the tested comparison instead of assigning
  a universal three-way speed ladder. There is no caffeine speed preview.

Forward GRCh38 identities were checked using the official
[rs671 VEP response](https://rest.ensembl.org/vep/human/id/rs671?content-type=application/json)
and [rs762551 VEP response](https://rest.ensembl.org/vep/human/id/rs762551?content-type=application/json).
The ALDH2 mapping is chr12:111803962 G>A, Glu504Lys on transcript
ENST00000261733. Caffeine is chr15:74749576 C>A; the additional recorded
G allele has no interpretation. Neither template's allele mapping changed.

## What changed

The alcohol report replaces its review-only citation with the two primary
sources. It removes GG whole-enzyme assurance, AG low-intake cancer reassurance,
and AA assumed behavior. Caffeine replaces the former heart-attack citation
with the directly relevant enzyme study and removes unsupported sleep/intake
implications. No new personal risk number replaces those claims.

Only the selected alcohol statement and qualifier cross the existing server
boundary. Both source identifiers are required. Missing, conflicting, misplaced,
sensitive and third-party data retain the original preview exclusions.

The synthetic VCF gains an invented ALDH2 AG call and corrects caffeine's
swapped REF/ALT while retaining AC. `e2e/fixtures/PROVENANCE.md` records its
new exact SHA-256; this is the fixture admission checked by the secret gate.
Browser GG/AA variants are generated temporarily from that synthetic fixture.
GG is also tested through a genuine synthetic array upload. Explicit VCF 0/0
calls currently live outside `user_variants`, the preview loader's source,
so the test first proves no GG preview from that VCF alone. This is a current
implementation limit, not a scientific reason to withhold observed reference
calls. A follow-up should reuse them after checking stored locus/build/QC
provenance, never infer a reference call from an absent variant row.

## Verification scope

Unit tests preserve the original three-context pilot assertions and add the
two new reports separately. Tests exercise both citation requirements, all
twelve preview calls, absent caffeine preview, seed round trips, explicit
unknowns, source display and corrected scientific wording.

The production-browser workflow covers GG/AG/AA alcohol uploads, the corrected
AC caffeine report, four visible previews, filter/search, narrow-screen text,
linked source context, wrong-coordinate rejection and empty-account isolation.
Local template preimages and exact postimages are captured outside the repo;
only those two local rows are changed and restored after verification.
Publishing code alone does not publish these template changes. Hosted rollout
remains a separate reviewed action.

Verified locally on 2026-09-05: 1,539 unit tests; 58 targeted tests; typecheck,
targeted lint, all 162 template validations, readability, name and secret gates.
Nine production-browser tests passed with no skips or retries, including all
five unchanged sensitive-report regressions. A separate desktop/mobile browser
check confirmed the AA card and full qualifier without page errors. The two
temporary template changes were restored and exact complete preimages matched.
The production-browser server logged early stream closure during navigation;
the passing assertions and separate browser check showed no user-facing failure.
