# Independent review of the initial canonical report claims

Agent review by Codex `/root/report_science_coverage`, 2026-09-06. Exact candidate: `6a63e689ae76380e941137f1817a8d95b655a3c4`. This reviews the canonical transcription and evidence edges independently of their author; it is not human clinical review, approval of all report content, publication authority, or G1.11/G4.7 acceptance.

**Verdict: approved for this bounded content/source-binding review.** All 39 statements match their existing reviewed template fields exactly; all 46 evidence edges point to the appropriate source and preserve its specific scope. Nine publications and two official annotation records resolve. No genotype interpretations were added to this canonical population.

## Exact content receipts

SHA-256 below hashes the complete raw UTF-8 file bytes at the candidate commit:

| File | SHA-256 |
| --- | --- |
| `data/citations.json` | `4d5d37bb68b06095307e44450d3aa06adc992a9b91336b83133dd6ac71aa4017` |
| `data/claims.json` | `a4661e67c7c70ae62c7048d80b613968c5e7a28d56b0f253e8f9356eae872f94` |
| `docs/sources/ensembl/rs16891982-2026-09-06.json` | `6c71999736e43b751cbf24209ebd6973d3917f5f3ec27ecbbd0cbc38e8deb9b8` |
| `docs/sources/ensembl/rs324420-2026-09-06.json` | `bf784903fefdc5a5141e0d173c1d89b2535a765727356f3719eb798faf8477de` |

The four template-object hashes remain those in [batch 02](batch-02/independent-correction-review.md) and [the SLC45A2 review](batch-04/slc45a2-independent-review.md). Independent field comparison selected each report by slug, then compared `.summary` or `.citations[pmid].studyContext[field].text` against `text_verbatim`. It checked all 39 statements, not a sample. URL/access-date references also match the 11 canonical citation records.

## Actual independent source reads

All nine complete author abstracts were freshly read through Europe PMC MED core records on **2026-09-06, 02:21:24.808–02:21:25.326 UTC**, HTTP 200. The exact request pattern is `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:<PMID>%20AND%20SRC:MED&format=json&resultType=core`. The PMID is substituted from the table below. These are publication records, not consumer interpretations.

Additional actual reads: Han's primary publisher Results and Methods; Le and Hosang full-paper XML through Europe PMC; Sipe and Border primary PMC HTML fetched directly. These are named below. PMC browser opens returned challenges, and Sipe/Border Europe PMC XML returned 404; neither failed response is counted as a full-paper read. Their subsequent direct PMC HTTP-200 passages were actually read. No paper body or new publication excerpt is copied into this receipt.

| Canonical source and claim group | Independently read support and limits |
| --- | --- |
| [11381111, Egan COMT](https://pubmed.ncbi.nlm.nih.gov/11381111/) — COMT summary and four context fields | Abstract supports enzyme-activity background, the 175/219/55 main groups, smaller functional-imaging groups and Met-dose card-sorting error comparison. The edges do not turn this into everyday anxiety, pain or stress performance. |
| [15956988, Stein](https://pubmed.ncbi.nlm.nih.gov/15956988/) — COMT summary and four context fields | Abstract supports 497 undergraduates, personality inventories, female-specific associations and three-site/haplotype analysis. No unverified genotype-specific anxiety direction is assigned. |
| [12553913, Egan BDNF](https://pubmed.ncbi.nlm.nih.gov/12553913/) — BDNF summary and three context fields | Abstract separates human memory/imaging from transfected-neuron secretion. Stimulated release differs; constitutive release does not. The absent population context remains absent, rather than guessed. |
| [24433458, Hosang](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC3912923/fullTextXML) — BDNF summary and four context fields | Full Methods, Table 2, Discussion and limitations read at 02:21:42 UTC. Supports 22 studies/14,233 people, predominantly European samples, Met-dominant grouping and stronger life-event than childhood-adversity evidence. The combined-P-value method is not a calibrated personal effect. |
| [30845820, Border](https://pmc.ncbi.nlm.nih.gov/articles/PMC6548317/) — BDNF summary and four context fields | Full Table 2 and polymorphism-level Methods/Results read at 02:22:06 and 02:23:27 UTC. The actual rs6265 row is tested; its main/interaction results do not pass the stated correction. The preregistered threshold and varying stress measures support the carefully limited nonconfirmation, not absence of every possible BDNF effect. |
| [12060782, Sipe](https://pmc.ncbi.nlm.nih.gov/articles/PMC123078/) — FAAH summary and four context fields | Subjects, Tables 1–2 and trypsin assay read at 02:22:06–02:23:27 UTC. The selected white survey sample, combined problem-drug/alcohol endpoint, AA enrichment and lack of AC enrichment are supported. Protein-cutting assay susceptibility is not global instability, brain signal measurement or a causal behavior prediction. The separate annotation edge below binds forward A to the studied protein form. |
| [18483556, Han](https://journals.plos.org/plosgenetics/article?id=10.1371/journal.pgen.1000074) — SLC45A2 summary and four context fields | Full consecutive MATP/SLC45A2 Results paragraphs and study-population Methods read 2026-09-06. The four-site model supports rs16891982 associations with hair color, skin color and tanning; its sample comprises skin-cancer controls. This is not borrowed from the adjacent IRF4 result. |
| [29974532, Hernando](https://pubmed.ncbi.nlm.nih.gov/29974532/) — SLC45A2 summary and four context fields | Abstract supports 456 participants in Spain, questionnaire traits/exposure and reported-sensitivity association. No C/G contrast, cancer-cohort composition or personal UV threshold is inferred. |
| [32966160, Le](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7927184/fullTextXML) — SLC45A2 summary and four context fields | Full Introduction, Results, Figures 7–8 and methods read at 02:21:41 UTC. Human forms expressed in deficient mouse pigment cells differ in pigment and protein loss. This supports the form comparison, not human heterozygote interpolation or personal skin/sunlight measurements. |

The four summary evidence sets deliberately combine sources with different roles. In particular, the BDNF summary retains both older positive and larger later negative evidence; the annotation records support letter/protein identity, not behavioral or pigmentation associations. Descriptive limitations state the scope of the experiments; they do not assert that all other effects are disproved.

## Independent forward-allele verification

Fresh official responses were read and compared structurally with **every archived record field and the entire selected transcript-consequence object**, not merely an rsID match:

| Source | Fresh read UTC / status | Verified binding |
| --- | --- | --- |
| [Ensembl rs16891982](https://rest.ensembl.org/vep/human/id/rs16891982?content-type=application/json) | 2026-09-06 02:21:08.968 / 200 | GRCh38 chr5:33951588, forward C/A/G, record strand +1. ENST00000296589 is strand −1; forward G has codons ttG/ttC and L/F at residue 374. Thus forward C is Leu and G is Phe. Extra allele A is not added to the report's C/G scope. |
| [Ensembl rs324420](https://rest.ensembl.org/vep/human/id/rs324420?content-type=application/json) | 2026-09-06 02:21:10.064 / 200 | GRCh38 chr1:46405089, forward C/A, record strand +1. ENST00000243167 is strand +1; forward A has codons Cca/Aca and P/T at residue 129. Thus forward C is Pro and A is Thr. |

Both archived selections deep-equal the corresponding fresh returned objects. Their own original receipt times remain unchanged; this note records a separate read. Neither service-version history nor all alternate placements is proved by these explicitly partial snapshots. Predictor labels present in the raw selected transcript records are not used as clinical evidence or as a personal result.

## Quotation budget and surface boundary

Canonical publication excerpts were checked against actual primary text/records. Counts below are whitespace-delimited words; totals include the existing **conservative** prior allocation even when a canonical excerpt repeats a shorter portion. Han's pending earlier allocation is reserved as well.

| PMID | Canonical excerpt | Prior allocation | Aggregate upper bound |
| --- | ---: | ---: | ---: |
| 11381111 | 3 | 12 | 15 |
| 12060782 | 5 | 12 | 17 |
| 12553913 | 3 | 9 | 12 |
| 15956988 | 5 | 5 | 10 |
| 18483556 | 7 | 16 | 23 |
| 24433458 | 11 | 0 | 11 |
| 29974532 | 5 | 0 | 5 |
| 30845820 | 14 | 0 | 14 |
| 32966160 | 11 | 0 | 11 |

All remain below 25 words per publication. This receipt adds zero new excerpt words. Nonblocking arithmetic clarification: the author receipt calls Han's snippet eight words and its total 24; the actual snippet has seven whitespace-delimited words, giving a conservative total of 23. This does not affect source support or compliance.

All listed detail, account-export and digest fixtures are **intended surfaces**, not observed occurrences. Summary-only digest scope and the distinction between JSON contexts and the text export are appropriate intentions. No real renderer capture, byte binding, dynamic subject expansion or full-catalog acceptance follows from this review. The canonical data and source snapshots are approved only at the exact hashes above; rendering integration remains separately owned and must be tested.

Verification: an independent Node comparison checked all 39 text bindings, 46 citation URL/date edges and the four prior template-object hashes; the focused canonical-data suite also passed all seven tests. Source support was assessed from the primary reads above, not inferred from those tests. Only this review note was added on the review branch; no templates, canonical records, hosted data, user files or provider messages were changed.
