# Running the guarded follow-up release over HTTPS

The batch files, their order, their checks and their stop rules are in
`../guarded/README.md`. The transport is the one the PR 323 release used on
22 October 2026 and PR 324's kit prescribes
(`../../pr324-production-apply-20261022/api/RUNBOOK.md`): the Supabase Management API
SQL endpoint, project `zuvloczwgrayonqabnss`, with a personal access token held as the
environment secret `SUPABASE_ACCESS_TOKEN`. Cloud sessions reach the internet only
through an HTTPS proxy, so `psql` cannot connect to Postgres. `api-run.py` is
byte-identical to the runner used on 22 October and in PR 324's kit (SHA-256
`caf4168b…0a45`).

**This release runs only after PR 324's.** Its pre-state is PR 324's rehearsed batch-4
post-state, and its ledger check expects 273 rows, max `20261016221000`. Every batch
refuses on the ledger before PR 324's release (rehearsed: `../rehearsal/data/negatives.tsv`).

Facts carried over (from the 22 October release, through this endpoint):

- The endpoint runs as `postgres` with `statement_timeout` `2min`, and reports an
  error as `ERROR:  P0001: <message>`, which `is_sentinel` accepts. A 2.9 MB request
  was accepted; this release's largest request is 122,391 bytes (`all-batches-dry-run.sql`).
- The API transport stores function bodies exactly as sent, comments included (PR 324
  kit, "Function bodies"). 14 of this release's guards check bodies PR 324's release
  writes, and 11 of the 19 guarded bodies contain full-line comments, so a transport
  that dropped comments would make those guards refuse (rehearsed:
  `../rehearsal/data/negatives.tsv`).

Every request and response stays in the session. Never print, log or commit the token.

## 0. Preconditions (stop if any fails)

1. **PR 324's release is complete:** its `results/run-<date>/` shows batch 4 applied,
   the batch-4 post read-back EQUAL, the ledger 273 / `20261016221000`, and PR 324
   merged and deployed with the fingerprint still EQUAL to its batch-4 post-state
   (PR 324 RUNBOOK, step 7.4).
2. The follow-up PR's final head has every required check green on one attempt,
   including the aggregate `checks` and the prepared-worker `build`.
3. Its migration tree is the rehearsed one (later commits that change only tests or
   documents are fine):
   `git diff --quiet 77d04563e3d568571215284afb8a3aae47b02d56 <follow-up head> -- supabase/migrations`
   exits 0. Step 1 checks the same thing again through `generate.py --head`.
4. `SUPABASE_ACCESS_TOKEN` is set, and it is a new token: the one used for PR 324's
   release is to be revoked. Check with `test -n "$SUPABASE_ACCESS_TOKEN"`; never echo it.
5. The owner says go in this session, by one clickable question asked after step 4's
   results are shown and before step 5. The dry runs take the same locks as the
   applies (`../guarded/README.md`, "Locks").

## 1. Rebuild the batch files and check them

```sh
git fetch origin <follow-up branch>
git cat-file -e 77d04563e3d568571215284afb8a3aae47b02d56 && git cat-file -e 538dcee66a1595df11ca0937512e0efed2ced85c
HEAD_FU=$(git rev-parse origin/<follow-up branch>)
cd docs/evidence/followup-production-apply-20261023/guarded
python3 -I generate.py --head "$HEAD_FU" final >/dev/null   # refuses unless HEAD_FU's migration tree is 77d04563's
sha256sum -c SHA256SUMS            # every line OK (14 lines, ../api/api-run.py included)
git status --short .               # nothing: the regenerated .sql files are ignored
cd ../api && sha256sum -c SHA256SUMS
```

`generate.py` reads the migrations with `git show` from the repository it lives in, so
it works from any checkout or worktree of the repository. It also refuses if PR 324's
kit (`../../pr324-production-apply-20261022/guarded/expected-summaries.json`) no longer
gives the pre-state summary and the 273-row ledger it pins.

## 2. Environment

```sh
export INHERIT_PROD_PROJECT_REF=zuvloczwgrayonqabnss
cd docs/evidence/followup-production-apply-20261023/guarded
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
`P0001: `, change only `is_sentinel` in `api-run.py`, recompute `../api/SHA256SUMS` and
the `../api/api-run.py` line of `SHA256SUMS`, and test it against the probe's message
before going on. No size probe is needed.

## 4. Read-only pre-checks and the pre-state

```sh
run production-readonly-prechecks.sql $R/prechecks --json-column prechecks
run fingerprint.sql $R/fp-pre --json-column fp
python3 -I check-readback.py $R/fp-pre.json 1 pre      # EQUAL (PR 324's batch-4 post-state)
run ../../../../scripts/tools/d081-retirement-precheck.sql $R/d081 --json-column no_unexpired_pre_cutover_invitations
cat $R/d081.json                                       # true
```

The last line is D-081's release-time check (G8.5). The withdrawal compatibility
routes were retired on `main` by PR #280, and the 1 October pre-merge receipt for that
check was never recorded. The query cannot recreate that receipt. It confirms only that
no adult invitation created before the 13 September cutover is still unexpired, and it
returns one boolean and no user data. `false`, or any rc but 0: stop and tell the owner.

Apply the pre-check stop rules in `../guarded/README.md` to `$R/prechecks.json`
("Pre-check stop rules"): among them the ledger 273 / `20261016221000` with all 25 of
PR 324's versions and none of this release's, all 19 `guards` entries `ok` with their
rehearsed md5, and every `must_be_zero` and `compat_must_be_zero` value 0. Show the
owner the results, then ask for go.

## 5. Whole-release dry run

```sh
run all-batches-dry-run.sql $R/dry-all       # rc=3 and "exact dry-run sentinel as the error: True"
run fingerprint.sql $R/fp-after-dry-all --json-column fp
python3 -I check-readback.py $R/fp-after-dry-all.json 1 pre   # EQUAL
```

## 6. The batches, in order

Two batches: #1-#4, #5-#7. Neither boundary is unsafe for PR 324's deployed code
(`../compat-analysis.md`), so a stop after batch 1 leaves production serving
correctly; resume later from batch 2's dry run. Batch 2 holds an ACCESS EXCLUSIVE lock
on `public.account_operation_nonces` until it commits, so choose a quiet minute for it.

For each k in 1 2:

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

The expected ledger after batch 1 is 277 / `20261023110000`, after batch 2 280 /
`20261023140000`.

Exit codes map onto the README's stop rules:

| rc | Meaning |
|---|---|
| 0 | psql rc 0 |
| 3 | psql rc 3. For a dry run, it is a pass only when the sentinel line says True. For an apply, the statement rolled back as a whole: read back. The state must equal the batch's pre-state. Retry only `canceling statement due to lock timeout` or `deadlock detected`, from that batch's dry run. |
| 124 | psql rc 124, outcome unknown. Wait two minutes for the server's statement timeout, then read back. The state must be exactly the pre-state or exactly the post-state, with a matching ledger. Anything else: stop. |

Any read-back that is not EQUAL: stop. Do not run the next batch, and do not merge.

## 7. Merge and deploy

Straight after batch 2 reads back EQUAL, and while the fingerprint still equals batch
2's post-state. PR 324's code stays compatible meanwhile, but the follow-up's code
needs all 7 migrations, so do not leave the merge for later.

1. Mark the follow-up PR ready for review, and merge it with a merge commit.
2. Watch the Vercel production deployment of the merge commit until it is READY and
   `inherit.bio` points at it.
3. Watch `main`'s CI run, and the Deploy Cloudflare run, on the merge commit.
4. Read the fingerprint again. It must still be EQUAL to batch 2's post-state.
5. Read the Vercel production environment variable names. Never read values.
6. D-081's retired routes, status codes only (no body is read or kept):

   ```sh
   for r in "GET /withdraw/retired-synthetic-invitation-token 404" "GET /withdraw/request 200" \
            "GET /withdraw/session 404" "HEAD /api/withdraw 404"; do
     set -- $r
     if [ "$1" = HEAD ]; then m=--head; else m=--get; fi   # -X HEAD would wait for a body
     got=$(curl -sS -o /dev/null -w '%{http_code}' $m --max-time 30 "https://inherit.bio$2")
     echo "$1 $2 expected $3 got $got" | tee -a $R/d081-status.log
   done
   ```

   `/withdraw/session` is requested without a cookie. Any code other than the expected
   one: stop and tell the owner. The release is already applied by then, so change
   nothing.

## 8. Evidence, then the credential

1. Commit `$R` under `../results/run-<UTC date>/` on a branch for the evidence: status
   files, bodies, read-backs, `rc.log` and a short README of what was run and seen.
   Leave out the token and the regenerated `.sql` files. Run `git pull --no-rebase`
   before pushing.
2. Comment on the follow-up PR with the results.
3. Tell the owner to revoke the token in the Supabase dashboard and to delete
   `SUPABASE_ACCESS_TOKEN` from the environment.
