# Everyday report follow-through — source review

Reviewed 2026-09-06 by Codex agent root; not human or clinical signoff.
Status: implemented and targeted local browser checks passed; not yet released.
Independent scientific review is complete; full CI remains required before
publication.

## Product scope

Four existing reports gain more precise explanations and exact source links
on each of their three common genotype interpretations. Cilantro, asparagus
odor and bright-light sneezing gain library takeaways; the existing earwax
takeaway remains. The preview set grows from four to seven traits. No score,
personal probability, evidence-level upgrade, new access gate or clinical
recommendation is added. The other six basic-trait templates are unchanged.

The canonical register adds 32 statements: four summaries, 12 genotype
interpretations and 16 study-context paragraphs. Together with the released
39 statements, this is 71 claims in eight reports, supported by 19 sources.
This is not complete catalog, email, export or whole-plan acceptance.

## Publication evidence actually accessed

### Cilantro — DOI 10.1186/2044-7248-1-22

The [author-hosted paper](https://ai.stanford.edu/~chuongdo/papers/cilantro.pdf)
was read through PDF text extraction, including Table 2 and the Results and
Methods. No rendered-table visual inspection is claimed. The paper states
CC BY 2.0. Only short excerpts already allocated in the canonical register
and the earlier batch-01 review are retained; no full paper is committed.

Table 2 gives a per-A association with fewer soapiness reports. The main
European-ancestry sample has 14,604 participants; the filtered, non-overlapping
replication sample has 11,851 and answers a liking question. The outcomes are
not interchangeable. OR6A2 is a candidate near the signal, not an established
cause. Neither the fitted allele effect nor genotype determines individual
liking or gives a personal taste score. All three interpretations retain
these distinctions without invented numerical predictions.

### Asparagus odor and bright-light sneezing — PMID 20585627

The [complete article XML](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC2891811/fullTextXML)
was read, including Tables 1, 2, 9 and 10 and phenotype methods/discussion.
The XML specifies CC BY 4.0. No new long quotation is stored.

Table 9 supports more frequent odor detection reports with A than GG, with
one and two A copies similar. AG must not be described as halfway between
AA and GG; most GG respondents still noticed the odor. The survey does not
separate odor production from detection. Table 1 reports 4,742 participants
for this trait; Table 9's cells sum to 4,737. The copy names Table 1 as its
sample-size source and does not invent a reason for that difference.

Table 10 supports more bright-light-sneeze reports with C; most CC respondents
still report no reflex, and every genotype group includes the reflex. The
sample is 5,390. Both analyses concern unrelated northern-European-ancestry
participants and self-reported outcomes, not controlled sensory tests or
proof that a nearby gene causes the experience.

### Earwax — PMID 16444273

The complete author abstract was read using the
[primary-record API](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:16444273%20AND%20SRC:MED&format=json&resultType=core).
This is abstract-only review: no full-paper, supplement or participant-count
verification is claimed. The abstract supports coding-strand G/A association
with wet/dry earwax, wet dominance, a cell transport comparison and a rare
deletion. The revised copy removes unsupported participant/stage details and
intermediate-body-odor claims. It does not extrapolate deodorant benefit or
body odor magnitude. The existing short abstract excerpt and four-word
canonical snippet remain within the 25-word aggregate quotation allocation.

## Allele and coordinate binding

Four variation API receipts and one VEP receipt are archived beside this note.
Each records URL, HTTP 200, access time, original response digest and a parsed
record. The digest is of the fetched response, not of the reformatted archive;
the archive is not represented as an exact response-byte capture.

| Report | GRCh38 position | Reviewed forward alleles | Mapping receipt |
| --- | --- | --- | --- |
| Cilantro | 11:6868417 | C/A | `ensembl-rs72921001.json` |
| Asparagus odor | 1:248333561 | A/G | `ensembl-rs4481887.json` |
| Bright-light sneeze | 2:145367955 | C/T | `ensembl-rs10427255.json` |
| Earwax | 16:48224287 | C/T | `ensembl-rs17822931.json`, `ensembl-vep-rs17822931.json` |

The earwax VEP record binds ABCC11 reverse-strand transcripts, including
ENST00000353782, and the forward T allele to Gly180Arg. Combined with the
paper's coding-strand result, this supports forward CC/CT wet and TT dry.
The variation records also list a third T allele for rs4481887 and a third G
allele for rs17822931. Neither receives a reviewed A/G or C/T interpretation.
Position records support mapping, not trait effects or any user's genotype.

## Exact template objects

SHA-256 over `JSON.stringify(template)` is pinned in
`src/lib/claims/canonical-report-data.test.ts`:

| Slug | SHA-256 |
| --- | --- |
| `cilantro-soapy-taste-or6a2` | `b268966b7d5977bdc9dc1aefa80cef51da5bee23e892a530f469f154d3cb3578` |
| `asparagus-odor-detection-or2m7` | `25a187d6da880233af5f10917cb847c9354b1cb1f9bdc8ca145e6a6725781206` |
| `photic-sneeze-reflex-2q22` | `64e5889a8e5cd32baa20534aa30f856c07f50644a78ca06162e75aef85e9c4d5` |
| `earwax-type-abcc11` | `387b6f8c0adbe89f60cc4effe56cb03f9501838b70920abb4e7dea5a2e661a36` |

The two existing companion citations (PMIDs 27965198 and 30899065) are
preserved but not newly access-dated, re-certified or used for these claims.
The separate cosmetic earwax/body-odor template is outside this change and
does not acquire scientific approval from it.

## Verification and release boundary

Codex agent `report_science_coverage` independently checked the primary
paper/abstract evidence, fresh mapping responses and all 32 exact statements.
Two findings were corrected: the cilantro qualifier now names European
ancestry rather than implying recruitment in Europe, and the earwax TT
interpretation reports that the rare change was found without assigning an
abstract-unverified effect to it. The agent confirmed the corrected prose and
earwax object hash above. This is bounded scientific review, not human signoff.

Seven local production-build browser cases passed with no skips or retries.
Three upload cases exercise reference, mixed and alternate synthetic VCF
calls through storage, processing, library previews and all four report
pages. They verify the selected genotype claim, study context, external
source targets and absence of invented risk/percentile figures. Original
alcohol, four-preview/filter/mobile and empty-account cases remain covered.
The initial run failed on citation selectors; the corrected run passed all
seven. Navigation also emitted two server stream-close messages; this is not
a claim of a warning-free runtime.

After the two final scientific wording corrections, the combined local run
passed all 16 reference-call, personal-preview and report-skeleton browser
cases. The initial full PR CI failures and expanded fixtures are recorded in
`docs/test-diff-register.md`; the failed run is not release approval.

Unit DOM tests render all registered paragraphs for eight report components;
the actual detail page renders the selected genotype only. Intended export
and digest metadata is not proof of full rendered-channel capture.
Publication must update only the four reviewed hosted templates, preserve
the other 158 published reports and all real files, and verify the exact
green application revision. No hosted data has been changed for this package.
