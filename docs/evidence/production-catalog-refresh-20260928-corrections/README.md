# Production report catalog refresh: six-report corrections, 28 September 2026

The production half of #254. The owner chose on 28 September to correct six
reports that contradict their sources through the scientific-corrections path
(`docs/protocol/decisions.md`, from #241). Production serves report text from
`public.report_templates`, which a deploy does not refresh (D-134). This
record is the guarded refresh that brought those rows to `main`, and the checks
that it did exactly that.

## Scope

Seven rows of `public.report_templates` in project `zuvloczwgrayonqabnss`, and
nothing else: no schema, no other table, no other row.

| Slug | Change |
| --- | --- |
| `nicotine-dependence-chrna5-rs16969968` | Citation corrected (PMID 17158188 to 17135278) and dated. Prose unchanged |
| `caffeine-intake-ahr-rs4410790` | Wrong paper replaced (21357676 to 21490707). Summary and CC reduced to the source |
| `photic-sneeze-reflex-zeb2` | Summary, CC and TT corrected: the two studies point to opposite alleles. Wang 2019 dated |
| `motion-sickness-susceptibility` | rs66800491 AA and GG direction reversed to match Hromatka 2015 |
| `chronotype-per3-rs228697` | Summary and CG corrected (free-running type, Pro864Ala). Hida 2014 dated |
| `photic-sneeze-reflex-2q22` | Citation dated only (Wang 2019). Prose unchanged |
| `asparagus-odor-detection-or2m7` | Citation dated only (Markt 2016). Prose unchanged |

The review notes are under `docs/sources/reviews/*-correction-20260928.md`.
The old text of every changed report-body field is in
`data/report-scientific-corrections.json`, so a saved report that captured it
shows the correction notice.

## The statement

[`refresh.sql`](refresh.sql), SHA-256
`786cf8c1845bda68646e10508e08f061a28c59075bc75ed7bc1b1d355880819f`, executed
unchanged.

- It was generated from `data/templates` at `main` `1291052f` (predecessor,
  what production held after the citation-date refresh) and at `162c2a30`
  (successor, the #254 head, whose templates `main` now carries).
- The generator refused to run unless exactly these seven of the 162 published
  templates differed, and unless category, evidence, layer, estimate kind,
  `pgs_id` and every variant's position and alleles were identical on both
  sides.

One `DO` block, so it commits or rolls back as a whole:

1. `lock_timeout` 1 s, `statement_timeout` 15 s, idle-in-transaction 15 s.
2. Locks the seven rows in slug order.
3. **Predecessor guard:** proceeds only if all seven rows hold the predecessor
   text. The comparison is by md5 of title, summary, `variants::text` and
   `citations::text` ([`digests.json`](digests.json), `predecessorMd5`).
4. Writes title, summary, variants, citations and `updated_at`. It fails
   unless each update touches exactly one published row.
5. **Successor check:** all seven rows must then equal the successor
   (`successorMd5`), and 162 templates must still be published.

## Sequence, UTC, 28 September

| Time | Step | Result |
| --- | --- | --- |
| before | Local rehearsal, one rolled-back transaction: the executed CF refresh, the citation-date refresh, then this statement | Whole-catalogue digest `bc30e004…180b`, seven rows in the successor state |
| 13:30 | #254 merged to `main` | |
| 13:31–13:34 | Read-only pre-check on production | Whole-catalogue digest `e024bd182f979efb6852617f59b8ee9e` (the predecessor); 162 published; no analysis run in flight. Aggregates only |
| 13:31–13:34 | Dry run: the same block ending in a forced exception (SHA-256 `e24f8b02fe3db735ddc6bf40cf33f6f1c4e3dbbe62da1f6c7ac92c4e8c6dc999`, differing only in its last line) | `catalog_refresh_dry_run_ok`; rolled back |
| 13:34 | Committing run | Completed without error, so every check in steps 3–5 passed |

## After

- **The whole catalogue equals `main`:** production gives
  `bc30e004a1d6f6680349e52ce345180b` over 162 rows, and so does
  `data/templates` at `162c2a30`.
- **Exactly seven rows changed**, all with one `updated_at`,
  `2026-09-28 13:34:38.758307+00`: one transaction.
- **Saved reports are unchanged.** `private.capture_own_report_catalog_v1`
  keeps completed results immutable. Saved copies of the four reports whose
  wording changed keep the wording they captured. The correction notice shown
  on them comes from the deployed register, not from this table. The count of
  those saved items was the same before and after the refresh.

## Not claimed

- `scripts/catalog-drift-gate.ts` itself was not run against production. The
  digest comparison above covers the same fields.
- No browser journey was run against production after the refresh, so the
  notice on a saved report was not checked in a browser.
- The preview project was not compared or changed.
- Nobody is contacted, as the owner decided for the 25 and 27 September
  refreshes.
