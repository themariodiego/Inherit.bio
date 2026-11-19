# Guarded production release after the follow-up: 4 migrations

Production gets the 4 migrations that the follow-up branch adds over the follow-up
release's migration tree (`77d04563`, tree `259a56dd`), in two atomic batches, **after
the follow-up's release, merge and deployment, and before the head carrying these files
merges**. The decisions ledger puts `20261025400000` here: "It goes into the release
after the follow-up, not the follow-up's pinned set" (`docs/protocol/decisions.md`,
2026-10-23, "D-103: Path A acceptance includes a typed name"). The pre-state is the
follow-up's rehearsed post-state (`../../followup-production-apply-20261023/guarded/`,
batch 2), so nothing here can run until the follow-up's release has read back EQUAL to
it. Neither PR 324's release nor the follow-up's has been applied to production yet.

The kit pins a **migrations tree**, `be49d283ec9a435c635ca54f28986d4676886910`: the
follow-up branch head `d8dcb61a`'s tree (`151259da`) with `20261025400000`'s revised
predecessor guard. That revision is committed on the follow-up branch, in the commit
titled "Let the Path A migration accept the callee body production actually holds". A
tree id is content-addressed, so any commit that carries the revised file has exactly this
tree, whatever its own id;
`generate.py --head <that commit>` checks it.

This kit follows the follow-up's closely. Each batch is one `DO` statement, built by the
same code: integrity checks; predecessor checks; the migrations, verbatim; a postcheck;
the ledger rows. Its `-dry-run.sql` twin is byte-identical except for one line that
raises `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, so it rolls back. The transport is the
Supabase Management API SQL endpoint (`../api/RUNBOOK.md`).

Everything here was generated and rehearsed locally, on the one local Supabase stack
this machine runs (project `sequence`, container `supabase_db_sequence`, port 54322),
which the owner allowed for this rehearsal. The earlier kits used an isolated stack.
No production or remote database was contacted, and nothing here is a production
result or an approval.

## The defect the first rehearsal found, and the fix

**First rehearsal (pinned `d8dcb61a`, tree `151259da`).** On the mirror of the state
production will hold after the follow-up's release, `20261025400000` refused at its
predecessor block with `55000 path a typed name prerequisite differs`
(`../rehearsal/data/defect-20261025400000.txt`; the first rehearsal's results are kept in
`../rehearsal/data/first-rehearsal/`):

- The block required `md5(pg_get_functiondef)` of six callees, among them
  `private.current_adult_subject_invitation_v1(uuid,uuid)` = `7fa7e1fe…`, the repository
  body with its 2 full-line comments.
- Production holds that function without its comments: one of the 8 bodies the read-only
  fingerprint of 15/16 October found comment-stripped (PR 324 kit, "Function bodies,
  definitions and the comment-stripping drift"). Its def_md5 in production's 2026-10-22
  read-back (`e98e44bb…`) is the mirror's exactly, and no later release rewrites it. On the
  mirror it reads `78d14793…`.
- A fresh build holds the repository body, so CI and the 52/52 suite passed; only
  production's drift, which the mirror carries, made it refuse. In production, batch 2
  would have refused as a whole, writing nothing: a safe failure, but the release could
  not have completed, and the head that needs `public.accept_adult_subject_invitation_v1`
  could not have merged. The pre-checks caught it too
  (`guarded_bodies_not_as_rehearsed = 1`).

**Fix (the same day; an engineering decision of the session that ran this rehearsal, not
an owner decision, and for the owner to review before this release).** For that one callee the predecessor block
accepts exactly two reviewed bodies: the repository's and the same body without its two
full-line comments, as production holds it. The block counts distinct signatures, so a
second body can never stand in for a missing callee. Nothing else in the file changed:

```diff
   -- What the door calls, each its reviewed body.
-  or (select count(*) from pg_proc p join (values
+  -- current_adult_subject_invitation_v1 has two reviewed bodies: the repository's,
+  -- … (6 comment lines in all, naming the PR 324 kit's section on the drift)
+  or (select count(distinct x.signature) from pg_proc p join (values
     ('private.current_adult_subject_invitation_v1(uuid,uuid)','7fa7e1fe73fc4db2ecf9af8a7b26d265'),
+    ('private.current_adult_subject_invitation_v1(uuid,uuid)','78d147935e25d657d8df631583c6faea'),
```

**Proof the two bodies differ only by comments** (`../rehearsal/data/callee-bodies.txt`):
the repository body (fresh build) and production's (the mirror), both
`pg_get_functiondef` under the session settings, differ by exactly two removed lines, both
full-line `--` comments; the repository body without them equals the mirror's.
`78d14793…` was re-derived on the mirror under every `search_path` that holds `public`
(the `postgres` role's own is `"$user", public, extensions`); without `public` both md5s
change, because the return type is then printed schema-qualified.

**Second rehearsal (pinned tree `be49d283`).** The whole kit was measured and rehearsed
again against the revised file: both batches apply on the mirror and read back EQUAL. A
third body, the callee missing, and another callee's body changed each refuse with the
same message and write nothing (`../rehearsal/data/guard-cases.tsv`). Results below.

## Files

| File | Role |
| --- | --- |
| `generate.py` | Reproducible generator: `python3 -I generate.py [--head REV] measure [K]`, `record <psql output>`, `local K`, `final`, `list`. It is the follow-up kit's generator with this release's pins: it reads every migration with `git show be49d283:<file>` (the pinned tree), derives the 4 from `git ls-tree` of that tree against `77d04563`'s (cross-checked with `git diff --name-only`), checks each is headed `PRODUCTION RELEASE: GUARDED`, refuses if any of `77d04563`'s 277 files differs or is missing, refuses unless `--head` (default `HEAD`) is a commit descending from `77d04563` whose `supabase/migrations` tree is exactly `be49d283…`, and refuses unless the follow-up's kit still gives the pinned pre-state summary and the 280-row ledger. Before the revised file is committed, `--head` may name the tree itself (LOCAL ONLY; it says so on stderr). Additions to the follow-up's: `measure K`/`record` handle batches 1..K, `final` refuses while any batch is unmeasured, and `local K` writes measured batches under `local/` for a rehearsal. |
| `batch-k-apply.sql`, `batch-k-dry-run.sql` | The two batches and their dry runs (regenerated, not committed; see `.gitignore`). |
| `all-batches-dry-run.sql` | Both batches, each with its postcheck and ledger rows, in one transaction that ends in the dry-run raise. Never an apply. |
| `expected-summaries.json` | Per batch: versions, expected pre- and post-state fingerprint summaries. |
| `fingerprint.sql` | Byte copy of `../fingerprint.sql`, the reviewed read-back query of PR 323, PR 324 and the follow-up (SHA-256 `d5c4d245…916e`), embedded verbatim, md5-checked, in every block. |
| `check-readback.py` | Byte copy of the follow-up's (and PR 324's). |
| `production-readonly-prechecks.sql` | One read-only SELECT: session, ledger, the 11 md5 guards (one of them with two accepted md5s) on bodies that exist before this release, every prerequisite, the operation check and its parse, the batch-2 window counts, sizes and context. Written by `../rehearsal/scripts/make-prechecks.py`. |
| `SHA256SUMS` | SHA-256 of every file above, of `local/expected-summaries.json`, of the two `local/` probes and of `../api/api-run.py` (not of this README): 14 lines. |
| `local/` | Local only: `expected-summaries.json` (measured), and, ignored by git, `measure-all.sql` and the per-batch lock probes. Never for production. |
| `../rehearsal/` | Local evidence: the scripts that built the mirror and ran the rehearsal (`scripts/`), and their results (`data/`; the first rehearsal's in `data/first-rehearsal/`). |
| `../compat-analysis.md` | The deploy-window compatibility analysis (the follow-up's code against the new schema). |

## What each block does, in order

As in the follow-up's kit, with this release's pins:

1. **Session guards.** Refuses unless `current_user` is `postgres` and the session's
   `statement_timeout` is set and at most 180 s. Then `lock_timeout` 10 s and the six
   deparse settings `fingerprint.sql` pins.
2. **Integrity.** The md5 of the embedded `fingerprint.sql` and of every embedded
   migration must equal the file's. Every migration sits in its own dollar quote,
   `$inherit_m_<version>$`, and the generator asserts no tag occurs in any embedded text.
3. **Predecessors.** The ledger must be exactly 280 rows / max `20261023140000` before
   batch 1 (the follow-up kit: 273 + its 7), and 283 / `20261025200000` with batch 1's 3
   rows (version, name) present before batch 2. No version of this or a later batch may be
   present. Then the full fingerprint summary, computed in the block, must equal the
   expected pre-state: for batch 1, the follow-up's rehearsed batch-2 post-state; for
   batch 2, the rehearsed post-state of batch 1.
4. **The migrations**, verbatim, in filename order, each after the session values of the
   pinned settings and `lock_timeout` 10 s are restored, so every
   `md5(pg_get_functiondef)` guard is computed under the session's `search_path`, as the
   pre-checks compute it.
5. **Postcheck.** The in-block summary must equal the post-state measured on the mirror.
6. **Ledger rows** `(version, name, array[migration text])`, in filename order.

Verified on the generated files: each embedded migration is byte-identical to
`supabase/migrations/<file>` and to `git show be49d283:<file>`, each integrity literal is
the md5 of that file, the embedded fingerprint query is `fingerprint.sql` byte for byte,
and each dry run differs from its apply in exactly the one raise line.

## Batches

Cut: **#1-#3, #4.** The cut follows the one file that breaks the deployed code
(`../compat-analysis.md`): #4 changes what the follow-up's code gets from a Path A
confirmation, so it is alone and last, and the merge follows it straight away.

- Batch 1 (#1-#3) changes nothing the deployed code can see, at its boundary or after it.
  It holds the release's only strong lock on an existing table: ACCESS EXCLUSIVE on
  `public.account_operation_nonces` for #1's check rebuild. #2 creates a table and a
  function; #3 creates two functions. None depends on another.
- Batch 2 (#4) patches one private body in place and creates the door and its wrapper.
  It takes no strong lock on an existing table.

| Batch | Migrations | Versions | Migration bytes | `batch-k-apply.sql` (bytes, SHA-256) | `batch-k-dry-run.sql` SHA-256 |
|---|---|---|---|---|---|
| 1 | #1-#3 (3) `20261024110000_copilot_settings_delete_nonce.sql` .. `20261025200000_consent_revoke_provider_nonce.sql` | 20261024110000 .. 20261025200000 | 17,763 | 42,330 `b8d4397031935b561b44f27c60d7f4c5262b86258d5dd449bd1381b32d0c7fc4` | `ad19a887223d838880c7af370fe7adeaf836298496a2d2e1c0bae28e069ecbf5` |
| 2 | #4 (1) `20261025400000_path_a_account_accept_typed_name.sql` | 20261025400000 | 15,009 | 37,921 `11064d743bc4d677f1f6122093396020589e0274712cb6837c6529e1c4fc0957` | `a80affe13ed25cb23ef867f77889740e021ab3924256c2870fdab8910aa74471` |

`all-batches-dry-run.sql`: 59,130 bytes, SHA-256
`5689ad126a94964de4a81f87d179ed240614b0a83827008e2b6d1c3037270006`. As a Management
API request it is 60,485 bytes (batch 1: 43,434). On 22 October the endpoint accepted
2.9 MB.

| Batch | Expected pre-state summary (count/md5 prefix) | Expected post-state summary, measured on the mirror |
|---|---|---|
| 1 | extensions 6/5c2a24b5 functions 1417/130b1314 schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 267/3d1bbd05 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1421/73beb313 schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 268/5926d879 types 5/12d5c675 views 0/d7517139 |
| 2 | extensions 6/5c2a24b5 functions 1421/73beb313 schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 268/5926d879 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1423/befdb108 schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 268/5926d879 types 5/12d5c675 views 0/d7517139 |

The batch-1 pre-state is the follow-up's rehearsed batch-2 post-state
(`../../followup-production-apply-20261023/guarded/expected-summaries.json`; `generate.py`
refuses if its constant differs from that file). Full md5 values are in
`expected-summaries.json`, and in each file's header and block. Each measured post-state
equals the summary the step analysis read after the same files applied one by one with
`psql -1 -f` (after #3 and after #4), and the final state equals a fresh build of the 281
files plus production's drift (below). Batch 1's post-state is the one the first
rehearsal measured.

## The md5 guards: what they check, and where the bodies come from

The 4 files hold 17 md5 literals; all are accounted for in 18 guard uses
(`../rehearsal/scripts/guards.py`, `../rehearsal/data/guard-map.json`). On the mirror of
the follow-up's post-state:

| # | Migration :line | Function | Kind | Expected md5 (session settings) | Body from | On the mirror |
|---|---|---|---|---|---|---|
| 01 | `20261024110000` :35 | `public.remove_own_copilot_settings_v1` | predecessor + ACL `{postgres=X/postgres,service_role=X/postgres}` | `f45c9a8b18e64acc5b3e13612f1d6d86` | production | holds |
| 01 | `20261024110000` :84 (patch 1) | `private.consume_account_operation_nonce_v1` | patch + ACL `{postgres=X/postgres}`, successor `6869593d…` | `933df95029c3f1f8a9a306726fccccff` | the follow-up (#6) | holds; successor holds |
| 03 | `20261025200000` :39, :87 | `public.revoke_cloud_model_consent` | predecessor + ACL, postflight | `40b1b49d088437b24878601795a2a2e0` | production | holds |
| 03 | `20261025200000` :42, :89 | `public.revoke_own_copilot_v1` | predecessor + ACL, postflight | `931fc94abdcb0840ff7a202404c9c4fc` | production | holds |
| 04 | `20261025400000` :53, :86 (patch 1) | `private.adult_subject_invitation_response_v1` | predecessor + ACL `{postgres=X/postgres}`; patches 2-4 chain `d59e9ff8…`, `98b401c1…`, `28635d38…` to `99dfdec6…` | `824901bf47066e4e974bd90f2b1c7110` | production | holds; every successor holds |
| 04 | `20261025400000` :64, :65 | `private.current_adult_subject_invitation_v1` | callee md5, either of two, no ACL | `7fa7e1fe73fc4db2ecf9af8a7b26d265` (repository) or `78d147935e25d657d8df631583c6faea` (production, comment-stripped) | production, comment-stripped | holds (`78d14793`) |
| 04 | `20261025400000` :66 | `private.consume_embryo_operation_nonce_v1` | callee md5 | `db5ce99583d6e1724eae8490eec6a9ef` | production | holds |
| 04 | `20261025400000` :67 | `private.lock_invitation_transitions_v1` | callee md5 | `3a28aeaf4bf736cbba89e3b209649557` | production | holds |
| 04 | `20261025400000` :68 | `private.declare_contact_alias_groups_v1` | callee md5 | `60f413613a40bc0186e1edfc60518863` | production | holds |
| 04 | `20261025400000` :69 | `private.resolve_hmac_set_v1` | callee md5 | `40d84663185bb3fe5fa5b67be4b364e3` | production | holds |
| 04 | `20261025400000` :70 | `private.presented_contact_digest_v1` | callee md5 | `d0fef1099b2a5f5da60b43fc93a82437` | production | holds |

"Production" means the mirror's body has the same pinned def_md5 as production's
2026-10-22 read-back and neither PR 324 nor the follow-up changes it. #3's predecessor
also requires the consumer to contain `'consent_revoke'` with ACL `{postgres=X/postgres}`
(holds). Only `current_adult_subject_invitation_v1`'s md5 depends on `search_path` (its
return type prints schema-qualified without `public` in the path); every other guarded
body renders the same under the session's `"$user", public, extensions` and the pinned
`pg_catalog`. Production's session `search_path` has not been recorded yet (PR 323's
probe did not read it); step 3 of the runbook reads it, and the pre-checks compute this
guard under it, so a path without `public` would show as this guard not ok, a stop.

**Comments matter here, twice.** A transport that dropped full-line comments would make
guards refuse, which is the safe failure. Of the 11 guarded bodies only #4's shared body
(2 lines) and `resolve_hmac_set_v1` (1 line) contain full-line comments; batch 1's have
none. Rehearsed below with each stripped. And production already holds 8
comment-stripped bodies: #4 pinned one of them by its commented text, which was the
defect; it now accepts that body's two reviewed forms.

**Other definition reads:** #1 parses `account_operation_nonces_operation_check` in both
renderings (`'x'::text` and `'{x,...}'::text[]`) and refuses unless it holds
`subject_download_open` (the follow-up's #6 adds it) or if it already holds
`provider_setting_delete`. After the follow-up it is
`CHECK ((operation = ANY (ARRAY['account_delete'::text, …, 'subject_transfer'::text])))`
with 21 values, all read by the parse; #1 re-adds the union with one more as an IN list.
A value outside `[a-z_]+` would be dropped silently, so the pre-checks count every quoted
literal the parse does not read (`nonce_check_values_not_parsed`, rehearsed with an
injected `'x2'`).

## Pre-check stop rules

Run `production-readonly-prechecks.sql` first (`../api/RUNBOOK.md` step 4). Stop unless
all of the following hold. The expected values are the mirror's
(`../rehearsal/data/prechecks-on-mirror-pre.json`).

- `session.current_user` is `postgres`. Record `session.search_path` (the mirror had
  `"$user", public, extensions`); the `#04 … line 64` guard depends on it.
- `ledger` is 280 rows, max `20261023140000`, `above_followup_max` 0,
  `followup_versions_present` 7 and `release_versions_present` 0.
- All 11 `guards` entries `ok: true`, each `have_md5` one of `want_md5s` (the table
  above) and `proacl` equal to `want_acl` where one is given.
- Every `must_be_zero` value is 0. There are 12 keys: `guarded_bodies_not_as_rehearsed`,
  `consumer_without_consent_revoke`, `prerequisite_signatures_missing` (12 exact
  signatures, `auth.jwt()` included), `prerequisite_functions_missing` (11),
  `prerequisite_relations_missing` (6), `prerequisite_columns_missing` (6, among them
  `auth.sessions.not_after` and `auth.users.deleted_at`, which #2's door reads at run
  time), `roles_missing` (4), `release_functions_present` (6), `release_relations_present`,
  `nonce_check_without_subject_download_open`, `nonce_check_with_provider_setting_delete`,
  `nonce_check_values_not_parsed`.
- `definitions.parsed_like_110000` is the 21 values and `literal_count` 21.
- `compat_must_be_zero.pending_adult_invitations` and
  `.active_adult_invitation_rights_sessions`: not a stop by themselves. Not 0 means a
  person can meet the batch-2 window (their Path A confirmation answers 404 until the
  merge is deployed). Show the owner; go on only on the owner's word.

Read before choosing the window: `sizes.account_operation_nonces` (batch 1's check
validation under ACCESS EXCLUSIVE) and `context.unconsumed_account_operation_nonces`
(the nonce flows that may wait on that lock).

## Production commands

The transport, probes and exact command sequence are in `../api/RUNBOOK.md`. The same
files run under psql over a session-level connection with the command shape below,
which the rehearsal used:

```sh
PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '180s'" -f batch-$k-dry-run.sql   # rc=3, exactly one ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED
```

Order: pre-checks and the pre-state read-back (EQUAL batch 1 pre); the whole-release dry
run (sentinel), then a read-back (EQUAL batch 1 pre). Then, for k = 1, 2: the dry run
(sentinel), a read-back (EQUAL k pre), the apply (rc 0), a read-back (EQUAL k post), and
the ledger.

| After batch | Rows | Max version |
|---|---|---|
| (the follow-up's release) | 280 | `20261023140000` |
| 1 | 283 | `20261025200000` |
| 2 | 284 | `20261025400000` |

## Stop rules

- Any `SHA256SUMS` line not OK, or `generate.py --head <head to merge>` refusing: stop.
  It refuses every head that does not carry the revised `20261025400000`, `d8dcb61a` and
  everything up to `61ffc6ee` included.
- The follow-up's release not complete and EQUAL, or its code not merged and deployed with
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
- Stopping after batch 1 is safe for the deployed code. Resume later from batch 2's dry
  run. Run batch 2 only when the merge can follow at once.
- Never merge before batch 2 reads back EQUAL. Never run `supabase db push` or apply any
  migration file directly in between.

## The mirror the batches were rehearsed on

Built by `../rehearsal/scripts/build-mirror.sh`, which follows the follow-up kit's
`build-mirror.sh` and `apply-pr324-kit.sh` step for step, on the local stack instead of an
isolated one (`../rehearsal/data/mirror-builds.txt`):

1. `supabase db reset --local --version 20261011010251` from the repository root. The 245
   working-tree files up to that version are asserted blob-identical to main `12f24475`'s
   245. The fresh-main fingerprint is byte-identical to the reference fresh build
   (`8860eee4…`).
2. 3 ledger stand-ins (248 rows, max `20261011010251`); the 8 comment-stripped bodies,
   whose per-line hashes equal `prod-linehash.txt` (read from production on 15 October);
   `pg_cron` 1.6.4. The full fingerprint equals production's 2026-10-22 read-back
   (`fp-after-merge.json`) object for object: RESULT EQUAL.
3. PR 324's four guarded batches from its kit (`generate.py --head cf79b1b6 final`, its 20
   `SHA256SUMS` lines OK), each dry run rc 3 with exactly the sentinel and read back EQUAL to
   its pre-state, each apply rc 0 and read back EQUAL to its post-state; ledger 273 /
   `20261016221000`; fingerprint byte-identical to PR 324's rehearsed final mirror
   (`4d2a2747…`).
4. The follow-up's two guarded batches from its kit (`generate.py --head 77d04563 final`,
   its 15 `SHA256SUMS` lines OK), the same way; ledger 280 / `20261023140000`; fingerprint
   byte-identical to the follow-up's rehearsed final mirror (`3a0f4d68…`, its
   `rehearsal/data/equivalence.txt`), and its summary EQUAL to the follow-up's batch-2
   post-state.

So **this release's pre-state equals the follow-up kit's recorded post-state, byte for
byte.** A plain `supabase db reset --version 20261023140000` does not: it lacks
production's drift (8 def_md5 values and `pg_cron`; `../rehearsal/data/equivalence.txt`).
The mirror was built nine times (four for the first rehearsal, five for the second;
twice stopped after PR 324's batches for a negative check), every read-back EQUAL and
every fingerprint as above each time.

## Rehearsal results (second rehearsal, on the mirror)

Command shape: `PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c
"set statement_timeout = '180s'" -f <file>`. The whole-release dry run used `'2min'`, the
Management API session's value. Local seconds include psql start-up
(`../rehearsal/data/rehearsal-results.tsv`).

**Pre-checks** on the pre-state: every `must_be_zero` and `compat_must_be_zero` value 0,
11 of 11 guards `ok` (`../rehearsal/data/prechecks-on-mirror-pre.json`).

**Whole-release dry run** on the pre-state: rc 3, exactly one `ERROR:
DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 0.44 s. The fingerprint and ledger were unchanged
afterwards, and the read-back EQUAL batch 1 pre. It was repeated from the final
`SHA256SUMS` state (14 of 14 lines OK) on a rebuilt mirror: rc 3, the sentinel,
unchanged; both batches then applied and read back EQUAL, to the same final fingerprint
(`../rehearsal/data/final-pass.txt`).

**The revised guard** (`../rehearsal/data/guard-cases.tsv`), each case one rolled-back
transaction on the pre-state, the file run as the CLI runs it, state unchanged after:

| Case | Callee md5 | Distinct callees matched (of 6) | Result |
|---|---|---|---|
| Production's comment-stripped body (the mirror as built) | `78d14793…` | 6 | applies; the door exists |
| The repository body restored | `7fa7e1fe…` | 6 | applies; the door exists |
| A third body: production's with one token changed (`d.fixed_expires_at > v_now` to `>=`) | `2eac3ff2…` | 5 | `path a typed name prerequisite differs` |
| The callee missing (renamed away) | absent | 5 | `path a typed name prerequisite differs` |
| Another callee changed (`resolve_hmac_set_v1` without its comment line) | `78d14793…` | 5 | `path a typed name prerequisite differs` |

**Negative checks** (state unchanged after each):

| Check | Result |
|---|---|
| Batch-1 dry run without a session `statement_timeout` | rc 3, `session: set statement_timeout to at most 180s for the session before this statement (a SET inside the block does not bound it)` |
| Batch-1 dry run with `statement_timeout = '190s'` | the same |
| Batch-2 dry run, and its apply, before batch 1 | rc 3, `predecessor: ledger has 280 rows, max 20261023140000; expected 283 rows, max 20261025200000` |
| Batch-1 apply with one byte of the embedded `20261024110000` changed | rc 3, `integrity: embedded 20261024110000_copilot_settings_delete_nonce.sql is not the reviewed file` |
| Batch-2 apply with one byte of the embedded `20261025400000` changed (its stripped-body md5) | rc 3, `integrity: embedded 20261025400000_path_a_account_accept_typed_name.sql is not the reviewed file` |
| Batch-1 apply with the embedded fingerprint query changed | rc 3, `integrity: the embedded fingerprint query is not fingerprint.sql` |
| Whole-release dry run and batch-1 apply on the mirror **before the follow-up's release** (PR 324's post-state) | both `predecessor: ledger has 273 rows, max 20261016221000; expected 280 rows, max 20261023140000`; the pre-checks run there and report `prerequisite_signatures_missing`, `prerequisite_functions_missing`, `consumer_without_consent_revoke`, `guarded_bodies_not_as_rehearsed` and `nonce_check_without_subject_download_open` 1 each (the follow-up's consumer is absent) |
| Re-apply of each batch after it | batch 1: `predecessor: ledger has 283 rows, max 20261025200000; expected 280 rows, max 20261023140000`; batch 2: `… 284 rows, max 20261025400000; expected 283 rows, max 20261025200000` |
| One extra grant on `public.remove_own_copilot_settings_v1` (rolled back) | pre-checks: the `#01` guard not ok (md5 equal, ACL differs); whole-release dry run: `predecessor: fingerprint summary differs`; #1 as a file: `copilot settings delete nonce prerequisite differs` |
| `private.adult_subject_invitation_response_v1` with its 2 comment lines stripped, as a comment-dropping transport would leave it (rolled back) | pre-checks: the `#04` line-53 guard not ok (have `b592c152…`); whole-release dry run: `predecessor: fingerprint summary differs`; #4 as a file: `path a typed name prerequisite differs` |
| An operation check holding a value the parse cannot read (`'x2'`, rolled back) | pre-checks: `nonce_check_values_not_parsed = 1` |
| `generate.py --head d8dcb61a` (the unrevised `20261025400000`) | `head d8dcb61a…: supabase/migrations tree 151259da… is not the rehearsed tree be49d283…` |
| `generate.py` with `REV_TREE` a tree whose earlier migration changed (scratch clone) | `earlier migration changed or missing in d868ee8f: supabase/migrations/20261023140000_review_download_clock.sql` |
| `generate.py --head` a commit whose `20261025400000` changed again (scratch clone) | `... tree 4fbbb521… is not the rehearsed tree be49d283…` |
| `generate.py --head` a commit carrying exactly `be49d283` (scratch clone; what the commit of the revised file will do) | accepted |

Details: `../rehearsal/data/negatives.tsv`, `generator-negatives.txt`.

**Per batch:**

| Batch | Lock probe | Dry run (output, local seconds, state after, read-back) | Apply (output, local seconds, read-back) | Ledger after | Re-apply |
|---|---|---|---|---|---|
| 1 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 0.342 s, unchanged, EQUAL 1 pre | rc 0 `SET DO`, 0.357 s, EQUAL 1 post | 283 rows, max 20261025200000 | rc 3 on the ledger, unchanged |
| 2 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 sentinel, 0.294 s, unchanged, EQUAL 2 pre | rc 0 `SET DO`, 0.291 s, EQUAL 2 post | 284 rows, max 20261025400000 | rc 3 on the ledger, unchanged |

**Timings.** Measured inside the block, batch 1's migrations and its postcheck
fingerprint take 0.12 s and batch 2's 0.11 s; the 4 migrations alone take 0.019 s
(`../rehearsal/data/locktrace.txt`). The longest local statement is the whole-release dry
run, 0.44 s with psql start-up. The binding limit in production is the endpoint's
2-minute `statement_timeout` (the guard allows up to 180 s); every batch finishes locally
in under 1 % of it. Production adds lock waits, which `lock_timeout` 10 s bounds, and
data: only #1's check rebuild scans a table (`sizes.account_operation_nonces`).

**pgTAP.** Each suite run left the fingerprint and ledger unchanged
(`../rehearsal/data/pgtap-summaries.txt`):

| State | Suite | Files | Tests | Result |
|---|---|---|---|---|
| Fresh build of the working tree (281, revised #4) | `path_a_account_accept_typed_name.sql` | 1 | 52 | PASS |
| Fresh build of the working tree | the whole suite (`supabase/tests`) | 239 | 16,179 | PASS (453 s) |
| Mirror, final state (after both batches) | `copilot_settings_delete_nonce.sql`, `session_csrf_tokens.sql`, `consent_revoke_provider_nonce.sql`, `path_a_account_accept_typed_name.sql` | 4 | 24, 30, 34, 52 | PASS each |
| Mirror, pre-state (first rehearsal) | the follow-up's, `77d04563` | 235 | 16,034 | PASS |
| Mirror, after batch 1 (first rehearsal) | the follow-up's, `77d04563` | 235 | 16,034 | FAIL 4: `export_member_plan` 2, 3, 13; `legal_audit_attribution_completeness` 77 |
| Mirror, final state | the follow-up's, `77d04563` | 235 | 15,904 run | FAIL: the same 4, plus 17 Path A acceptance assertions in 6 files, 2 of which stop early (`../compat-analysis.md`, "Old-contract failures") |

The 4 suites ran with `pnpm exec supabase test db --local supabase/tests/<file>` after
`pnpm gate:sql-includes`. The suites' wall clock is a local test run, not a release step.

**Order equivalence** (`../rehearsal/data/equivalence.txt`). Dumps are pg_dump 17.6
`--schema-only`, normalised by dropping its two random `\restrict`/`\unrestrict` key lines.

- **Fresh `77d04563` tree + the 4 (`psql -1 -f` each, 0.25 s) against a fresh build of
  all 281.** The fingerprints are byte-identical (SHA-256 `6eb6981f…`) and the normalised
  dumps are identical (102,248 lines, `a9feb07b…`). `6eb6981f…` is also a fresh build's
  fingerprint before the guard was revised: the revision changes no object.
- **The rehearsed final mirror (production mirror + PR 324's four guarded batches + the
  follow-up's two + this kit's two) against a fresh build of all 281 with the same drift
  applied.** The fingerprints are byte-identical (`7bef9657…`) and the normalised dumps
  are identical (102,326 lines, `c165c63e…`). The final pass reached the same fingerprint.
- **A plain fresh build through `20261023140000` against the follow-up kit's recorded
  post-state.** Not equal: its fingerprint (`04c167c3…`, the same as the follow-up kit's
  own fresh `77d04563` build) differs only in the 8 drifted `def_md5` values and the
  `pg_cron` row.

Expected final production state: batch 2's post-state above (functions 1,423 /
`befdb108…`, tables 268 / `5926d879…`, the rest unchanged from the follow-up's
post-state).

## Deploy-window conclusions (details and file:line in `../compat-analysis.md`)

- **The 4 migrations: 2 additive-safe (#2, #3), 1 safe-with-reason (#1), 1
  BREAKS-OLD-CODE (#4).** The follow-up's production-reachable code is compatible at the
  batch boundary. After batch 2 its Path A confirmation (`api.withdraw`) answers 404 until
  the merge is deployed; refusing and deleting are unchanged. It is reachable only through
  a pending adult invitation, which the deployed code cannot create in production;
  `compat_must_be_zero` counts the ones that exist. The revision of #4's guard changes none
  of this: it widens only which pre-state the file accepts, and the file's changes are the
  same (measured on the mirror and on a fresh build).
- **The new code needs all 4.** Before #2 it refuses every request on its 38 CSRF-bound
  routes; before #1, #3 and #4 it fails Settings → AI removal, the cloud-model and
  own-Copilot consent revocations and every Path A acceptance. Merge only after batch 2,
  and straight after it.
- **Locks.** Batch 1 holds ACCESS EXCLUSIVE on `account_operation_nonces` for its
  sub-second run: account deletion and its cancel, own upload signing and completion, the
  other-adult artifact, consents revoke-all, subject delete and sharing stop, and every
  other nonce door wait. Batch 2 locks no existing table beyond ACCESS SHARE. No `auth` or
  `storage` table is locked beyond ACCESS SHARE reads. A lock wait beyond 10 s cancels the
  batch, which is safe to retry later.
- **Outside the fingerprint.** It does not cover `auth`; #2's door reads
  `auth.sessions(id, user_id, not_after)` and `auth.users(id, deleted_at)`, which the
  pre-checks check. No file grants to `anon`, `authenticated` or PUBLIC; the 5 new public
  functions are `service_role` only, the new table is closed to every API role.

## Open point for the owner: which commit merges after the follow-up's release

Not a decision; recorded so it is decided before release 2 runs (`../api/RUNBOOK.md`,
step 0 item 2):

- The follow-up kit's step-0 precondition requires the head it merges to carry tree
  `259a56dd`. The follow-up branch head no longer does: from `6f9ca860` on it carries
  these four files, so `generate.py --head <follow-up head>` in that kit refuses.
- This kit's precondition requires the code deployed before it to carry tree `259a56dd`
  too. The last commit on the follow-up branch with that tree is `e81bd2be`.
- Alternatives seen, none chosen: (a) merge a commit carrying `259a56dd` (for example
  `e81bd2be`) after release 2, then run this release and merge the head carrying
  `be49d283`; (b) run release 2 and this release back to back and merge once, at the
  head carrying `be49d283` (the deployed code during both is then PR 324's, `cf79b1b6`;
  its call sites for these four files are the same, `../compat-analysis.md`), which needs
  the follow-up kit's step 7 and this kit's step 0 restated; (c) split this release: run
  batch 1 and merge `91b955a7` (the last commit before `73c30779`; its tree `3524777f`
  carries #1-#3 and not #4), then batch 2 and the rest, which needs this kit re-pinned for
  two releases and `91b955a7`'s code checked against batch 1's schema.

## Local state afterwards

The local stack (project `sequence`) was left running. Its database was reset at the end
with `supabase db reset --local` to the working tree's 281 migrations, the revised
`20261025400000` included (ledger 281 rows, max `20261025400000`; fingerprint
`6eb6981f…`). pgTAP was dropped after each suite. The batch files PR 324's and the
follow-up's kits regenerated for the mirror builds (ignored by git) were removed; this
kit's generated `.sql` files are ignored by git and recreated by `generate.py final`.
Scratch logs, fingerprints and dumps were kept outside the repository; their SHA-256
values are in `../rehearsal/data/`.
