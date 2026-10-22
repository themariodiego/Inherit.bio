# PR 323 guarded production release, 22 October 2026 (UTC)

Transport: Supabase Management API SQL endpoint (`../../api/api-run.py`), project
`zuvloczwgrayonqabnss`, following `../../api/RUNBOOK.md` and `../../guarded/README.md`.
Every rc is in `rc.log` (timestamps are taken when each request returned). Each
request's HTTP code is in `<name>.status` and its raw response in `<name>.body`;
fingerprint read-backs are also in `<name>.json`. The regenerated `.sql` files and
the token are not included.

## Preconditions (step 0, rechecked in this session)

- PR 323 head `ec734a87`, 15/15 checks success; main `c993dea8`.
- `git diff --quiet 08a33a0b ec734a87 -- supabase/migrations`: rc 0.
- `generate.py final` rc 0; `guarded/SHA256SUMS` and `api/SHA256SUMS` all OK.

## Read-only pre-checks and pre-state (step 4, before the owner's go)

- `prechecks.json`: `current_user` postgres, `statement_timeout` 2min; ledger 158 /
  `20260930236000`, 0 release versions; every `must_be_zero` 0; the three
  `registry_md5` values equal the mirror's; both `supautils_*` flags true.
  Context: 0 queued adult upload notices, 0 queued or claimed mail, 0 held uploads,
  1 pending account deletion. `user_variants` 6,108,562 rows.
- `fp-pre.json`: EQUAL batch 1 pre-state summary.

The owner said go by one clickable answer after these results were shown.

## Probes (step 3)

- `p-session`: rc 0, `postgres` / `2min`.
- `p-error`: rc 3, `ERROR:  P0001: PROBE_ERROR_FORMAT_ONLY`; `is_sentinel` already
  accepts the `P0001: ` prefix, so `api-run.py` was not changed.
- `p-size`: rc 0, n = 2,900,000 (a 2.9 MB request is accepted).

## Whole-release dry run (step 5)

`dry-all`: rc 3, sentinel True. `fp-after-dry-all`: EQUAL batch 1 pre.

## Batches (step 6)

| Batch | Dry run | After dry | Apply | Post | Ledger |
|---|---|---|---|---|---|
| 1 | rc 3, sentinel True | EQUAL pre | rc 0 | EQUAL post | 160 / 20260930236000 |
| 2 | rc 3, sentinel True | EQUAL pre | rc 0 | EQUAL post | 216 / 20261001032000 |
| 3 | rc 3, sentinel True | EQUAL pre | rc 0 | EQUAL post | 247 / 20261010190500 |
| 4 | rc 3, sentinel True | EQUAL pre | rc 0 | EQUAL post | 248 / 20261011010251 |

No retries. Batches 3 and 4 ran back to back.

## Merge and deploy (step 7)

- PR 323 marked ready and merged with a merge commit: `97a13f10191631c405c45ad649a0808a75d1e3d1`.
- Vercel production deployment `dpl_9QJftReuUqaQm4vThyhvZLRCiBhk` for that commit:
  READY, aliased to `inherit.bio` and `www.inherit.bio`.
- `fp-after-merge`: EQUAL batch 4 post.
- Vercel production environment variable names (no values): `vercel-production-env-names.txt`.
  `INHERIT_TEST_JURISDICTION` is not set.
- main CI run 39796150441 on the merge commit: in progress when this was committed.
- PR 324 retargeted to `main` (not merged).

## D-081 checks (step 8)

`d081-status.txt`: retired token 404, `/withdraw/request` 200, `/withdraw/session`
without a cookie 404, `HEAD /api/withdraw` 404. All as expected.
