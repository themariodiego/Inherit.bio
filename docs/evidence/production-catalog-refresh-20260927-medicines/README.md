# Production report catalog refresh: Medicines, 27 September 2026

The delivery half of "Medicines reports lead with the gene"
(`docs/protocol/decisions.md`, 26 September, evening). Pull request #229 changed
the text of all eleven Medicines templates in `data/templates/medicines.json`
and merged as `9acfb1c4`. Production serves report text from
`public.report_templates`, which a deploy does not refresh (D-134). This record
is the guarded refresh that brought those eleven rows to `main`, and the
checks that it did exactly that.

## Authorization and scope

The owner chose "Yes, guarded refresh" in chat on 26 September, as a
selectable option: the same procedure as the 25 September refresh
(`../production-catalog-refresh-20260925/`). It covers these eleven rows of
`public.report_templates` in project `zuvloczwgrayonqabnss` and nothing else:
no schema, no other table, no other row.

| Slug | Title before | Title after |
| --- | --- | --- |
| `cyp2c19-rs12248560-one-position` | Clopidogrel, one CYP2C19 position | CYP2C19, one position |
| `cyp2c19-rs4244285-one-position` | Clopidogrel, the *2 position · CYP2C19 | CYP2C19, the *2 position |
| `cyp2c9-rs1057910-one-position` | Warfarin and NSAIDs, the *3 position · CYP2C9 | CYP2C9, the *3 position |
| `cyp2c9-rs1799853-one-position` | Warfarin and NSAIDs, the *2 position · CYP2C9 | CYP2C9, the *2 position |
| `cyp3a5-rs776746-one-position` | Tacrolimus, the *3 position · CYP3A5 | CYP3A5, the *3 position |
| `dpyd-rs3918290-one-position` | Fluorouracil and capecitabine, the *2A position · DPYD | DPYD, the *2A position |
| `nudt15-rs116855232-one-position` | Thiopurines, one position · NUDT15 | NUDT15, one position |
| `slco1b1-rs4149056-one-position` | Statins, the *5 position · SLCO1B1 | SLCO1B1, the *5 position |
| `tpmt-rs1800460-one-position` | Thiopurines, another position · TPMT | TPMT, another position |
| `tpmt-rs1800462-one-position` | Thiopurines, the *2 position · TPMT | TPMT, the *2 position |
| `vkorc1-rs9923231-one-position` | Warfarin, one position · VKORC1 | VKORC1, one position |

Summaries changed on all eleven; letter readings changed on VKORC1 only.
Citations were written but are unchanged.

## The statement

[`refresh.sql`](refresh.sql), SHA-256
`f0fe582d5ed2029822a3c09c6bfce202a15a350cd05573df3d3e8dd7dbfb91cb`, generated
from `data/templates/medicines.json` at `bab8d7b7` (predecessor) and at `main`
`9acfb1c46f9d9ec3d5e51ae36eae4d7460f5e9e9` (successor), and executed
unchanged. One `DO` block, so it commits or rolls back as a whole:

1. `lock_timeout` 1 s, `statement_timeout` 15 s, idle-in-transaction 15 s.
2. Locks the eleven rows in slug order.
3. **Predecessor guard:** proceeds only if all eleven rows hold the
   `bab8d7b7` text, compared by md5 of title, summary, `variants::text` and
   `citations::text` ([`digests.json`](digests.json), `predecessorMd5`).
4. Updates title, summary, variants, citations and `updated_at` on each row,
   failing unless each update touches exactly one published row.
5. **Successor check:** all eleven rows must then equal `main`
   (`successorMd5`), and 162 templates must still be published.

Category, evidence, layer, estimate kind, `pgs_id`, status and `published_at`
are not written; the generator refused to run unless they were identical on
both sides. Variant coordinates and genotype keys are unchanged, so
`ref_variants` needs nothing. The generator also checked that
`medicines.json` at `main` is byte-identical to the #229 head `0917db84`.

## Sequence, UTC, 27 September

| Time | Step | Result |
| --- | --- | --- |
| before | Read-only pre-check | All eleven rows held the predecessor text and none the successor; 162 published, 11 of them Medicines; every run `complete`, none in flight; 4 completed runs holding 44 captured Medicines items. Aggregates only; no identities or report content read |
| ~08:47 | Dry run: the same block ending in a forced exception (SHA-256 `3d30ca83…9892`, differing only in its last line) | `catalog_refresh_dry_run_ok`: guard 11/11, eleven single-row updates, successor 11/11, 162 published; rolled back |
| 08:47:21 | Rollback check | All eleven still held the old titles; `updated_at` still 5 September |
| 08:49:00 | Committing run | Completed without error, so every check in steps 3–5 passed |

## After

- **The whole catalog equals `main`.** Each side computed one md5 over every
  published row in byte order of slug. Each row contributed its slug,
  category, evidence, layer, estimate kind and `pgs_id`, plus md5s of title,
  summary, `variants::text` and `citations::text`.
  - Production gave `1baafae935abf7af2ca4c56ea8fd2598` over 162 rows.
  - `data/templates` at `main`, rendered the way Postgres renders `jsonb`,
    gave the same value over 162 rows.
  - The eleven Medicines rows alone also match: `d33a7d86…3213`.
- **Exactly eleven rows changed**, all Medicines, with one `updated_at`,
  2026-09-27 08:49:00.352617: one transaction.
- **Saved reports unchanged:** the same 4 completed runs and 44 captured
  Medicines items as before. `private.capture_own_report_catalog_v1` keeps
  completed results immutable, so those four keep the drug-first titles they
  captured. Every report generated from now on captures the gene-first text.

## Not claimed

- `scripts/catalog-drift-gate.ts` itself was not run: this session has no
  database URL for it. The digest comparison above covers the same fields.
- No browser journey was run against production after the refresh.
- The preview project was not compared or changed.
- Whether the people with already-captured reports should be told is the
  owner's decision; nothing here contacts anyone.
