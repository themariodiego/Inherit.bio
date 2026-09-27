# Export persistence, applied to production — 25 September 2026

`supabase/migrations/20260923123240_export_archive_persistence.sql` (SHA-256
`2887fcd1…a6c5`, text MD5 `a72e4629…3a87`) merged to `main` in #210 and was
applied to production project `zuvloczwgrayonqabnss` the same day. The owner
decided this order: merge first, then apply guarded (`docs/protocol/decisions.md`,
25 September). **G5.6 stays NO.** The migration activates no route, worker,
scheduler, Storage write or download, and its ready-publication trigger refuses
every segmented export from becoming ready.

## How it was applied

[`apply.sql`](apply.sql) (SHA-256 `f5477eab…5b29`) is one `DO` statement, so it
is atomic whatever the client does with multi-statement text. That mattered.
The first local rehearsal used a plain script ending in a forced exception.
`psql` runs each statement on its own, so that "dry run" applied everything
and rolled nothing back. The script was rebuilt as a single statement before
anything touched production. In order, it:

1. Refuses unless the embedded migration text has the reviewed file's MD5.
2. Checks predecessors. The version must be absent from the ledger, and the
   23 September guarded-release row present. No export table or `exports`
   bucket may exist. `private.own_export_source_v1`, the one existing function
   the migration calls, must hash to `27abc582…`, the definition the local
   suite ran against. Exactly one single-object ready constraint must exist,
   with the expected definition.
3. Executes the migration verbatim.
4. Postchecks nine created functions against the definition hashes measured on
   the tested local stack, the six tables, both `generated_exports` triggers,
   the new ready constraint, the private bucket, and that no browser role can
   execute an export RPC.
5. Inserts the ledger row under the repository's own version and name, with
   the migration text as its one statement, as the CLI records it.

[`dry-run.sql`](dry-run.sql) is the same statement ending in a forced exception.

## Rehearsal and execution

| Step | Result |
| --- | --- |
| Local database reset to production's pre-state (`main` before #210, plus a stand-in for the guarded-release ledger row) | Export objects absent |
| Local dry run | Every check passed; state unchanged afterwards |
| Local apply | Objects created; ledger statement MD5 equals the file's |
| Local re-run | Refused: already in the ledger |
| `export_archive_persistence.sql` pgTAP against the rehearsed apply | 77 of 77 |
| Production pre-state, read-only | Ledger 126 rows without this version; no bucket; one ready constraint as expected; 0 export rows; dependency hash equal |
| Production dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, then the state was re-read unchanged |
| Production apply | Committed without error |

## Production after the apply (read at 15:49:08 UTC)

- Ledger: 127 rows. `20260923123240` / `export_archive_persistence` holds one
  statement, MD5 `a72e462985670055e5fe14589a023a87`, equal to the file.
- Six `private.export_archive_*` tables, all with row-level security on.
- Bucket `exports`: private, 4,000,000-byte limit, `application/octet-stream`.
- Triggers on `generated_exports`: `guard_export_archive_delete`,
  `guard_segmented_export_publication`.
- `authenticated` cannot execute `export_archive_request_v1`; `service_role` can.
- 0 rows in `generated_exports`; `own_export_source_v1` unchanged.

No user data was read or written. The deployed application calls none of these
functions. The content reader (#211) is the next migration, applied the same
way once it merges.
