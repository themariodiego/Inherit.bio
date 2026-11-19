# Running the guarded PR 323 release over HTTPS

The batch files, their order, their checks and their stop rules are in
`../guarded/README.md`. This runbook changes only the transport. Cloud sessions
reach the internet through an HTTPS-only proxy, so `psql` cannot connect to
Postgres: a TCP connection to the Supabase pooler on port 5432 timed out on 16
October 2026. The owner chose, by clickable answer the same day, to send the
same files to the Supabase Management API SQL endpoint with a personal access
token held as the environment secret `SUPABASE_ACCESS_TOKEN`.

Read-only facts from 16 October 2026, through the Supabase connector, which uses
the same endpoint:

- The endpoint runs as `postgres` with `statement_timeout` `2min`. The batch
  guard accepts any timeout above 0 and at most 180 s, so no `SET` is needed.
- Production's fingerprint summary equals the batch 1 pre-state in all nine
  categories (`../results/2026-10-16-readonly-fingerprint-summary.json`).
- The read-only pre-checks pass every stop rule
  (`../results/2026-10-16-readonly-prechecks.json`).
  - The ledger has 158 rows, max `20260930236000`, and none of the 90 versions.
  - Every `must_be_zero` value is 0.
  - All three registry md5s equal the mirror's.
  - Both `supautils` flags are true, so batch 2 holds the auth and storage
    tables, as rehearsed.
  - `user_variants` holds 4,926,234 rows. None of the 90 migrations rewrites,
    validates, indexes or updates `user_variants` at apply time. The one
    `delete from public.user_variants` sits inside a function body.
  - No adult upload notices or other mail are queued, and no held upload
    exists, so the #85 window cannot fail a real message.
  - One account deletion is in its notice period.

Every request and response stays in the session. Never print, log or commit the
token.

## 0. Preconditions (stop if any fails)

1. PR 323's head has every required check green on one attempt, including the
   aggregate `checks` and the prepared-worker `build`.
2. `git diff --quiet 08a33a0bcdc494e35dcbbd97701782d69a14ce05 <PR 323 head> -- supabase/migrations`
   exits 0, so the rehearsed migration set is unchanged.
3. `SUPABASE_ACCESS_TOKEN` is set. Check with `test -n "$SUPABASE_ACCESS_TOKEN"`;
   never echo it.
4. The owner says go in this session, by one clickable question asked right
   before step 3. Dry runs also take the auth and storage locks.

## 1. Rebuild the batch files and check them

```sh
git fetch origin main codex/density-completion-20261011
git cat-file -e 08a33a0bcdc494e35dcbbd97701782d69a14ce05 && git cat-file -e c993dea81da67e5af9ef6e7e836579a6aa283bdc
cd docs/evidence/pr323-production-apply-20261016/guarded
python3 -I generate.py final >/dev/null
sha256sum -c SHA256SUMS            # every line OK
git status --short .               # only the regenerated, untracked .sql files
cd ../api && sha256sum -c SHA256SUMS
```

`generate.py` reads the migrations from the repository at `/home/user/Inherit.bio`.

## 2. Environment

```sh
export INHERIT_PROD_PROJECT_REF=zuvloczwgrayonqabnss
cd docs/evidence/pr323-production-apply-20261016/guarded
mkdir -p ../results/run && R=../results/run
run() { python3 -I ../api/api-run.py "$@"; echo "rc=$?"; }
```

## 3. Probes (no production change)

```sh
printf "select current_user as u, current_setting('statement_timeout') as t" > $R/p-session.sql
run $R/p-session.sql $R/p-session          # rc=0; body: u postgres, t 2min (any value 1 ms to 180 s)
printf "do \$\$ begin raise exception using message = 'PROBE_ERROR_FORMAT_ONLY'; end \$\$;" > $R/p-error.sql
run $R/p-error.sql $R/p-error              # rc=3; note the exact message format
python3 -I -c "import sys; open(sys.argv[1],'w').write('select length(\$p\$'+'x'*2900000+'\$p\$) as n')" $R/p-size.sql
run $R/p-size.sql $R/p-size                # rc=0 and n=2900000: a 2.9 MB request is accepted
```

- The error probe must show the message as `ERROR:  PROBE_ERROR_FORMAT_ONLY`,
  with or without `P0001: `. If the format differs, adjust only
  `is_sentinel` in `api-run.py`, recompute `../api/SHA256SUMS`, and test it
  against the probe's message before going on.
- If the 2.9 MB probe is refused, try 1.5 MB:
  - If that is accepted, skip step 5 (the whole-release dry run) and record why.
    The per-batch dry runs still prove each batch.
  - If 1.5 MB is also refused, stop. Batch 2 is 1.48 MB as a request.

## 4. Read-only pre-checks and the pre-state

```sh
run production-readonly-prechecks.sql $R/prechecks --json-column prechecks
run fingerprint.sql $R/fp-pre --json-column fp
python3 -I check-readback.py $R/fp-pre.json 1 pre      # EQUAL
```

Apply the README's pre-check stop rules to `$R/prechecks.json`.

## 5. Whole-release dry run

```sh
run all-batches-dry-run.sql $R/dry-all       # rc=3 and "exact dry-run sentinel as the error: True"
run fingerprint.sql $R/fp-after-dry-all --json-column fp
python3 -I check-readback.py $R/fp-after-dry-all.json 1 pre   # EQUAL
```

## 6. Batches 1 to 4, in order, with no pause after batch 3

For each k:

```sh
run batch-$k-dry-run.sql $R/dry-$k           # rc=3, sentinel True
run fingerprint.sql $R/fp-$k-after-dry --json-column fp
python3 -I check-readback.py $R/fp-$k-after-dry.json $k pre   # EQUAL
run batch-$k-apply.sql $R/apply-$k           # rc=0
run fingerprint.sql $R/fp-$k-post --json-column fp
python3 -I check-readback.py $R/fp-$k-post.json $k post       # EQUAL
printf "select count(*) as c, max(version) as m from supabase_migrations.schema_migrations" > $R/ledger.sql
run $R/ledger.sql $R/ledger-$k
```

The expected ledger after each batch is 160 / `20260930236000`, then 216 /
`20261001032000`, 247 / `20261010190500` and 248 / `20261011010251`.

Exit codes map onto the README's stop rules:

| rc | Meaning |
|---|---|
| 0 | psql rc 0 |
| 3 | psql rc 3. For a dry run, it is a pass only when the sentinel line says True. For an apply, the statement rolled back as a whole: read back. The state must equal the batch's pre-state. Retry only `canceling statement due to lock timeout` or `deadlock detected`, from that batch's dry run. |
| 124 | psql rc 124, outcome unknown. Wait two minutes for the server's statement timeout, then read back. The state must be exactly the pre-state or exactly the post-state, with a matching ledger. Anything else: stop. |

Any read-back that is not EQUAL: stop. Do not run the next batch, and do not
merge.

## 7. Merge and deploy straight after batch 4

1. Mark PR 323 ready for review, and merge it with a merge commit.
2. Watch the Vercel production deployment of the merge commit until it is READY
   and `inherit.bio` points at it.
3. Watch `main`'s CI run on the merge commit.
4. Read the fingerprint again. It must still be EQUAL to batch 4 post.
5. Read the Vercel production environment variable names. Never read values.
6. Retarget PR 324 to `main`.

## 8. After the deploy (read-only)

These are the D-081 checks for G8.5:

- `GET https://inherit.bio/withdraw/retired-synthetic-invitation-token` returns 404.
- `GET /withdraw/request` returns 200.
- `GET /withdraw/session` without a cookie returns 404.
- `HEAD /api/withdraw` returns 404.

Record status codes only.

## 9. Evidence, then the credential

1. Commit `$R` under `../results/run-<UTC date>/` on the PR 324 branch:
   status files, bodies, read-backs and a short log of every rc. Leave out the
   token and the regenerated `.sql` files. Run `git pull --no-rebase` before
   pushing.
2. Comment on PR 323 with the results.
3. Tell the owner to revoke the token in the Supabase dashboard and to delete
   `SUPABASE_ACCESS_TOKEN` from the environment. Also delete
   `PRODUCTION_DATABASE_URL` if it was added. It cannot work from these sessions.
