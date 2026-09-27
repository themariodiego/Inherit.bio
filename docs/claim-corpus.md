# Rendered claim checking: implementation boundaries

Status: integration work, not an accepted G1.11/G4.7 gate.

The canonical registers remain `data/citations.json`, `data/claims.json` and
`docs/route-register.json`. No second registry is introduced here.

## Components already implemented

- `src/lib/claims/registry.ts` validates canonical claim/source metadata and
  exact claim occurrences against the supplied commit date.
- `src/lib/claims/corpus.ts` checks complete supplied observations across
  static builds, the seeded browser harness, rendered email and generated
  exports. It requires exact source sets, resolvable provenance, independent
  surface requirements and explicit payload/commit receipts.
- `src/lib/claims/collect-dom.ts` collects actual DOM text, source references,
  figures and named prose regions. Tests execute the collector in Chromium,
  not against a hand-authored observation object. Requests are blocked.
- `src/lib/claims/capture-plan.ts` derives the minimum page/state, mail and
  export requirements before any successful capture exists. It consumes the
  existing route register, discovered email entrypoints and explicit code-owned
  prose policies. Missing policies and undeclared states fail; they never mean
  that a surface needs no checking. Capture labels are not application URLs.
- The canonical files contain 106 exact statements in sixteen reports: sixteen
  summaries, 51 study-context paragraphs and 39 genotype interpretations.
  The released first four reports (COMT, BDNF, FAAH and SLC45A2) account for
  39 independently reviewed statements. The everyday-trait follow-through
  released by PR72 adds 32 statements for cilantro, asparagus odor, bright-light sneezing and
  earwax; see `docs/sources/everyday/review.md` for source-review and release
  status. Four corrected ADORA2A statements add one summary and three genotype
  interpretations; the anxiety source was read as an author abstract and the
  sleep source as a full primary paper. See
  `docs/sources/reviews/adora2a-correction-20260923.md` for the exact scope.
  The APC, FGFR2, ALDH2 and TREM2 corrections add sixteen exact statements;
  their source notes record the actual access scope. TREM2 binds the primary
  author abstracts and does not claim full-paper access or assay validation.
  The APOE correction adds seven strings without assigning types from separate
  markers; two author abstracts and the NCRAD joint-marker chart define its
  source limits. Older captured templates retain their original wording and
  retain their original bytes. Known earlier corrections have a separate exact-text
  notice and Copilot boundary. The TCF7L2 and F5 corrections add eight exact
  statements with scoped source reads.
  The combined register has 41 sources: 30
  publications, seven Ensembl position/transcript records, one NCBI RefSNP
  record, two scoped ClinVar identity excerpts and one scoped NCRAD chart excerpt.
  `src/components/claims/claim.tsx` renders those statements with numbered,
  source-bound links on the actual report detail page. Changed hosted prose
  remains unregistered rather than borrowing attribution from different text.
  Existing source details remain available; `/science#sources` explicitly
  describes the selected-report scope, not a complete catalog review.
  Genotype attribution matches the exact report, rsID, diploid letters and
  prose. DOI study contexts resolve through the same canonical source index.
- `src/lib/claims/capture-emails.ts` renders all 12 named production mail
  exports in 11 files through 27 synthetic fixtures. It retains exact HTML,
  subject, input and observation bytes with digests and the clean checkout
  commit. Chromium collects body and subject separately with outbound requests
  blocked. No mail is sent. See `docs/sources/email-renderer-capture.md` for
  the checked boundaries and intentionally failing, incomplete corpus audit.

The current register yields 62 pages and 288 page/state captures, plus 11 email
entrypoints and four export contracts. These counts describe requirements,
not working pages, passing tests of those states or collected artifacts.

## Required prose regions

`requiredClaimRegions` names the report body, consent summary or other prose
regions that a renderer must supply. The DOM uses `data-claim-region`; each
text observation records actual inherited membership. Missing or empty region
placeholders fail. Nested/inline regions do not let inside prose inherit an
outside exemption. A separate explicit whole-surface wrapping flag remains
available for a document whose entire content is in scope.

Ordinary navigation outside those regions remains collected plain text, not
falsely labelled scientific prose or exempt chrome. Numeric claims, source
claims and figures are checked everywhere. Only the six explicit numeral
chrome kinds are exempt, and they cannot carry a claim. Citation numerals are
excluded from verbatim prose only when attached to actual source-reference
links; a citation-looking attribute cannot exempt ordinary text.

## Not finished

Catalog-wide canonical claim/source population, template citation-column
replacement, collection across all four real renderers, complete source-byte
digest binding, dynamic report/genotype and legal
version fixture expansion, internal-link checks and the final `gate:claims`
command/CI wiring remain unfinished. The capture planner is deliberately only
the minimum route-level inventory; one generic report does not cover the full
catalog. A callback accepting every seed/module ID would not prove provenance.

The DOM collector rejects unsupported frames, shadow roots and generated CSS
text; those require explicit adapters, not dropped observations. Figures still
need their registered text alternatives. Metadata receipts are checked by the
audit; the email adapter binds its own captured bytes, not the other three
channels. The actual eight-report DOM tests likewise do not constitute complete
state, export or email coverage. These limitations must not become silent
exemptions. Whole-plan acceptance remains 18/65.
