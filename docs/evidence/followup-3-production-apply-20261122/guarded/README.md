# Guarded production release 4: 21 migrations

Production gets the 21 migrations `20261119110000` .. `20261122200000` that the branch
`claude/stoic-turing-su2ka8` adds over release 3's migration tree (`be49d283`, follow-up
2, `../../followup-2-production-apply-20261119/`), in four atomic batches, **after
releases 1, 2 and 3 are applied, merged and deployed, and before the head carrying these
files merges**. The pre-state is release 3's rehearsed post-state (its batch 2), so
nothing here can run until release 3 has read back EQUAL to it and code carrying exactly
release 3's migration tree is merged and deployed with the fingerprint still EQUAL. None
of releases 1, 2 and 3 has been applied to production yet.

The kit pins a **migrations tree**, `d43b12a8750ba2a840761d07ed2538e7ba842ab1`: the tree of
`fe8c69d1`, the tip of `claude/stoic-turing-su2ka8` when the kit was built (302 files: release
3's 281 unchanged, blob for blob, and these 21). A tree id is content-addressed, so any
commit that carries exactly these files has this tree, whatever its own id;
`generate.py --head <that commit>` checks it.

This kit follows release 3's closely: the same generator, block layout, guards, dry runs,
read-backs, transport and stop rules, with this release's pins. Each batch is one `DO`
statement: integrity checks; predecessor checks; the migrations, verbatim; a postcheck;
the ledger rows. Its `-dry-run.sql` twin is byte-identical except for one line that raises
`DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, so it rolls back. The transport is the Supabase
Management API SQL endpoint (`../api/RUNBOOK.md`).

Everything here was generated and rehearsed locally, on an isolated stack (`relk4`: its own
project, container `supabase_db_relk4` and ports, the database on 127.0.0.1:58322), as the
follow-up kit's rehearsal used `relfu`. The shared local stack (project `sequence`, port
54322) was neither reset nor written. No production or remote database was contacted, and
nothing here is a production result or an approval.

**No migration refused.** On the mirror of release 3's recorded post-state, production's
drift included, all 21 applied in filename order, each release-notes pre-check held at the
state it was written for, and all four batches read back EQUAL. There is no first rehearsal
to keep, as release 3 kept D-136's.

## Files

| File | Role |
| --- | --- |
| `generate.py` | Reproducible generator: `python3 -I generate.py [--head REV] measure [K]`, `record <psql output>`, `local K`, `final`, `list`. It is release 3's generator with this release's pins: it reads every migration with `git show d43b12a8:<file>`, derives the 21 from `git ls-tree` of that tree against `be49d283` (cross-checked with `git diff --name-only`), checks each is headed `PRODUCTION RELEASE: GUARDED`, refuses if any of release 3's 281 files differs or is missing, refuses unless `--head` (default `HEAD`) is a commit descending from `a2a4d8e9` whose `supabase/migrations` tree is exactly `d43b12a8…`, and refuses unless release 3's kit still gives the pinned pre-state summary and the 284-row ledger. `--head` may name the tree itself (LOCAL ONLY; it says so on stderr). |
| `batch-k-apply.sql`, `batch-k-dry-run.sql` | The four batches and their dry runs (regenerated, not committed; see `.gitignore`). |
| `all-batches-dry-run.sql` | All four batches, each with its postcheck and ledger rows, in one transaction that ends in the dry-run raise. Never an apply. |
| `expected-summaries.json` | Per batch: versions, expected pre- and post-state fingerprint summaries. |
| `fingerprint.sql` | Byte copy of `../fingerprint.sql`, the reviewed read-back query of every earlier kit (SHA-256 `d5c4d245…916e`), embedded verbatim, md5-checked, in every block. |
| `check-readback.py` | Byte copy of release 3's (and the follow-up's and PR 324's). |
| `production-readonly-prechecks.sql` | One read-only SELECT: session, ledger, the 87 function bodies and 5 constraint definitions the files pin that exist before this release, the release notes' refusal conditions that can be read at the release's start, every object the release creates (must be absent), every function and relation the files name, the notes' context counts and the locked tables' sizes. Written by `../rehearsal/scripts/make-prechecks.py`. |
| `SHA256SUMS` | SHA-256 of every file above, of `local/expected-summaries.json`, of the four `local/` probes and of `../api/api-run.py` (not of this README): 20 lines. |
| `local/` | Local only: `expected-summaries.json` (measured), and, ignored by git, `measure-all.sql` and the per-batch lock probes. Never for production. |
| `../rehearsal/` | Local evidence: the scripts that built the mirror and ran the rehearsal (`scripts/`), and their results (`data/`). |
| `../compat-analysis.md` | The deploy-window compatibility analysis (release 3's code against the new schema). |

## What each block does, in order

As in release 3's kit, with this release's pins:

1. **Session guards.** Refuses unless `current_user` is `postgres` and the session's
   `statement_timeout` is set and at most 180 s. Then `lock_timeout` 10 s and the six
   deparse settings `fingerprint.sql` pins.
2. **Integrity.** The md5 of the embedded `fingerprint.sql` and of every embedded
   migration must equal the file's. Every migration sits in its own dollar quote,
   `$inherit_m_<version>$`, and the generator asserts no tag occurs in any embedded text.
3. **Predecessors.** The ledger must be exactly 284 rows / max `20261025400000` before
   batch 1 (release 3's kit: 280 + its 4), and the earlier batches' rows (version, name)
   present before each later batch. No version of this or a later batch may be present.
   Then the full fingerprint summary, computed in the block, must equal the expected
   pre-state: for batch 1, release 3's rehearsed batch-2 post-state; for batch k, the
   rehearsed post-state of batch k-1.
4. **The migrations**, verbatim, in filename order, each after the session values of the
   pinned settings and `lock_timeout` 10 s are restored, so every
   `md5(pg_get_functiondef)` guard is computed under the session's `search_path`, as the
   pre-checks compute it.
5. **Postcheck.** The in-block summary must equal the post-state measured on the mirror.
6. **Ledger rows** `(version, name, array[migration text])`, in filename order.

Verified on the generated files: each embedded migration is byte-identical to
`git show d43b12a8:<file>`, each integrity literal is the md5 of that file, the embedded
fingerprint query is `fingerprint.sql` byte for byte, and each dry run differs from its
apply in exactly the one raise line (`generate.py` refuses otherwise).

## Batches

Cut: **#1-#2, #3-#7, #8, #9-#21.** No migration breaks release 3's production-reachable
code (`../compat-analysis.md`), so, as in releases 1 and 2, the cut follows the locks each
batch holds until it commits and the dependencies between the files. Two rules decide it:
each batch holds a strong lock on **at most one table the production app writes on a live
path**, and **the transfer switch (#13) commits in the same batch as everything that makes
its approved notice true**. Every file pins its predecessor's exact output, so the order
is fixed by filename.

- **Batch 1 (#1-#2).** ACCESS EXCLUSIVE on `public.genome_storage_objects` (own upload
  finalization, genome download authorization and file deletion wait on it) and on the two
  storage manifest tables, for #1's three check rebuilds. #1 runs first in the
  transaction, so no earlier statement has written `genome_storage_objects` (its notes:
  deferred foreign-key events would make the `alter table` refuse). #2 adds one function
  and takes no table lock.
- **Batch 2 (#3-#7).** ACCESS EXCLUSIVE on `public.mail_outbox` (every mail enqueue and
  claim waits) for #3, and on `private.invitation_terminal_notices` for #5, which no
  production path writes. #3 pins the adult core at #1's successor. #7 patches the self
  emptying #4 pins in its postflight and needs #4's readiness read, so #4-#7 stay
  together; #5 and #6 sit between them in filename order and touch neither.
- **Batch 3 (#8), alone.** ACCESS EXCLUSIVE on `public.account_operation_nonces` (Settings,
  consents, subject delete and account deletion wait). It is also the one migration whose
  route (`api.file-delete`) is live in production.
- **Batch 4 (#9-#21).** SHARE ROW EXCLUSIVE on `public.subjects` (#10's trigger: writes
  wait, reads do not) and the terminal-notice queue's locks (#9, #11); #12-#21 take no
  table lock. It keeps D-141's acceptance clocks (#9) with every reader that asks them
  (#10, #12, #15, #18), and the transfer switch (#13) with #17 (D-162: the person can make
  the new copy the approved notice promises, e-signature records), #19 and #20 (D-165,
  D-166: the same for reviewed-document records) and #21 (the rest of D-166). No stop
  leaves the switch open without them.

| Batch | Migrations | Versions | Migration bytes | `batch-k-apply.sql` (bytes, SHA-256) | `batch-k-dry-run.sql` SHA-256 |
|---|---|---|---|---|---|
| 1 | #1-#2 (2) | 20261119110000 .. 20261119120000 | 24,906 | 48,814 `e14eb4b4fa8e17bd474068cb942913ae8dd6c3cf54f34377e86792f9a9b5b4d3` | `8681f4d87aadfa09bd7ce77fb06620312b2f56b104271e43a222c532636ecfdd` |
| 2 | #3-#7 (5) | 20261119134500 .. 20261120100000 | 90,782 | 118,310 `26734a389a50a87562a0f4177d194a20c744f36deccdd2238f7d30c297ce7141` | `51450aaa067f00d528dd9ecff7c9ec7c14dd981bdae2a33ed4f2b156697b9d83` |
| 3 | #8 (1) | 20261120110000 | 10,340 | 33,739 `11acf1aafb33d5235b0883b4d465e9143f632254b28ea0c78e2ca56b2ed2cf92` | `33c9f6ca931f5f7204682cff00761d2e69a8fa6c5ffdb4262cc02d1a46d2ed62` |
| 4 | #9-#21 (13) | 20261120120000 .. 20261122200000 | 261,525 | 297,800 `d2580f5343aba2ce9ce45d462f0e04d028c88dc4fd5ab63f5305088e83f9b78e` | `d180b76f6c9e18665dc5789d3e29f29208d8ff3d08acac2987499cdbc0855971` |

`all-batches-dry-run.sql`: 436,641 bytes, SHA-256
`ff38fac1d27eccea3aa5eec9a75def9e3367bae70c9c163e7dda701eaeec060b`. As a Management API
request it is 443,499 bytes (batch 4: 302,511). On 22 October the endpoint accepted 2.9 MB.

| Batch | Expected pre-state summary (count/md5 prefix) | Expected post-state summary, measured on the mirror |
|---|---|---|
| 1 | functions 1423/befdb108 tables 268/5926d879; extensions 6/5c2a24b5 schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf types 5/12d5c675 views 0/d7517139 | functions 1424/4ea3ebd3 tables 268/4e9d9573; the rest unchanged |
| 2 | functions 1424/4ea3ebd3 tables 268/4e9d9573 | functions 1433/e653c872 tables 268/205e9670 |
| 3 | functions 1433/e653c872 tables 268/205e9670 | functions 1435/77b3e4c2 tables 268/9e3d3470 |
| 4 | functions 1435/77b3e4c2 tables 268/9e3d3470 | functions 1453/fae4d538 tables 268/8a57c474 |

The seven other categories are the same in every state (as in batch 1's row). The batch-1
pre-state is release 3's rehearsed batch-2 post-state
(`../../followup-2-production-apply-20261119/guarded/expected-summaries.json`; `generate.py`
refuses if its constant differs from that file). Full md5 values are in
`expected-summaries.json`, and in each file's header and block. Each measured post-state
equals the summary the step analysis read after the same files applied one by one with
`psql -1 -f` (after #2, #7, #8 and #21), and the final state equals a fresh build of the
302 files plus production's drift (below).

## The md5 guards: what they check, and where the bodies come from

The 21 files hold 247 distinct 32-hex md5 values in 406 uses; every one is accounted for
(`../rehearsal/scripts/guards.py`, `../rehearsal/data/guard-map.json`), by value against
what the step analysis measured on the mirror before and after each migration:

| Kind | Uses | What it is |
| --- | --- | --- |
| pin on a body that exists before this release | 179 (87 functions) | a predecessor, callee or pinned-not-changed body as release 3 leaves it; re-run read-only by the pre-checks |
| pin on a body an earlier migration of this release writes | 64 | proven by the dry runs (the batch's own chain) |
| successor | 105 | the md5 a patch or postflight asserts after its own change |
| chained | 48 | an intermediate body inside one file's patch chain (a patch's successor and the next patch's predecessor) |
| constraint definition | 10 | 6 pins on the 5 constraints that exist before this release, 3 on the notice-kind check as an earlier migration of this release leaves it, 1 successor (#3's new check) |

Per migration (distinct md5 values; pins on pre-existing bodies; pins on bodies of an
earlier migration of this release, by writer): #1 8; 5 · #2 3; 2 · #3 9; 3; #1 · #4 2; 2 ·
#5 8; 5 (+ the notice-kind check) · #6 8; 4 · #7 9; 3; #4 · #8 2; 2 · #9 18; 8 (+ #5's
check) · #10 10; 8 (+ `chats_scope_target_check`) · #11 21; 7; #5 · #12 11; 5; #9 · #13 22;
13; #5, #9, #11 · #14 11; 7; #7 · #15 9; 4; #12 · #16 7; 4; #14 · #17 24; 8; #6, #11 · #18
8; 1; #9, #12 (+ the draft flow check) · #19 38; 14; #10, #17 (+ three draft checks) · #20
15; 7; #9, #19 · #21 4; 1; #19, #20.

**Where the 87 pre-existing bodies come from** (by their pinned `def_md5` in the mirror
builds' fingerprints): 56 are production's own, as read back on 2026-10-22; 26 are written
by release 1 (PR 324), 2 by release 2 and 3 by release 3. **None is among the 8 bodies
production holds comment-stripped** (the D-136 case), and no migration pins, patches or
calls one of them by md5. Releases 1-3 have not run, so 31 of the 87 cannot yet be compared
with a production read-back: the mirror assumes, as every earlier kit rehearsed, that the
Management API stores bodies exactly as sent. The pre-checks compare all 87 at the
release's step 4; a difference there stops the release with nothing written.

**`search_path`.** Every `md5(pg_get_functiondef)` pin on a pre-existing body gives the
same md5 under the session's `"$user", public, extensions` and under the pinned
`pg_catalog` (`guard-map.json`, `search_path_dependent` false for all). The two pins whose
definition text would depend on the path (`private.future_person_ready_export_v1` and
`private.account_archive_r2_completed_context_v1`, both release 1's) are written as
`md5(prosrc)` by #14 and #16, which does not. The pre-checks compute every pin under the
session's own path, as the batches do.

**The release notes' pre-checks.** Each of the 21 sections of
`../../release-4-notes-20261119.md` gives one read-only SELECT for the state just before
its migration. `../rehearsal/scripts/steps.py` ran each one on the mirror at exactly that
state, then applied the migration: every `must_be_*` column held, 21 of 21
(`../rehearsal/data/notes-prechecks.tsv`). One section's SQL block has no closing fence in
the notes (`20261119150000`: it stops after `context_live_self_upload_consents,` and the
next section follows); `../rehearsal/scripts/notes.py` closes it with the two context
columns every other section ends with, and says so. At the release's start only part of
each notes SELECT means the same thing (later migrations pin bodies earlier ones write),
so `production-readonly-prechecks.sql` keeps, per migration, what can be read then (named
`m<NN>_…`), and adds every pre-existing pin the files contain, whether or not the notes
list it.

## Pre-check stop rules

Run `production-readonly-prechecks.sql` first (`../api/RUNBOOK.md` step 4). Stop unless
all of the following hold. The expected values are the mirror's
(`../rehearsal/data/prechecks-on-mirror-pre.json`).

- `session.current_user` is `postgres`, and `session.search_path` names `public` (the
  mirror had `"$user", public, extensions`).
- `ledger` is 284 rows, max `20261025400000`, `above_release3_max` 0,
  `release3_versions_present` 4 and `release_versions_present` 0.
- All 87 `guards` entries `ok: true`: `have_md5` equal to `want_md5` and `proacl` equal
  to `want_acl` (the ACL the mirror holds, also where a file's own guard compares the md5
  only; the batch's fingerprint check compares every ACL anyway). All 5
  `constraint_guards` entries `ok: true`.
- Every `must_be_zero` value is 0. There are 31 keys: `guarded_bodies_not_as_rehearsed`,
  `guarded_constraints_not_as_rehearsed`, `prerequisite_functions_missing` (98 names),
  `prerequisite_relations_missing` (62), `roles_missing` (4),
  `release_functions_present` (30 names), `release_objects_present` (4: #3's check and
  trigger, #9's and #10's triggers); and from the notes: `m01_…` (5 refusal counts and the
  3 bucket checks as reviewed), `m02_…` (the spend table and the ingest status check),
  `m03_…` (plain notes on sendable rows, payloads outside `request`/`note`, the pinned
  provider attempt key), `m04_…` (the door's self branch, the contact revision column),
  `m05_notice_trigger_missing`, `m07_archive_tables_missing`, `m08_…` (the actor trigger,
  the operation check before its widening), `m09_…` (the queue's one trigger, the two
  retention classes and phases, no clock), `m11_m13_transfer_switch_open`,
  `m14_job_table_missing`, `m20_uploader_read_callers_not_the_five`.
- `context`: every count is expected to be 0 in production (and the two booleans
  `false`), except `m07_export_delete_guard`, which is 1 (the trigger exists): legacy staging sessions, plain notes on ended rows, self-record exports,
  terminal notices, accepted adult invitations, subject chats, Path B and transferred
  records, reviewed-document records, open account archives. Not 0 is not a stop by itself;
  each one's meaning is in the notes section its key names (`m<NN>`). Show the owner, and
  go on only on the owner's word. `m04_door_md5` (the mirror: `2f2c32f4…`) and
  `m08_check_md5` (`7767adc7…`) are recorded, not compared: the guards above compare the
  bodies and checks themselves.

Read before choosing each batch's minute: `sizes` (the rows each check rebuild scans under
its lock) and `context_locks` (unconsumed account operation nonces, queued or claimed
mail).

## Production commands

The transport, probes and exact command sequence are in `../api/RUNBOOK.md`. The same
files run under psql over a session-level connection with the command shape below, which
the rehearsal used:

```sh
PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '180s'" -f batch-$k-dry-run.sql   # rc=3, exactly one ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED
```

Order: pre-checks and the pre-state read-back (EQUAL batch 1 pre); the whole-release dry
run (sentinel), then a read-back (EQUAL batch 1 pre). Then, for k = 1..4: the dry run
(sentinel), a read-back (EQUAL k pre), the apply (rc 0), a read-back (EQUAL k post), and
the ledger.

| After batch | Rows | Max version |
|---|---|---|
| (release 3) | 284 | `20261025400000` |
| 1 | 286 | `20261119120000` |
| 2 | 291 | `20261120100000` |
| 3 | 292 | `20261120110000` |
| 4 | 305 | `20261122200000` |

## Stop rules

- Any `SHA256SUMS` line not OK, or `generate.py --head <head to merge>` refusing: stop. It
  refuses every head that does not carry tree `d43b12a8`, release 3's heads among them.
- Releases 1-3 not complete and EQUAL, or release 3's code not merged and deployed with
  the fingerprint still EQUAL: stop. This release cannot start.
- Any pre-check stop rule above: stop.
- A pre-state read-back that is not EQUAL: stop; production is not what was rehearsed.
- A dry run with rc other than 3, without the exact sentinel, or with any other `ERROR:`:
  stop and do not apply. Read back; it must still be EQUAL to the pre-state.
- An apply with rc other than 0: the statement rolled back as a whole. Read back: the
  summary must equal the batch's **pre**-state and the ledger must be unchanged. Retry only
  `canceling statement due to lock timeout` or `deadlock detected`, at a quieter time,
  starting again from that batch's dry run. Anything else: stop.
- No response (rc 124): assume nothing. Wait two minutes for the server's statement
  timeout, then read back. The state must be exactly the batch's pre-state or exactly its
  post-state, with the ledger to match. Anything else: stop.
- A post read-back that is not EQUAL: stop. Do not run the next batch; do not merge.
- Stopping after any batch is safe for release 3's deployed code. Resume later from the
  next batch's dry run.
- Never merge before batch 4 reads back EQUAL. Never run `supabase db push` or apply any
  migration file directly in between.

## The mirror the batches were rehearsed on

Built by `../rehearsal/scripts/build-mirror.sh` on the isolated stack relk4
(`../rehearsal/scripts/setup-stack.sh`), following release 3's `build-mirror.sh` and the
follow-up kit's isolated-stack setup step for step (`../rehearsal/data/mirror-builds.txt`):

1. `supabase db reset` of the relk4 scratch project, whose 245 migration files are
   asserted blob-identical to main `12f24475`'s. The fresh-main fingerprint is
   byte-identical to the reference fresh build (`8860eee4…`).
2. 3 ledger stand-ins (248 rows, max `20261011010251`); the 8 comment-stripped bodies,
   whose per-line hashes equal `prod-linehash.txt` (read from production on 15 October);
   `pg_cron` 1.6.4. The full fingerprint equals production's 2026-10-22 read-back
   (`fp-after-merge.json`) object for object: RESULT EQUAL.
3. Release 1: PR 324's four guarded batches from its kit (`generate.py --head cf79b1b6
   final`, its 20 `SHA256SUMS` lines OK), each dry run rc 3 with exactly the sentinel and
   read back EQUAL to its pre-state, each apply rc 0 and read back EQUAL to its post-state;
   ledger 273 / `20261016221000`; fingerprint byte-identical to PR 324's rehearsed final
   mirror (`4d2a2747…`).
4. Release 2: the follow-up's two guarded batches (`--head 77d04563`, 15 lines OK), the
   same way; ledger 280 / `20261023140000`; fingerprint `3a0f4d68…`, byte-identical to its
   rehearsed final mirror.
5. Release 3: follow-up 2's two guarded batches (`--head a2a4d8e9`, the first commit
   carrying its tree `be49d283`; 15 lines OK), the same way; ledger 284 /
   `20261025400000`; fingerprint `7bef9657…`, byte-identical to release 3's rehearsed final
   mirror (its `rehearsal/data/equivalence.txt` and `final-pass.txt`), and its summary EQUAL
   to release 3's batch-2 post-state.

So **this release's pre-state equals release 3's recorded post-state, byte for byte,
production's drift included.** A plain fresh build through `20261025400000` does not: it
lacks production's drift (`../rehearsal/data/equivalence.txt`). The mirror was built five
times, every read-back EQUAL and every fingerprint as above each time.

## Rehearsal results (on the mirror)

Command shape: `PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c
"set statement_timeout = '180s'" -f <file>`. The whole-release dry run used `'2min'`, the
Management API session's value. Local seconds include psql start-up
(`../rehearsal/data/rehearsal-results.tsv`).

**Pre-checks** on the pre-state: every `must_be_zero` value 0, 87 of 87 guards and 5 of 5
constraint guards `ok`, every `context` count 0 or `false` except
`m07_export_delete_guard` 1 (the trigger that keeps an export row, expected)
(`../rehearsal/data/prechecks-on-mirror-pre.json`). On the final state the same query
reads the ledger 305 and every guard the release changes as not ok, as it should.

**Whole-release dry run** on the pre-state: rc 3, exactly one `ERROR:
DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 1.09 s. The fingerprint and ledger were unchanged
afterwards, and the read-back EQUAL batch 1 pre. It was repeated on a rebuilt mirror (build
4) from the files as `generate.py --head fe8c69d1 final` writes them (its 20 `SHA256SUMS`
lines and `../api`'s 1 OK): rc 3, the sentinel, unchanged; the four batches then applied
the way `apply-kit.sh` applies every earlier kit, each dry run and apply read back EQUAL,
to the same final fingerprint (`../rehearsal/data/final-pass.txt`).

**The pre-checks file was revised once after the rehearsal.** The first run of the
missing-release negative (below) showed the pre-checks query itself failing on a state
without release 3 (`relation "private.session_csrf_token_uses" does not exist`): a stop,
but not a report. The five values that read an object releases 1-3 create now read it only
when it exists (NULL otherwise, which is never 0), and the callers check uses
`to_regprocedure`. On the pre-state the revised file gives the same keys and values as the
rehearsed one (compared as JSON on mirror build 6), and the negatives were run again with
it (builds 6 and 7). No batch file changed; `SHA256SUMS` changed in that one line.

**Per batch:**

| Batch | Lock probe | Dry run (output, local seconds, state after, read-back) | Apply (output, local seconds, read-back) | Ledger after | Re-apply |
|---|---|---|---|---|---|
| 1 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 0.379 s, unchanged, EQUAL 1 pre | rc 0 `SET DO`, 0.365 s, EQUAL 1 post | 286 rows, max 20261119120000 | rc 3 on the ledger, unchanged |
| 2 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 sentinel, 0.391 s, unchanged, EQUAL 2 pre | rc 0 `SET DO`, 0.326 s, EQUAL 2 post | 291 rows, max 20261120100000 | rc 3 on the ledger, unchanged |
| 3 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 sentinel, 0.363 s, unchanged, EQUAL 3 pre | rc 0 `SET DO`, 0.412 s, EQUAL 3 post | 292 rows, max 20261120110000 | rc 3 on the ledger, unchanged |
| 4 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 sentinel, 0.543 s, unchanged, EQUAL 4 pre | rc 0 `SET DO`, 0.551 s, EQUAL 4 post | 305 rows, max 20261122200000 | rc 3 on the ledger, unchanged |

Final fingerprint `58406ca3e57db5cb4f51a6377013bbe4f2575ee04b46eebd55719081e3bbbefb`: byte
for byte the step analysis's after the 21 files applied one by one (two independent runs).

**Negative checks.** Every one refused and left the fingerprint and ledger unchanged
(`../rehearsal/data/negatives.tsv`):

| Check | Result |
| --- | --- |
| Batch-1 dry run without a session `statement_timeout`, and with `'190s'` | rc 3, `session: set statement_timeout to at most 180s for the session before this statement (a SET inside the block does not bound it)` |
| **Out of order:** batch-2 dry run and apply before batch 1 | rc 3, `predecessor: ledger has 284 rows, max 20261025400000; expected 286 rows, max 20261119120000` |
| **Out of order:** batch-4 apply before batch 1 | rc 3, `… expected 292 rows, max 20261120110000` |
| **Out of order:** batch-4 apply after batch 2, before batch 3 | rc 3, `predecessor: ledger has 291 rows, max 20261120100000; expected 292 rows, max 20261120110000` |
| **Re-run:** each batch again straight after it | rc 3 on the ledger (for example batch 4: `ledger has 305 rows, max 20261122200000; expected 292 rows, max 20261120110000`) |
| **Re-run:** batch 1 after batch 2, batch 1 after batch 4, the whole-release dry run after batch 4 | rc 3 on the ledger (`… expected 284 rows, max 20261025400000`) |
| Batch-1 apply with one byte of the embedded `20261119110000` changed (in its header comment) | rc 3, `integrity: embedded 20261119110000_dropped_bucket_literals_and_guard.sql is not the reviewed file` |
| Batch-4 apply with one byte of the embedded `20261122120000` changed | rc 3, `integrity: embedded 20261122120000_subject_transfer_open.sql is not the reviewed file` |
| Batch-1 apply with the embedded fingerprint query changed | rc 3, `integrity: the embedded fingerprint query is not fingerprint.sql` |
| **Wrong predecessor body, batch 1:** `private.create_adult_subject_invitation_core_v1` (pinned by #1) with one added comment line (rolled back) | pre-checks: its guard not ok (have `f23e074f…`); whole-release dry run and batch-1 apply: `predecessor: fingerprint summary differs`; #1 as a file: `dropped bucket literals prerequisite differs` |
| **Wrong predecessor body, batch 4:** `private.path_b_subject_v1` (pinned by #17, #19, #20, #21) the same way | pre-checks: its guard not ok (have `78c4bc88…`); whole-release dry run: `predecessor: fingerprint summary differs`; #1-#19 as files in order: #17 refuses first, `transferred record exports prerequisite differs` |
| One extra grant on `public.claim_due_account_deletion_v1` (pinned with its ACL by #1) | pre-checks: its guard not ok (md5 equal, ACL differs); dry run and batch-1 apply: `predecessor: fingerprint summary differs`; #1 as a file: `dropped bucket literals prerequisite differs` |
| **Missing earlier release:** the mirror built without release 3 (release 2's post-state, ledger 280) | whole-release dry run, batch-1 dry run and batch-1 apply: `predecessor: ledger has 280 rows, max 20261023140000; expected 284 rows, max 20261025400000`; the pre-checks report ledger 280 and `guarded_bodies_not_as_rehearsed` 3 (`public.consume_session_csrf_v1` absent, the Path A body and the nonce consumer at release 2's md5s), `prerequisite_functions_missing` 1, `prerequisite_relations_missing` 1, `m02_spend_table_not_as_reviewed` 1, `m08_check_not_before_widening` 1 |

`generate.py` (`../rehearsal/data/generator-negatives.txt`, in a scratch clone):

| Check | Result |
| --- | --- |
| `--head` a commit carrying exactly `d43b12a8` with one more document change | accepted |
| `--head d43b12a8` (the tree) | accepted, LOCAL ONLY |
| `--head 6252566a` (release 3's head, tree `be49d283`) | `… tree be49d283… is not the rehearsed tree d43b12a8…` |
| `--head` a commit whose `20261122120000` gains a trailing comment line | `… tree de9284c8… is not the rehearsed tree d43b12a8…` |
| `REV_TREE` a tree where release 3's `20261025400000` changed | `earlier migration changed or missing in 4b9417dd: supabase/migrations/20261025400000_path_a_account_accept_typed_name.sql` |
| `BATCHES` that skip #8 | `BATCHES must cover 1..n consecutively` |

**Locks** (`../rehearsal/data/batch-lock-probes.txt`, `locktrace.txt`). Each batch holds,
at its end, exactly the strong locks the cut intends: batch 1 ACCESS EXCLUSIVE on
`genome_storage_objects`, `account_deletion_storage_entries` and
`embryo_ingest_delete_objects`; batch 2 on `mail_outbox` (and its trigger's SHARE ROW
EXCLUSIVE) and `invitation_terminal_notices`; batch 3 on `account_operation_nonces`; batch 4
SHARE ROW EXCLUSIVE on `subjects` and ACCESS EXCLUSIVE and SHARE ROW EXCLUSIVE on
`invitation_terminal_notices`; plus ROW EXCLUSIVE on the ledger table. Nothing else beyond
ACCESS SHARE; no `auth` or `storage` table beyond ACCESS SHARE reads.

**Timings.** Measured inside the block, with the in-block fingerprint reads, batches 1-4
take 0.15, 0.15, 0.13 and 0.32 s; the 21 migrations alone take 0.36 s
(`locktrace.txt`). The longest local statement is the whole-release dry run, 1.09 s with
psql start-up. The binding limit in production is the endpoint's 2-minute
`statement_timeout` (the guard allows up to 180 s); every batch finishes locally in under
1 % of it. Production adds lock waits, which `lock_timeout` 10 s bounds, and data: only
#1, #3, #5, #8, #9 and #11's check rebuilds scan a table (`sizes`).

**pgTAP** (`../rehearsal/data/pgtap-summaries.txt`). Each run left the fingerprint and
ledger unchanged:

| State | Suite | Files | Tests | Result |
|---|---|---|---|---|
| Mirror, pre-state | release 3's whole suite (`6252566a`) | 239 | 16,179 | PASS (477 s) |
| Mirror, final state | the 33 files the branch added or changed since release 3's tree (the pinned head's) | 33 | 2,197 | PASS each |
| Mirror, final state | release 3's whole suite (`6252566a`) | 239 | 16,003 run | FAIL in 8 files, every one a file the branch changes for this release (`../compat-analysis.md`, "Old-contract failures") |

**Order equivalence** (`../rehearsal/data/equivalence.txt`). Dumps are pg_dump 17
`--schema-only`, normalised by dropping its two random `\restrict`/`\unrestrict` lines.

- **Fresh `be49d283` tree + the 21 (`psql -1 -f` each, 1.42 s) against a fresh build of all
  302.** The fingerprints are byte-identical (`50c1bbe6…`) and the normalised dumps are
  identical (104,297 lines, `05ab0141…`).
- **The rehearsed final mirror (production mirror + releases 1-3 through their kits + this
  kit's four batches) against a fresh build of all 302 with the same drift applied.** The
  fingerprints are byte-identical (`58406ca3…`) and the normalised dumps are identical
  (104,375 lines, `58094b22…`). The final pass reached the same fingerprint.
- **A plain fresh build through `20261025400000` against release 3's recorded post-state.**
  Not equal: its fingerprint (`6eb6981f…`, release 3's own fresh 281 build) differs only in
  the 8 drifted `def_md5` values and the `pg_cron` row.

Expected final production state: batch 4's post-state above (functions 1,453 /
`fae4d538…`, tables 268 / `8a57c474…`, the rest unchanged from release 3's post-state).

## Deploy-window conclusions (details in `../compat-analysis.md`)

- **No migration breaks release 3's production-reachable code.** 5 additive-safe, 16
  safe-with-reason; the production-reachable paths that change, Files → Delete and
  "Download your data", answer as before for every record production holds (none has an
  export copy or was transferred).
- **#13 opens the record transfer and the uploader's hand-over** (the owner's decision of
  22 November 2026). Between batch 4 and the merge, release 3's code runs with the switch
  open; every path it opens needs a confirmed Path B record, which exists only under the
  test jurisdiction, so nothing is reachable in production.
- **The new code needs the release.** Merge after batch 4, as in every earlier kit.
- **Locks.** One production-hot table per batch, each for well under a second; a lock wait
  beyond 10 s cancels the batch, which is safe to retry later.
- **Outside the fingerprint.** It does not cover `auth` or data. No file grants to `anon`,
  `authenticated` or PUBLIC; the 15 new public functions are `service_role` only.

## Open points for the owner (none decided here)

- **Which commit merges after release 3.** Release 3's kit refuses any head without tree
  `be49d283`; this branch's head carries `d43b12a8`. The last commit carrying `be49d283`
  is `6252566a`. This kit assumes: release 3, merge a `be49d283` commit, deploy, release 4,
  merge a `d43b12a8` commit. Release 3's README lists the same choice for releases 2 and
  3; merging once after releases 3 and 4 back to back would need release 3's step 7 and
  this kit's step 0 restated.
- **Release 1-3 bodies pinned without a production read-back** (above, "Where the 87
  pre-existing bodies come from"): checked at the release's step 4.
- **The batch cut and the pre-checks' ACL rule** are engineering choices of the session that
  built this kit, for the owner to review.

## Local state afterwards

The isolated stack relk4 was stopped and its container, volume and network removed
(`setup-stack.sh --stop`). The shared stack (project `sequence`) was not touched. The batch
files the earlier kits regenerated for the mirror builds (ignored by git) were removed;
this kit's generated `.sql` files are ignored by git and recreated by `generate.py final`.
Scratch logs, fingerprints and dumps were kept outside the repository; the fingerprints'
and dumps' SHA-256 values are in `../rehearsal/data/`.
