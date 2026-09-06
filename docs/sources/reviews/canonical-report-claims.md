# Initial canonical report claims

Agent transcription and source-binding review, 2026-09-06. Base: frozen PR 68 commit `a632ac3005bb91cce8f1656491771cc89cc6a7b9`. This populates the two X14 canonical files, `data/citations.json` and `data/claims.json`, using `src/lib/claims/registry.ts`. It creates no alternate citation or claim register. Existing runtime template citations remain unchanged until their coordinated replacement is implemented.

## Exact scope and independent evidence

There are 39 statements: four full summaries and 35 non-null study-context paragraphs from the four independently reviewed objects below. There are nine unique publications and two official allele-annotation records. Every statement is copied exactly from its current seed field, not rewritten during registration.

- `stress-anxiety-comt-rs4680`, `mood-stress-resilience-bdnf-rs6265` and `problem-substance-use-faah-rs324420`: [final independent scientific review](batch-02/independent-correction-review.md), including exact object hashes, field verdicts and unresolved limits. Earlier [batch 01](batch-01/indices-00-19.md) and [batch 02](batch-02/publication-reviews.md) receipts identify original source readings and bounded excerpts; their pre-correction objections must not be mistaken for findings against the final objects.
- `skin-uv-sensitivity-slc45a2`: [independent scientific review and object hash](batch-04/slc45a2-independent-review.md), with [implementation/source-reading receipt](batch-04/slc45a2-correction.md).

Stable IDs have form `report.<slug>.summary` or `report.<slug>.study.<pmid>.<field>`. The source-context fields are measured, population, comparison and limitation. The absent BDNF cell-study population stays absent. All nine genotype interpretations are outside this population; source-verified protein/association prose must eventually be separated from the computed statement about what an uploaded file contains. The SLC45A2 report adds another three genotype interpretations, also not registered here.

The four full summaries retain all qualifying sentences and opposing evidence. BDNF binds both the earlier synthesis and later large negative study, not just the positive result. FAAH and SLC45A2 summaries additionally bind the public forward-allele annotations rather than asking a protein paper alone to establish genomic strand. Source-context limitations are descriptive boundaries of the measured evidence, not claims that every possible effect is absent. Reviewer fields identify actual Codex agents and explicitly disclaim human signoff; registration does not supply external clinical review or publication authority.

## Actual source access and quotation budget

All access dates are 2026-09-06, an actual source-read date recorded in the linked receipts. Missing canonical excerpts were checked against primary publication records or full primary text that day. Additional MED records for Hosang, Border and Le were read from the official Europe PMC core endpoint at 02:12:35–02:12:36 UTC: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:<PMID>%20AND%20SRC:MED&format=json&resultType=core`. Their author abstracts were read, not just titles. The existing full-paper reviews continue to support facts not given in those abstracts.

The canonical quotations are deliberately short. Egan 2001, Sipe 2002, Egan 2003 and Stein 2005 reuse shortened portions of existing quotations. Han's new eight-word excerpt is from the actual SLC45A2 model, not the earlier IRF4 excerpt; the two total 24 words. All publication totals remain at most 25 words, counting the previous allocated excerpts as well as these canonical snippets. Quotes are anchors to the publication; field-specific evidence edges and their source locators explain the actual scope. No whole abstract, paper or figure is copied into this repository.

Two fresh HTTP-200 Ensembl responses were read at 02:13:14 UTC and preserved as explicitly partial, field-selected public response snapshots under `docs/sources/ensembl/`. Their genomic fields and selected transcript record are unchanged; unrelated colocated labels, frequencies and alternate placements are omitted. These are evidence archives referenced from the sole citation register, not another registry. The SLC45A2 primary placement includes C/A/G; this report still interprets only C/G. Annotation and protein prediction fields do not create a clinical assertion or determine a user's genotype. No service version is invented where the returned endpoint does not name one.

## Intended surfaces, not captured occurrences

- Detail: `/genome/[subject]/reports/<slug>#state=complete`. This is the primary rendered route, not the legacy `/reports` redirect. The suffix follows capture-plan state labeling. The current minimum planner still has `[slug]`; a reviewed dynamic fixture expansion must bind these concrete slugs and synthetic subjects before corpus acceptance. Other states are not silently covered.
- Export: `export:account-export-v1`, specifically the currently serialized report summary and citation-context JSON member. The human-readable text member contains summaries but not context paragraphs. The contract key alone does not prove either member was rendered, byte-bound or wrapped. Other export contracts are not registered here.
- Email: only the four summaries declare `email:src/emails/research-digest.tsx#fixture=research-digest--public-catalog`, coordinated with the real email-capture agent. That fixture renders every current template's title and summary. The single-entry fixture uses a different report; the empty fixture has no entries. Neither is declared. No study context is declared for email because the real digest does not render it. Titles need their own registration later.

These arrays are intended exact contracts, not an assertion that annotations or corresponding real captured occurrences already exist. A test-derived seed occurrence is explicitly not the four-renderer corpus. Calling registry validation with an empty corpus still rejects these claims as orphans.

## Verification and remaining gaps

The data test pins all four independently reviewed object hashes, exact seed prose, intended surfaces, reference resolution, source snapshots, opposing evidence, explicit agent metadata and quote budgets. Mutations to a paragraph or source ID fail. It does not certify independent science by testing its own expected strings.

Local verification on 2026-09-06: 95 focused tests passed across canonical data, registry validation and the two corrected-report regression files; typecheck, scoped ESLint, template/readability/name/secret gates and diff checks passed. No browser server, private file, shared database or provider submission was used.

Still unfinished: canonical registration of the rest of the catalog and every other claim surface; shared production claim wrappers; replacement of legacy runtime citation objects; dynamic subject/report/state fixture expansion; actual detail/export/email capture and exact byte receipts; source supersession checks; computed personal-input separation; and complete G1.11/G4.7 gate/acceptance evidence. None is waived by this initial population. No template, schema, production data or provider email has been changed.
