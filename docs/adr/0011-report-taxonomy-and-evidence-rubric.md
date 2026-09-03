# ADR 0011: Report taxonomy and evidence rubric

- Status: Accepted
- Date: 2026-09-03

## Context

Report templates carried fifteen storage categories, a three-level evidence
enum (`established`, `moderate`, `preliminary`) and no statement of whether a
report was a direct reading of the file or a statistical model. X5 requires
two layers (`variant_call`, `estimate`), a five-level evidence rubric
(`clinical`, `established`, `emerging`, `preliminary`, `insufficient`) whose
`established` level means "seen in more than one study and checked by
comparing siblings", and nine user-facing categories. No published template
met the new `established` definition, so the old labels could not be kept
under their old names without overstating the evidence.

## Decision

Migration `supabase/migrations/20260903100000_report_taxonomy_and_evidence_rubric.sql`:

- Captures every template's old evidence value, creates the five-level type,
  swaps the column with an explicit map (`established` → `emerging`,
  `moderate` → `emerging`, `preliminary` → `preliminary`), and writes one
  `changelog_entries` row per relabelled template (119 rows, `kind`
  `evidence_relabel`, before and after values) so the change is disclosed to
  readers, not silent.
- Adds `layer` (default `estimate`, not null) and `estimate_kind`
  (`single_locus` or `polygenic_score`, derived from `pgs_id`), with CHECK
  constraints that an estimate names its kind, a variant call has no
  polygenic score, and a polygenic score has a `pgs_id`.
- Adds publication checks: an `insufficient` template is never published; a
  polygenic template is never published at `preliminary` or `insufficient`
  (`report_templates_polygenic_publish_evidence_check`). `compliance_exempt_until` (2027-03-02) records the 180-day window
  the specification grants existing content; it does not suspend the G4.1
  gate.
- `src/lib/genome/taxonomy.ts` is the one home for the nine categories, the
  total mapping from the fifteen storage categories plus six slug-level
  exceptions, the five public labels (`Clinical-grade`, `Established`,
  `Emerging`, `Preliminary`, `Not shipped`) and the gated set, which is
  preserved template-for-template across the change (thirty slugs pinned by
  a fixture).
- The seed refuses `insufficient`; the template validator enforces the five
  levels and the layer shape; the changelog page groups the relabels under
  one collapsed entry.

## Alternatives rejected

- `ALTER TYPE … ADD VALUE` inside the migration transaction. Rejected because
  Postgres cannot add and use a value in one transaction and has no
  `DROP VALUE`, so the old labels would have survived in the type.
- A `text` column with a CHECK constraint instead of an enum. Rejected
  because it loses the generated literal union the application relies on and
  the specification keeps naming the type `public.evidence_level`
  (`docs/protocol/approaches.md`).
- Keeping `established` for the 119 templates that carried it. Rejected: none
  of them has a sibling-comparison check, so the label would assert evidence
  that does not exist; X5.3 defines the level and "fewer claims, not more
  caveats" decides the direction of the remap.
- Relabelling silently. Rejected by the disclosure rule for evidence changes;
  the changelog rows are the disclosure.
- Showing the fifteen storage categories to readers. Rejected by X5; the nine
  categories are the only user-facing grouping and the storage category
  remains the gate key so no previously gated report is ungated.

## Consequences

Every surface that shows a report's evidence uses the public label from the
taxonomy module and the ≤20-word definition beside it; counts are per layer.
Templates cannot reach `established` again without the sibling-comparison
evidence, and a future relabel writes changelog rows the same way. pgTAP
tests (`supabase/tests/evidence_rubric.sql`) pin the constraints, including
the null-`estimate_kind` case.
