# Independent review of three report corrections

Reviewed on 23 September 2026. This is agent source/content review, not
clinical approval, human signoff, hosted publication or G1.11/G4.7 acceptance.

The APC and ALDH2 drafts were independently checked by the report-boundary
review agent. The FGFR2 draft was independently checked by the root agent.
Each reviewer checked the actual source passages against the final four
strings and their canonical evidence edges. No substantive source-to-copy
defect remained. The corrected objects and claim arrays were compared again
after combination; the independently reviewed scopes are unchanged.

Actual independent access:

- APC: Laken's author abstract; Valle's relevant meta-analysis, homozygote
  and heterogeneity sections; Allen's published Methods, Results and
  Discussion, with visual inspection of Table 1; the saved NCBI placement.
  The broad confidence intervals do not prove absence of an association.
- ALDH2: Brooks' review, the relevant Rwere human-study sections, and the
  Yokoyama and Enomoto author abstracts. NCBI/ClinVar records separately
  confirm variant identity. No AA-versus-AG cancer ranking is established.
- FGFR2: the primary paper's pattern-of-risk and Discussion passages,
  Methods and Table 2, plus visual inspection of supplementary Table 8's
  rs2981582 row and allele-definition footnote. The study supports the
  genotype association, not an individual probability or care instruction.

The corresponding correction notes contain source URLs and precise access
limits. Abstract access is not described as full-paper access.

The regression fixture pins these full report objects, using SHA-256 of
UTF-8 `JSON.stringify(object)` in repository property order:

| Report | SHA-256 |
| --- | --- |
| `colorectal-apc-i1307k` | `b72c0bb355b7874295106ce9efb52892a423c32ff88e14cfd9a4002f4056bcce` |
| `breast-cancer-fgfr2-rs2981582` | `1977082a6625dccdf4a3955bd0e691208c525a57b48724267426be5bbea216b6` |
| `alcohol-dependence-aldh2-rs671` | `8e0d2078554b8944b5876676c036cd5581eb9f366d9ca6ba3d652ac403d3d50f` |

The baseline 71 claims and their earlier review receipts stay intact. The
new tests cover supported genotype distinctions, unrecognized/no-call states,
exact citation binding and refusal to lend sources to changed text. Those
checks protect transcription and rendering; the source reads above supply
the scientific review. The remaining catalog and declared export/mail
surfaces still require their own full evidence.
