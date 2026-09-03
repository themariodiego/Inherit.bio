# ADR 0009: Statistical presentation contract

- Status: Accepted
- Date: 2026-09-03

## Context

Before this decision every quantity a result page showed was formatted in
place: the report page printed a genotype and a percentile as prose, the
ancestry page printed shares as raw numerals, and nothing in the tree carried
a machine-readable statement of what a number was, where it came from or whom
it described. The specification (`docs/inherit-v2-brief.md`) describes four
overlapping DOM vocabularies for the same facts (§2 §2.4 `data-genetic-value`,
§4 §2, G4 and X4). X0.2 forbids two definitions of one thing and §7 gives the
cross-cutting rules precedence, so one contract had to be chosen and the
others retired.

## Decision

One module, `src/lib/figures/contract.ts`, is the only vocabulary for rendered
quantities, and `src/components/figures/*` are the only components that
render them.

- Every figure node carries `data-figure-kind` (one of `absolute`, `relative`,
  `difference-pp`, `natural-frequency`, `percentile`, `coverage`, `interval`,
  `ancestry-share`, `genotype`, `carrier-status`), `data-figure-class`
  (`variant-call`, `estimate`, `ancestry`, `quality`), `data-figure-basis`
  (`observed`, `modelled`) and `data-provenance` (`citation:<id>`,
  `seed:<table>/<id>` or `computed:<module>`).
- Subject attribution (`data-subject-id` or `data-subject-pair`) is emitted on
  the `<ClaimBlock>` container only; a figure has exactly one attributed
  ancestor.
- A block that contains a modelled figure renders the G4.2 marker once:
  `This is a model, not an observed outcome.`
- Natural frequencies share one denominator per block, chosen from 100,
  1,000, 10,000, 100,000 and 1,000,000 as the smallest that renders every
  figure as an integer of at least 1 and keeps figures that differ by more
  than display precision distinct; otherwise the block renders
  `Fewer than 1 in a million, both for you and for the comparison group.`
- A percentile never renders without an absolute risk in the same block
  (`assertPercentileHasAbsolute` throws). Today no surface renders a
  percentile at all: the existing score is computed against one cohort-wide
  reference distribution with no named panel, size or interval and no
  absolute risk beside it.
- A relative figure renders only with both absolutes and the difference in
  percentage points; an ancestry share renders only with its range.
- The local ESLint rule `inherit/no-raw-figure` fails the build on a numeric
  or genotypic literal rendered on a result surface outside these components.
  The ancestry page and the variant browser are listed as exceptions until
  their rewrites land; every other result surface is enforced.

## Alternatives rejected

- The §2 §2.4 `data-genetic-value` vocabulary, kept alongside X4. Rejected by
  X0.2 and §7: two attribute sets describing the same node are two
  definitions, and the acceptance detectors in §8 assert the X4 attributes.
- Per-page formatting helpers. Rejected because the report-gate E2E had to pin
  results by prose ("Your genotype") and the pages disagreed with each other
  on percent precision; a contract the lint rule can enforce is the only
  form that prevents the drift recurring.
- Rendering the existing percentile with a caveat. Rejected: X4.2 and §4 §2.5
  forbid a percentile without an absolute risk and a named reference group,
  and the session's numerics review found the value is a global fallback, so
  a caveat would decorate a number that is not true for the reader.
- The two-rung denominator ladder in G4.1 (100, then 1,000). Rejected by X4.1,
  whose matching rule must admit the full five-rung ladder; G4.1 and §4 §2.3
  conflict with each other and X4 governs.
- Rendering the §4 §3.5 sentence as a second modelled marker. Rejected as the
  caveat stacking X0.1 forbids; the G4.2 string is the one the detector reads.

## Consequences

Pages build `FigureSpec` values and hand them to `<ClaimBlock>`; they cannot
print a number themselves. Unit tests pin the once-per-block marker, the single
attributed ancestor, the denominator rule with worked vectors, the percentile
guard, the relative-figure guard and the ancestry-range guard. Reports that
have no baseline data render the genotype and the exact sentence
`We can’t put a range on this yet, so we don’t show a single number.` rather
than a percentile. Recorded in `docs/protocol/decisions.md` (2026-09-03,
modelled-figure marker; natural-frequency denominator rule; presentation
decisions).
