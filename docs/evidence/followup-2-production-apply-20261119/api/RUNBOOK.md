# Running the guarded release after the follow-up over HTTPS

The batch files, their order, their checks and their stop rules are in
`../guarded/README.md`. The transport is the one the PR 323 release used on
22 October 2026 and the PR 324 and follow-up kits prescribe
(`../../followup-production-apply-20261023/api/RUNBOOK.md`): the Supabase Management
API SQL endpoint for the production project, with a personal access token held as the
environment secret `SUPABASE_ACCESS_TOKEN`. Cloud sessions reach the internet only
through an HTTPS proxy, so `psql` cannot connect to Postgres. `api-run.py` is
byte-identical to the runner used on 22 October and in both earlier kits (SHA-256
`caf4168b…0a45`).

**This release runs only after the follow-up's release, and after code carrying the
follow-up's migration tree is merged and deployed.** Its pre-state is the follow-up's
rehearsed batch-2 post-state, and its ledger check expects 280 rows, max
`20261023140000`. Every batch refuses on the ledger before the follow-up's release
(rehearsed: `../rehearsal/data/negatives.tsv`).

Facts carried over (from the 22 October release, through this endpoint):

- The endpoint runs as `postgres` with `statement_timeout` `2min`, and reports an error
  as `ERROR:  P0001: <message>`, which `is_sentinel` accepts. A 2.9 MB request was
  accepted; this release's largest request is 60,485 bytes (`all-batches-dry-run.sql`).
- The API transport stores function bodies exactly as sent, comments included (PR 324
  kit, "Function bodies"). 10 of this release's 11 guarded bodies are production's own
  bodies as read back on 22 October; the 11th is the follow-up's consumer. One of the 10,
  `private.current_adult_subject_invitation_v1`, is among the 8 production holds
  comment-stripped; `20261025400000` accepts it in that form or the repository's (the
  first rehearsal found it pinned to the repository's only: `../guarded/README.md`, "The
  defect the first rehearsal found, and the fix").
- The session's `search_path` has not been read through this endpoint yet (PR 323's
  probe did not ask for it). Step 3 reads it. One guard of this release depends on it
  (`../guarded/README.md`, "The md5 guards").

Every request and response stays in the session. Never print, log or commit the token.

## 0. Preconditions (stop if any fails)

1. **The follow-up's release is complete:** its `results/run-<date>/` shows batch 2
   applied, the batch-2 post read-back EQUAL, and the ledger 280 / `20261023140000`.
2. **The follow-up's code is merged and deployed, and production still reads back
   EQUAL** to the follow-up's batch-2 post-state after that deployment (follow-up
   RUNBOOK, step 7.4). The merged commit carries exactly the follow-up's migration tree
   (`git rev-parse <merged commit>:supabase/migrations` is
   `259a56ddacc2a00e5ab2ce6913e8f237c2d58315`). **Open point for the owner, not decided
   here:** the follow-up branch's head no longer carries that tree (from `6f9ca860` on it
   carries this release's files), so the follow-up kit's own precondition refuses it; the
   last commit of that branch with the follow-up's tree is `e81bd2be`. The alternatives
   seen are listed in `../guarded/README.md`, "Open point for the owner".
3. The head to be merged after this release has every required check green on one
   attempt, including the aggregate `checks` and the prepared-worker `build`.
4. Its migration tree is the rehearsed one (later commits that change only tests or
   documents are fine): `git rev-parse <head>:supabase/migrations` is
   `be49d283ec9a435c635ca54f28986d4676886910`, which is `d8dcb61a`'s with the revised
   `20261025400000`. `d8dcb61a` itself, and every head up to `61ffc6ee`, do not carry it.
   Step 1 checks the same thing again through `generate.py --head`.
5. `SUPABASE_ACCESS_TOKEN` is set, and it is a new token: the one used for the
   follow-up's release is to be revoked. Check with `test -n "$SUPABASE_ACCESS_TOKEN"`;
   never echo it.
6. The owner says go in this session, by one clickable question asked after step 4's
   results are shown and before step 5. The dry runs take the same locks as the
   applies (`../guarded/README.md`, "Locks").

## 1. Rebuild the batch files and check them

```sh
git fetch origin <branch to merge>
git cat-file -e 77d04563e3d568571215284afb8a3aae47b02d56
HEAD_M=$(git rev-parse origin/<branch to merge>)
cd docs/evidence/followup-2-production-apply-20261119/guarded
python3 -I generate.py --head "$HEAD_M" final >/dev/null   # refuses unless HEAD_M is a commit whose migration tree is be49d283...
sha256sum -c SHA256SUMS            # every line OK (14 lines, ../api/api-run.py included)
git status --short .               # nothing: the regenerated .sql files are ignored
cd ../api && sha256sum -c SHA256SUMS
```

`generate.py` reads the migrations with `git show` from the repository it lives in, so
it works from any checkout or worktree of the repository. It also refuses if the
follow-up's kit (`../../followup-production-apply-20261023/guarded/expected-summaries.json`)
no longer gives the pre-state summary and the 280-row ledger it pins.

## 2. Environment

```sh
export INHERIT_PROD_PROJECT_REF=<the production project ref, as the follow-up RUNBOOK's step 2 sets it>
cd docs/evidence/followup-2-production-apply-20261119/guarded
mkdir -p ../results/run && R=../results/run
run() { python3 -I ../api/api-run.py "$@"; rc=$?; echo "$(date -u +%FT%TZ) $* rc=$rc" | tee -a $R/rc.log; return $rc; }
```

## 3. Probes (no production change)

```sh
printf "select current_user as u, current_setting('statement_timeout') as t, current_setting('search_path') as p" > $R/p-session.sql
run $R/p-session.sql $R/p-session          # rc=0; u postgres, t 2min (anything from 1 ms to 180 s passes the guard); p must name public
printf "do \$\$ begin raise exception using message = 'PROBE_ERROR_FORMAT_ONLY'; end \$\$;" > $R/p-error.sql
run $R/p-error.sql $R/p-error              # rc=3; ERROR:  P0001: PROBE_ERROR_FORMAT_ONLY
```

If `p` does not name `public`, stop: the `#04 … line 64` guard was measured under a
`search_path` that does (the `postgres` role's own is `"$user", public, extensions`), and the
pre-checks in step 4 would show it not ok.

If the error format is not `ERROR:  PROBE_ERROR_FORMAT_ONLY` with or without
`P0001: `, change only `is_sentinel` in `api-run.py`, recompute `../api/SHA256SUMS` and
the `../api/api-run.py` line of `SHA256SUMS`, and test it against the probe's message
before going on. No size probe is needed.

## 4. Read-only pre-checks and the pre-state

```sh
run production-readonly-prechecks.sql $R/prechecks --json-column prechecks
run fingerprint.sql $R/fp-pre --json-column fp
python3 -I check-readback.py $R/fp-pre.json 1 pre      # EQUAL (the follow-up's batch-2 post-state)
```

Apply the pre-check stop rules in `../guarded/README.md` to `$R/prechecks.json`
("Pre-check stop rules"): among them the ledger 280 / `20261023140000` with all 7 of the
follow-up's versions and none of this release's, all 11 `guards` entries `ok` with their
rehearsed md5, and every `must_be_zero` value 0. `compat_must_be_zero` not 0 is not a
stop by itself: show the owner the counts and the batch-2 window they mean
(`../compat-analysis.md`, "Result"), and go on only on the owner's word. Show the owner
the results, then ask for go.

## 5. Whole-release dry run

```sh
run all-batches-dry-run.sql $R/dry-all       # rc=3 and "exact dry-run sentinel as the error: True"
run fingerprint.sql $R/fp-after-dry-all --json-column fp
python3 -I check-readback.py $R/fp-after-dry-all.json 1 pre   # EQUAL
```

## 6. The batches, in order

Two batches: #1-#3, #4. Batch 1 does not change what the deployed follow-up code sees,
so a stop after batch 1 leaves production serving correctly; resume later from batch
2's dry run. Batch 1 holds an ACCESS EXCLUSIVE lock on `public.account_operation_nonces`
until it commits, so choose a quiet minute for it. **Batch 2 starts the window in which
the deployed code's Path A confirmation answers 404** (`../compat-analysis.md`): run it
only when the merge in step 7 can follow at once.

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

The expected ledger after batch 1 is 283 / `20261025200000`, after batch 2 284 /
`20261025400000`.

Exit codes map onto the README's stop rules:

| rc | Meaning |
|---|---|
| 0 | psql rc 0 |
| 3 | psql rc 3. For a dry run, it is a pass only when the sentinel line says True. For an apply, the statement rolled back as a whole: read back. The state must equal the batch's pre-state. Retry only `canceling statement due to lock timeout` or `deadlock detected`, from that batch's dry run. |
| 124 | psql rc 124, outcome unknown. Wait two minutes for the server's statement timeout, then read back. The state must be exactly the pre-state or exactly the post-state, with a matching ledger. Anything else: stop. |

Any read-back that is not EQUAL: stop. Do not run the next batch, and do not merge.

## 7. Merge and deploy

Straight after batch 2 reads back EQUAL, and while the fingerprint still equals batch
2's post-state. The deployed code's Path A confirmation answers 404 until the merge is
deployed, and the new code needs all 4 migrations, so do not leave the merge for later.
**Never merge before batch 2:** the new code refuses every request on its 38
CSRF-bound routes until #2 is applied, and fails Settings → AI removal, two consent
revocations and every Path A acceptance until #1, #3 and #4 are.

1. Mark the PR ready for review, and merge it with a merge commit.
2. Watch the Vercel production deployment of the merge commit until it is READY and
   `inherit.bio` points at it.
3. Watch `main`'s CI run, and the Deploy Cloudflare run, on the merge commit.
4. Read the fingerprint again. It must still be EQUAL to batch 2's post-state.
5. Read the Vercel production environment variable names. Never read values.

## 8. Evidence, then the credential

1. Commit `$R` under `../results/run-<UTC date>/` on a branch for the evidence: status
   files, bodies, read-backs, `rc.log` and a short README of what was run and seen.
   Leave out the token and the regenerated `.sql` files. Run `git pull --no-rebase`
   before pushing.
2. Comment on the PR with the results.
3. Tell the owner to revoke the token in the Supabase dashboard and to delete
   `SUPABASE_ACCESS_TOKEN` from the environment.
