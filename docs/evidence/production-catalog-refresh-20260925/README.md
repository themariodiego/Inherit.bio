# Production report catalog refresh — 25 September 2026

Closes the delivery half of D-134. Production served `57d6b4e` over a report
catalog that still held the registered pre-correction text of all eight
batches in `data/report-scientific-corrections.json`. This record is the
guarded refresh that brought those eight rows to `main`, and the checks that
it did exactly that.

## Authorization and scope

The owner chose "engineering applies the guarded refresh" in chat on
25 September (`docs/protocol/decisions.md`, same date). It covers these eight
rows of `public.report_templates` in project `zuvloczwgrayonqabnss` and
nothing else: no schema, no other table, no other row.

| Slug | Corrected source |
| --- | --- |
| `alcohol-dependence-aldh2-rs671` | `data/templates/addiction.json` |
| `apoe-e4-alzheimers-risk` | `data/templates/neurodegenerative.json` |
| `breast-cancer-fgfr2-rs2981582` | `data/templates/cancer-risk.json` |
| `caffeine-sleep-adora2a-rs5751876` | `data/templates/brain-health.json` |
| `colorectal-apc-i1307k` | `data/templates/cancer-risk.json` |
| `factor-v-leiden-rs6025` | `data/templates/heart-cardiovascular.json` |
| `trem2-r47h-alzheimers` | `data/templates/neurodegenerative.json` |
| `type-2-diabetes-tcf7l2-rs7903146` | `data/templates/metabolic-obesity.json` |

## The statement

[`refresh.sql`](refresh.sql), SHA-256
`da5591cfafb38ff004b85526cf6585e2bbdb9d9ca506a344984eaadc843da47b`, generated
from `main` `57d6b4efd3247d91f2c144ad90d27ce3ca15d445` and executed unchanged.
One `DO` block, so it commits or rolls back as a whole:

1. `lock_timeout` 1 s, `statement_timeout` 15 s, idle-in-transaction 15 s.
2. Locks the eight rows in slug order.
3. **Predecessor guard:** proceeds only if all eight rows hold the registered
   `previousCommit` text, compared by md5 of title, summary, `variants::text`
   and `citations::text` ([`digests.json`](digests.json), `predecessorMd5`).
4. Updates title, summary, variants, citations and `updated_at` on each row,
   failing unless each update touches exactly one published row.
5. **Successor check:** all eight rows must then equal `main`
   (`successorMd5`), and 162 templates must still be published.

Category, evidence, layer, estimate kind, `pgs_id`, status and `published_at`
are not written; the generator refused to run unless they were identical on
both sides. Variant coordinates and genotype keys are unchanged, so
`ref_variants` needs nothing.

## Sequence, UTC

| Time | Step | Result |
| --- | --- | --- |
| before | Aggregate impact count | 3 completed runs, 24 report items, all capturing the superseded summary; completed 13–25 September. No identities or content read |
| ~12:03 | Dry run: the same block ending in a forced exception (SHA-256 `8123399d…6c03`, differing only in its last line) | `catalog_refresh_dry_run_ok`: guard 8/8, eight single-row updates, successor 8/8, 162 published; rolled back |
| 12:03:20 | Rollback check | All eight still held the old text; `updated_at` still 5 September |
| 12:04:26 | Committing run | Completed without error, so every check in step 3–5 passed |

## After

- **Digests:** all 162 published templates identical to `data/templates` at
  `main`, none only on one side; exactly eight rows carry `updated_at`
  2026-09-25 12:04:26, one transaction.
- **The committed comparison:** `catalogFindings` from
  `scripts/catalog-drift-gate.ts` over all 162 production rows: 162 expected,
  162 deployed, **0 findings**. Before the refresh it reported exactly the eight.
- **Saved reports unchanged:** the same 3 completed runs and 24 captured items
  as before. `private.capture_own_report_catalog_v1` keeps completed results
  immutable, so those three keep the superseded wording and its notice, and
  Copilot still declines those saved contexts, as designed. Every report
  generated from now on captures the corrected text.

## Not claimed

No browser journey was run against production after the refresh, and the
preview project was not compared or changed. Whether the three people with
already-captured reports should be told is the owner's decision; nothing here
contacts anyone.
