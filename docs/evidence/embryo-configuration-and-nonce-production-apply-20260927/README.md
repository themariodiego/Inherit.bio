# Embryo session configuration and nonce lockdown, applied to production — 27 September 2026

Two migrations from the draft pull requests the owner chose to land on 27
September were applied to production project `zuvloczwgrayonqabnss`, each
after its pull request merged:

| Migration | Landed by | SHA-256 | Text MD5 |
| --- | --- | --- | --- |
| `20260927120000_embryo_ingest_session_configuration.sql` | #233 (from #198), merged `1dd179b7` | `9a0d0f3c…7799` | `c82686d9…31b5` |
| `20260927130000_embryo_nonce_capabilities.sql` | #234 (from #205), merged `9bd0eb42` | `243f7c01…beb2` | `3ffa89eb…916f` |

Merging first and applying second is safe here, because nothing in the
deployed application reaches either migration:
- the configuration writers are private, service-only functions that no route
  calls, and embryo ingest stays disabled (`EMBRYO_INGEST_AVAILABLE` is false);
- the nonce lockdown only removes `service_role` grants that no application
  code uses. The one function the app calls, the retention job's
  `expire_invitation_refusal_receipts_v1`, keeps its behaviour.

The applies keep production's migration ledger equal to `main` (D-106, D-132).
The owner chose to land both pull requests; the owner has given standing
permission in this goal to run SQL on production as engineering sees fit.
Each apply used the guarded, dry-run-first procedure of the earlier receipts,
and wrote nothing beyond its migration and ledger row.

## How each was applied

Each apply is one `DO` statement: [`configuration-apply.sql`](configuration-apply.sql)
(SHA-256 `bf2370ae…17ee`) and [`nonce-apply.sql`](nonce-apply.sql)
(`728f2ec8…fab6`). In order, each:

1. Refuses unless the embedded migration text has the reviewed file's MD5.
2. **Predecessor checks**, against values measured identically on production
   and on the rehearsal stack by one read-only query each:
   - its version is absent from the ledger, and the previous one is present;
   - nothing it creates exists yet;
   - the definitions, columns, constraints, triggers, indexes and privileges it
     touches or depends on hash to the tested values;
   - it snapshots the row counts it must not change.
3. Executes the migration verbatim.
4. **Postchecks** against the definitions measured on the tested stack:
   function hashes, security-definer settings, triggers enabled, browser roles
   unable to execute anything new, the intended `service_role` grants, row
   counts unchanged and dependencies unchanged.
5. Inserts the ledger row under the repository's own version and name.

The matching `*-dry-run.sql` files are the same statements ending in a forced
exception.

## Configuration writers (#233)

The migration adds three columns to `embryo_ingest_sessions`, seven to
`embryo_mapping_challenges`, and one allowed nonce target kind
(`ingest_session`). It also adds two immutability triggers and four private
functions. Three of those functions are the writers, executable by
`service_role` only.

| Step | Result |
| --- | --- |
| Pre-state, one read-only query on production and on the local stack | Identical hashes for the three tables' columns, constraints, triggers and indexes, and for `authorize_embryo_ingest_request_v1`, `consume_embryo_operation_nonce_v1` and `mark_embryo_ingest_failure_v1`. No embryo sessions, challenges or nonces; PostgreSQL 17.6 on both |
| Post-migration definitions, measured locally in a rolled-back transaction | As embedded in the statement |
| Local dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; state unchanged |
| Local apply, then re-run | Applied; ledger statement MD5 equal to the file's; the re-run refused (`already in the ledger`) |
| pgTAP against the rehearsed apply | Full suite, 96 files, 4,075 assertions, all pass |
| CI on #233's head `491821dc` | `checks` and `guided-first-run` green |
| #233 merged | `1dd179b7` |
| Production dry run, after the merge | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED` |
| Production apply | Committed; read back at 18:24:35 UTC |

Production after the apply (read at 18:24:35 UTC):
- Ledger: 133 rows, the last `20260927120000` /
  `embryo_ingest_session_configuration`. It holds one statement, MD5
  `c82686d9…31b5`, equal to the file.
- All six new functions hash exactly as tested; both triggers are enabled.
- No browser role can execute any of them.
- Still no embryo sessions, challenges or nonces.

## Nonce lockdown (#234)

The migration revokes `service_role`'s direct EXECUTE on
`private.consume_embryo_operation_nonce_v1` and its write grants on
`public.embryo_operation_nonces`. `service_role` keeps SELECT. Every operation
that consumes a nonce already runs as a security definer, so none of them is
affected. `public.expire_invitation_refusal_receipts_v1()`, which the
retention job calls, becomes an invoker facade over a new private definer
with the same predicate and first lock.

| Step | Result |
| --- | --- |
| Checks before landing | Nothing under `src/` writes the table or calls the consumer. Of the 20 functions that touch the table, the only non-definer ones are the expiry facade and `private.refuse_co_parent_invitation_v1`, which no role can call directly |
| Pre-state, local stack with #198 applied, and production after #198's apply | Identical: the consumer, the invitation lock and the public expiry hash the same; the same function and table privileges; no nonce rows |
| Post-migration definitions, measured locally in a rolled-back transaction | As embedded in the statement |
| Local dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; state unchanged |
| Local apply, then re-run | Applied; ledger statement MD5 equal to the file's; the re-run refused |
| pgTAP and the two-backend lock suite against the rehearsed apply | Full suite, 97 files, 4,170 assertions, all pass; 31 of 31 independent-session lock checks pass, including the expiry |
| CI on #234's head `ccf0e8f1` | `checks` and `guided-first-run` green |
| #234 merged | `9bd0eb42`, 19:47 UTC |
| Production dry run, after the merge | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED` |
| Production apply | Committed; read back at 20:02:42 UTC |

Production after the apply (read at 20:02:42 UTC):
- Ledger: 134 rows, the last `20260927130000` / `embryo_nonce_capabilities`.
  It holds one statement, MD5 `3ffa89eb…916f`, equal to the file.
- The private expiry hashes `ac4edfb4…394e` and the public facade
  `8db791cf…f9bc`, as tested.
- `service_role` cannot execute the nonce consumer. On the nonce table it has
  SELECT only; it can still execute both expiry functions.
- No nonce rows.

The retention job still works:
- The retention cron runs every minute. It answered 200 before and after the
  apply, and Vercel logged no runtime error from 19:40 UTC onward.
- That route counts a failed expiry without failing, so a 200 alone proves
  nothing. The expiry was therefore also called on production as
  `service_role`, inside a block that raised at the end so nothing was kept.
  It returned 0 rows and no error.

## Not claimed

Neither migration enables embryo ingest, accepts source bytes, or changes a
release acceptance row. No user data was read or written beyond the counts
above.
