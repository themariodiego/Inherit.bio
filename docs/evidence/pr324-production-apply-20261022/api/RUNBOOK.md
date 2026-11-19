# Running the guarded PR 324 release over HTTPS

The batch files, their order, their checks and their stop rules are in
`../guarded/README.md`. The transport is the one the PR 323 release used on
22 October 2026 (`../../pr323-production-apply-20261016/api/RUNBOOK.md`,
results in `../../pr323-production-apply-20261016/results/run-2026-10-22/`): the
Supabase Management API SQL endpoint, project `zuvloczwgrayonqabnss`, with a
personal access token held as the environment secret `SUPABASE_ACCESS_TOKEN`.
Cloud sessions reach the internet only through an HTTPS proxy, so `psql` cannot
connect to Postgres. `api-run.py` is byte-identical to the runner used on
22 October (SHA-256 `caf4168b…0a45`).

Facts carried over from the 22 October release (read through this endpoint):

- The endpoint runs as `postgres` with `statement_timeout` `2min`, and reports
  an error as `ERROR:  P0001: <message>`, which `is_sentinel` accepts. A 2.9 MB
  request was accepted.
- After PR 323 merged, production read back EQUAL to PR 323's batch-4
  post-state. That full read-back (`fp-after-merge.json`) is this release's
  pre-state: the rehearsal mirror equals it object for object, all 1,245 function
  definitions included.
- The ledger is 248 rows, max `20261011010251`.
- `INHERIT_TEST_JURISDICTION` is not among Vercel's production variables.

Every request and response stays in the session. Never print, log or commit the
token.

## 0. Preconditions (stop if any fails)

1. PR 324's final head has every required check green on one attempt,
   including the aggregate `checks` and the prepared-worker `build`.
2. Its migration tree is the rehearsed one (later commits that change only tests
   or documents are fine):
   `git diff --quiet 538dcee66a1595df11ca0937512e0efed2ced85c <PR 324 head> -- supabase/migrations`
   exits 0. Step 1 checks the same thing again through `generate.py --head`.
3. `SUPABASE_ACCESS_TOKEN` is set, and it is a new token: the 22 October one is
   to be revoked. Check with `test -n "$SUPABASE_ACCESS_TOKEN"`; never echo it.
4. The owner says go in this session, by one clickable question asked after
   step 4's results are shown and before step 5. The dry runs take the same
   locks as the applies (`../guarded/README.md`, "Locks").

## 1. Rebuild the batch files and check them

```sh
git fetch origin main claude/magical-bohr-2qgad6
git cat-file -e 538dcee66a1595df11ca0937512e0efed2ced85c && git cat-file -e 12f24475094653afe8f9935b75f352d76012b1b4
HEAD_324=$(git rev-parse origin/claude/magical-bohr-2qgad6)
cd docs/evidence/pr324-production-apply-20261022/guarded
python3 -I generate.py --head "$HEAD_324" final >/dev/null   # refuses unless HEAD_324's migration tree is 538dcee6's
sha256sum -c SHA256SUMS            # every line OK
git status --short .               # only the regenerated, untracked .sql files
cd ../api && sha256sum -c SHA256SUMS
```

`generate.py` reads the migrations with `git show` from the repository it lives
in, so it works from any checkout or worktree of the repository.

## 2. Environment

```sh
export INHERIT_PROD_PROJECT_REF=zuvloczwgrayonqabnss
cd docs/evidence/pr324-production-apply-20261022/guarded
mkdir -p ../results/run && R=../results/run
run() { python3 -I ../api/api-run.py "$@"; rc=$?; echo "$(date -u +%FT%TZ) $* rc=$rc" | tee -a $R/rc.log; return $rc; }
```

## 3. Probes (no production change)

```sh
printf "select current_user as u, current_setting('statement_timeout') as t, current_setting('search_path') as p" > $R/p-session.sql
run $R/p-session.sql $R/p-session          # rc=0; u postgres, t 2min (anything from 1 ms to 180 s passes the guard)
printf "do \$\$ begin raise exception using message = 'PROBE_ERROR_FORMAT_ONLY'; end \$\$;" > $R/p-error.sql
run $R/p-error.sql $R/p-error              # rc=3; ERROR:  P0001: PROBE_ERROR_FORMAT_ONLY
```

If the error format is not `ERROR:  PROBE_ERROR_FORMAT_ONLY` with or without
`P0001: `, change only `is_sentinel` in `api-run.py`, recompute
`../api/SHA256SUMS`, and test it against the probe's message before going on.
The largest request of this release is 689,812 bytes (`all-batches-dry-run.sql` as a request; batch 2, the largest batch, is 344,905), well under the 2.9 MB
accepted on 22 October, so no size probe is needed.

## 4. Read-only pre-checks and the pre-state

```sh
run production-readonly-prechecks.sql $R/prechecks --json-column prechecks
run fingerprint.sql $R/fp-pre --json-column fp
python3 -I check-readback.py $R/fp-pre.json 1 pre      # EQUAL
```

Apply the pre-check stop rules in `../guarded/README.md` to `$R/prechecks.json`
("Pre-check stop rules"): among them, all twelve `guards` entries `ok` with
their rehearsed md5, every `must_be_zero` value 0, and the six `registry_md5`
values equal to the mirror's. Show the owner the results, then ask for go.

## 5. Whole-release dry run

```sh
run all-batches-dry-run.sql $R/dry-all       # rc=3 and "exact dry-run sentinel as the error: True"
run fingerprint.sql $R/fp-after-dry-all --json-column fp
python3 -I check-readback.py $R/fp-after-dry-all.json 1 pre   # EQUAL
```

## 6. The batches, in order

Four batches: #1-#5, #6-#11, #12-#24, #25. No batch boundary is unsafe for
main's deployed code (`../compat-analysis.md`), so a stop after any batch leaves
production serving correctly; resume later from the next batch's dry run.
Batch 4 holds an ACCESS EXCLUSIVE lock on `public.subjects` until it commits, so
choose a quiet minute for it.

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

The expected ledger after each batch is 253 / `20261016175000`, then 259 /
`20261016196000`, 272 / `20261016220000` and 273 / `20261016221000`.

Exit codes map onto the README's stop rules:

| rc | Meaning |
|---|---|
| 0 | psql rc 0 |
| 3 | psql rc 3. For a dry run, it is a pass only when the sentinel line says True. For an apply, the statement rolled back as a whole: read back. The state must equal the batch's pre-state. Retry only `canceling statement due to lock timeout` or `deadlock detected`, from that batch's dry run. |
| 124 | psql rc 124, outcome unknown. Wait two minutes for the server's statement timeout, then read back. The state must be exactly the pre-state or exactly the post-state, with a matching ledger. Anything else: stop. |

Any read-back that is not EQUAL: stop. Do not run the next batch, and do not
merge.

## 7. Merge and deploy

Straight after batch 4 reads back EQUAL, and while the fingerprint still equals
batch 4's post-state. Main's code stays compatible meanwhile, but PR 324's code
needs all 25 migrations, so do not leave the merge for later.

1. Mark PR 324 ready for review, and merge it with a merge commit.
2. Watch the Vercel production deployment of the merge commit until it is READY
   and `inherit.bio` points at it.
3. Watch `main`'s CI run, and the Deploy Cloudflare run, on the merge commit.
4. Read the fingerprint again. It must still be EQUAL to the last batch's post-state.
5. Read the Vercel production environment variable names. Never read values.

## 8. Evidence, then the credential

1. Commit `$R` under `../results/run-<UTC date>/` on a branch for the evidence:
   status files, bodies, read-backs, `rc.log` and a short README of what was run
   and seen. Leave out the token and the regenerated `.sql` files. Run
   `git pull --no-rebase` before pushing.
2. Comment on PR 324 with the results.
3. Tell the owner to revoke the token in the Supabase dashboard and to delete
   `SUPABASE_ACCESS_TOKEN` from the environment.
