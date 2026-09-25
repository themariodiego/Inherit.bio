# Export content reader, applied to production — 25 September 2026

`supabase/migrations/20260925130000_export_archive_content_reader.sql` (SHA-256
`52f06e25…6ed5`, text MD5 `e4e9a6e5…f82d`) merged to `main` in #211 and was
applied to production project `zuvloczwgrayonqabnss` the same day. The owner
decided this order for export migrations: merge first, then apply guarded
(`docs/protocol/decisions.md`, 25 September), and confirmed this apply in chat
after it merged. **G5.6 stays NO.** The migration adds one service-only,
read-only function. Nothing in the deployed application calls it, and the
publication hold on segmented exports is unchanged.

## How it was applied

[`apply.sql`](apply.sql) (SHA-256 `17595d69…0bc6`) is one `DO` statement, so it
is atomic whatever the client does with multi-statement text, as in the
[export persistence apply](../export-persistence-production-apply-20260925/README.md).
In order, it:

1. Refuses unless the embedded migration text has the reviewed file's MD5.
2. Checks predecessors. The version must be absent from the ledger and the
   export persistence row (`20260923123240`) present. The reader must not
   exist yet. The five existing functions it calls must hash to the
   definitions the local suite ran against:

   | Function | Definition MD5 |
   | --- | --- |
   | `private.export_archive_current_v1(uuid,text)` | `707ebdae…01f6` |
   | `private.own_export_source_v1(uuid,uuid,uuid)` | `27abc582…9d6f` |
   | `private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)` | `17ea9257…71d2` |
   | `private.current_own_report_grant_read_v1(uuid,uuid,uuid,text)` | `9169efeb…ddf9` |
   | `private.own_analysis_completion_matches_v1(uuid,text,jsonb)` | `21fc418c…8d49` |

3. Executes the migration verbatim.
4. Postchecks the new function against the definition hash measured on the
   tested local stack (`608ff467…7d07`). It must be security definer with
   `search_path=pg_catalog, private`. `anon`, `authenticated` and
   `inherit_upload_only` must not be able to execute it, and `service_role`
   must. The five dependencies are checked again, unchanged.
5. Inserts the ledger row under the repository's own version and name, with
   the migration text as its one statement.

[`dry-run.sql`](dry-run.sql) (SHA-256 `52f8b54f…bbf9`) is the same statement
ending in a forced exception.

## Rehearsal and execution

| Step | Result |
| --- | --- |
| Local database reset to production's migration set (`main` at `f152db81`, before #211) | 126 ledger rows; reader absent |
| Dependency hashes, local and production, read-only | All five equal; both PostgreSQL 17.6 |
| New function's definition hash, measured locally in a rolled-back transaction | `608ff467…7d07`; nothing left after rollback |
| Local dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; state unchanged |
| Local apply | Reader created; ledger statement MD5 equals the file's |
| Local re-run | Refused: already in the ledger |
| `export_archive_content_reader.sql` and `export_archive_persistence.sql` pgTAP against the rehearsed apply | 121 of 121 (44 and 77) |
| Production pre-state, read-only | 127 ledger rows without this version; reader absent; persistence row MD5 `a72e4629…3a87`; 0 exports, 0 jobs |
| Production dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, then the state was re-read unchanged |
| Production apply | Committed without error |

## Production after the apply (read at 18:48:02 UTC)

- Ledger: 128 rows. `20260925130000` / `export_archive_content_reader` holds
  one statement, MD5 `e4e9a6e530ba8e883101e5474ab82f9d`, equal to the file.
- `public.export_archive_content_v1` hashes to
  `608ff467d38e2816af7375b4ffba7d07`. It is security definer, with
  `search_path=pg_catalog, private`.
- `anon`, `authenticated` and `inherit_upload_only` cannot execute it;
  `service_role` can.
- 0 rows in `generated_exports` and in `private.export_archive_jobs`.

No user data was read or written. Both export migrations merged to `main` are
now applied. Many older production ledger rows carry versions other than the
repository's file names; that history is D-106's, and this receipt does not
change it.
