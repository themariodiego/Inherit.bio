# Production report catalog refresh: the CF report reworded, 28 September 2026

The delivery half of "The live cystic fibrosis report is reworded now"
(`docs/protocol/decisions.md`, 28 September, later). Pull request #242 changed
two genotype readings of `cystic-fibrosis-cftr-f508del-informational` in
`data/templates/reproductive-family.json` and merged as `f40e6174`. Production
serves report text from `public.report_templates`, which a deploy does not
refresh (D-134). This record is the guarded refresh that brought that one row
to `main`, and the checks that it did exactly that.

## Authorization and scope

The owner chose the recommended option in chat on 28 September: reword the
report now and apply it through the guarded catalogue refresh, with a receipt.
It covers one row of `public.report_templates` in project
`zuvloczwgrayonqabnss` and nothing else: no schema, no other table, no other
row.

| Genotype | Before | After |
| --- | --- | --- |
| No deletion (`TCTTTCTT`) | "…so it does not rule out carrier status." | "…so it does not rule out the others." |
| One copy (`TTCTT`) | "One copy of F508del, which is consistent with CF carrier status. Carriers are healthy. If both partners carry a CF-causing variant, each pregnancy has a 1-in-4 chance of CF. Consumer arrays can misread this site. A clinical lab should confirm the result before you act on it. A genetic counselor can explain what it means for family planning." | "One copy of F508del. Consumer arrays can misread this site. A clinical lab should confirm the result before you act on it. A genetic counselor can explain what it means for family planning." |
| Two copies (`TT`) | unchanged | unchanged |

Title, summary and citations were written but are unchanged.

## The statement

[`refresh.sql`](refresh.sql), SHA-256 `593c6908f85fe63bcbd81f55ff01d64a5a2ae1b00fa11261eb4b522acaa30abc`, generated from
`data/templates/reproductive-family.json` at `1ca33c6b` (predecessor) and at
`main` `f40e6174` (successor), and executed unchanged. One `DO` block, so it
commits or rolls back as a whole:

1. `lock_timeout` 1 s, `statement_timeout` 15 s, idle-in-transaction 15 s.
2. Locks the row.
3. **Predecessor guard:** proceeds only if the row holds the `1ca33c6b` text,
   compared by md5 of title, summary, `variants::text` and `citations::text`
   ([`digests.json`](digests.json), `predecessorMd5`).
4. Updates title, summary, variants, citations and `updated_at`, failing
   unless the update touches exactly one published row.
5. **Successor check:** the row must then equal `main` (`successorMd5`), and
   162 templates must still be published.

Category, evidence, layer, estimate kind, `pgs_id`, status and `published_at`
are not written; the generator refused to run unless they were identical on
both sides and unless this was the only one of the 162 templates that
differed. Variant coordinates and genotype keys are unchanged, so
`ref_variants` needs nothing.

## Sequence, UTC, 28 September

| Time | Step | Result |
| --- | --- | --- |
| before | Read-only pre-check (`precheck.sql`) | Row held the predecessor text; 162 published; catalogue md5 `49cf36fb…cde4`; no run in flight. Every captured copy of this report carried the old wording, and none the new. Aggregates only; no identities, genotypes or report content read |
| 09:56 | Dry run: the same block ending in a forced exception (SHA-256 `b01663f95acfe53f6c21c940a7a4661611860e75703b5b5d69e49ab594f9f6dc`, differing only in its last line) | `catalog_refresh_dry_run_ok`; rolled back |
| 09:57 | Rollback check | Row still held the predecessor text; `updated_at` unchanged |
| 09:57 | Committing run | Completed without error, so every check in steps 3–5 passed |

## After

- **The whole catalogue equals `main`.** One md5 over every published row in
  byte order of slug, each row contributing slug, category, evidence, layer,
  estimate kind and `pgs_id` plus md5s of title, summary, `variants::text` and
  `citations::text`: production gave `ba371662d06b340c2778ea6945eb684f` over 162 rows; `data/templates` at
  `main` gives `ba371662d06b340c2778ea6945eb684f` over 162.
- **Exactly one row changed**, with one `updated_at`, `2026-09-28 09:57:36.963229+00`: one transaction.
- **Saved reports unchanged:** the same completed runs and captured CF items as
  before, none of them changed. `private.capture_own_report_catalog_v1` keeps completed
  results immutable, so those keep "carrier status" and the 1-in-4 sentence
  they captured. Every report generated from now on captures the new text.

## Not claimed

- `scripts/catalog-drift-gate.ts` itself was not run against production. The digest comparison
  above covers the same fields.
- No browser journey was run against production after the refresh.
- The preview project was not compared or changed.
- The owner decided on 28 September that saved reports keep the wording they
  captured and that no one is contacted, as with the 25 and 27 September
  refreshes. Nothing here contacts anyone.
- The report still shows no ClinVar review status or classification date.
  The brief's variant-card rule for those belongs to the carrier importer
  (`docs/carrier-importer-design.md`).
