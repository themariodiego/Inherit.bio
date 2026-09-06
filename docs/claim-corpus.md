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

The complete canonical claim/source data, shared production Claim component,
template citation-column replacement, collection across all four real
renderers, actual source-byte digest binding, dynamic report/genotype and legal
version fixture expansion, internal-link checks and the final `gate:claims`
command/CI wiring remain unfinished. The capture planner is deliberately only
the minimum route-level inventory; one generic report does not cover the full
catalog. A callback accepting every seed/module ID would not prove provenance.

The DOM collector rejects unsupported frames, shadow roots and generated CSS
text; those require explicit adapters, not dropped observations. Figures still
need their registered text alternatives. Metadata receipts are checked by the
audit, but only the future renderer adapter can prove that a digest belongs to
the actual captured bytes. These limitations must not become silent exemptions.
