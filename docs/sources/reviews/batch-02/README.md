# Citation review: sorted indices 20–39

Agent review, not clinical, editorial, or publication approval. No template, runtime, registry, or access-date fields were changed. These receipts identify both support and gaps; they do not complete G1.11 or G4.7.

Selection: collect citations from `data/templates/*.json`, prefer `pmid` over `doi` on each citation, prefix with `pmid:` or `doi:`, deduplicate, and sort with JavaScript default `.sort()`. This batch covers zero-based indices 20 through 39 of the 186 keys found during review.

Template source HEAD: `eb69fbd79b6826f5b68ffc938ae40bbfde8ed27f`. A read-only validation matched all twenty selected keys and all 22 citation-to-template uses, and verified each excerpt contains 5–18 whitespace-delimited words. Other agents' work was not edited.

All twenty complete PubMed abstracts were actually read from NCBI's primary publication records on **2026-09-06**, initially in two batches at 00:49:27Z and 00:49:46Z, then re-read together after an HTTP 200 response at **2026-09-06T00:55:12.572Z**. The titles and abstracts, not merely metadata, were examined. The individual PubMed URLs below identify each record. The final retrieval endpoint was `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=12879365,1394429,14559957,15130757,15208781,15565110,15723792,15732191,15733200,15902657,15956988,16044172,16415884,16444273,16642438,17053149,17068223,17158188,17329997,17339269`.

Scope is deliberately abstract-level unless stated otherwise. Full-paper access attempts for selected uncertainties did not yield a sufficiently complete, reliably readable paper, so they are not represented as full-text review. A failed retrieval or an absent term in an error response is not negative evidence. No entire abstract or paper is stored here. Each unique publication has exactly one bounded verbatim excerpt, at most 25 words in aggregate across this batch. Remaining prose is original agent analysis.

Field pointers below use an exact template slug and variant rsID selector, not a potentially unstable array offset. `interpretations.*` means all currently present genotype interpretations. An unsupported claim means **not established by the material read from this particular citation**, not necessarily disproven in all literature. Other citations on a template require their own review. No GRCh38 placement, reference/alternate allele, strand conversion, haplotype phase, diplotype, genotype-specific effect, or individual prediction is considered verified merely because a gene association was found.

## Priority findings

- **Corrected false positive — TP53:** PMID 15732191 describes a different cohort, but the template also cites PMID 17535973, which supports its Danish 9,219-person cohort, twelve-year follow-up, and three-year median-survival difference. Both citations have now been read; those numbers are not a whole-template citation mismatch.
- **Citation identity/scope:** PMID 17158188 is led by Bierut, not the template's Saccone label. Its abstract does not substantiate the template's CHRNA5 allele-specific cigarettes-per-day claim.
- **Endpoint mismatch:** the cited FKBP5 paper concerns depression recurrence and treatment response; it does not establish the template's early-adversity-conditioned cortisol story. The ADORA2A paper concerns caffeine and sleep, not the stated anxiety endpoint or the TT/CT/CC ordering from the abstract alone.
- **Single-site versus joint-pattern claims:** TAS2R38's rs713598 interpretations are stronger than the template's own incomplete-haplotype caveat; ANXA5 evidence concerns a four-change joint haplotype, not an independently verified single-tag genotype dose response.
- **Unmeasured utility:** ABCC11's cell transport and earwax findings do not establish deodorant benefit or a heterozygote body-odor gradient.

The detailed record is [publication-reviews.md](publication-reviews.md). These are correction/research inputs, not authorization to remove warnings, publish an unverified interpretation, or infer a result from an unobserved allele.
