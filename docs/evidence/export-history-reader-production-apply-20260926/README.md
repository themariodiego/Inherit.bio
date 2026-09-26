# Export history reader, applied to production — 26 September 2026

`supabase/migrations/20260925210000_export_archive_history_reader.sql` (SHA-256
`291ffcef…09c9`, text MD5 `699e5149…07a1`) merged to `main` in #215 at
08:31:32 UTC. It was applied to production project `zuvloczwgrayonqabnss`
before 08:34:54 UTC, when the result was read back. The owner decided this
order for export migrations: merge first, then apply guarded
(`docs/protocol/decisions.md`, 25 September). **G5.6 stays NO.**

The migration replaces two existing service-only functions:

- `private.export_archive_authority_v1` now builds the `export-authority-v2`
  graph, which adds the requester's own history.
- `public.export_archive_content_v1` gains the read-only `history` operation.

Nothing in the deployed application reaches either function. Both are reached
only through the export RPCs: the authority from `export_archive_request_v1`
and from `private.export_archive_current_v1`, which the request, worker and
content RPCs call. The one application module naming any of them,
`src/lib/exports/archive-persistence.ts`, is imported only by its test. The
publication hold on segmented exports is unchanged.

## How it was applied

[`apply.sql`](apply.sql) (SHA-256 `7f2054ec…adae`) is one `DO` statement, so it
is atomic whatever the client does with multi-statement text, as in the
[content reader apply](../export-content-reader-production-apply-20260925/README.md).
In order, it:

1. Refuses unless the embedded migration text has the reviewed file's MD5.
2. Checks predecessors:
   - the version is absent from the ledger;
   - the jurisdiction declaration row (`20260925140000`) is present;
   - no export job exists, because a job captured under v1 would fail closed
     under the new receipt;
   - the two functions it replaces hash to the applied definitions:

   | Function | Definition MD5 before |
   | --- | --- |
   | `private.export_archive_authority_v1(jsonb,text,uuid)` | `c8b8b804…dbd5` |
   | `public.export_archive_content_v1(text,uuid,uuid,text,jsonb)` | `608ff467…7d07` |

   - the five existing functions the reader calls hash to the definitions the
     local suite ran against:

   | Function | Definition MD5 |
   | --- | --- |
   | `private.export_archive_current_v1(uuid,text)` | `707ebdae…01f6` |
   | `private.own_export_source_v1(uuid,uuid,uuid)` | `27abc582…9d6f` |
   | `private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)` | `17ea9257…71d2` |
   | `private.current_own_report_grant_read_v1(uuid,uuid,uuid,text)` | `9169efeb…ddf9` |
   | `private.own_analysis_completion_matches_v1(uuid,text,jsonb)` | `21fc418c…8d49` |

3. Executes the migration verbatim.
4. Postchecks both functions against the definition hashes measured on the
   tested local stack (authority `195dd68d…1051`, reader `21713437…1b73`):
   - both are security definer with `search_path=pg_catalog, private`;
   - `anon`, `authenticated` and `inherit_upload_only` cannot execute the
     reader, and `service_role` can;
   - `anon`, `authenticated` and `service_role` cannot execute the authority;
   - the five dependencies are unchanged.
5. Inserts the ledger row under the repository's own version and name, with
   the migration text as its one statement.

[`dry-run.sql`](dry-run.sql) (SHA-256 `60bb6eb5…54df`) is the same statement
ending in a forced exception.

## Rehearsal and execution

| Step | Result |
| --- | --- |
| Local database reset to `main` at `00cc11db`, before #215 | Authority `c8b8b804…`, reader `608ff467…`, as in production; `service_role` cannot execute the authority |
| Local dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; reader unchanged, version absent |
| Local apply | Reader `21713437…`; ledger row present, statement MD5 equal to the file's |
| Local re-run | Refused: already in the ledger |
| `export_archive_history_reader.sql`, `export_archive_content_reader.sql` and `export_archive_persistence.sql` pgTAP against the rehearsed apply | 181 of 181 (60, 44 and 77) |
| Production pre-state, read-only (25 September) | 129 ledger rows without this version; both functions and all five dependencies at the hashes above; 0 jobs |
| Production dry run (25 September) | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED` |
| Production state re-read before merging (26 September) | Unchanged: 129 rows, version absent, both hashes as before, 0 jobs |
| #215 merged | `6aef5a2a`, 08:31:32 UTC; CI green on the pull request's head `65817dab` |
| Production apply | Committed without error |

The local ledger has one row fewer than production's, because the two differ
by name in five places, none of them an export migration:

- three production rows have no file of that name on `main`:
  `install_own_report_retention_scheduler`, `own_genome_release_phase_a_guarded`
  and `own_genome_release_phase_c_guarded`;
- two files on `main` have no production row: `embryo_cohort_finalize_public_door`
  and `embryo_ingest_chunk_public_doors`.

This receipt changes none of them.

## Production after the apply (read at 08:34:54 and 08:37:20 UTC)

- Ledger: 130 rows. `20260925210000` / `export_archive_history_reader` holds
  one statement, MD5 `699e514985a9eb2367891ced248307a1`, equal to the file.
- `private.export_archive_authority_v1` hashes to
  `195dd68dd9fddd4adf4170ca5e6c1051`, and `public.export_archive_content_v1`
  to `2171343767e097f9b78e717e88b11b73`.
- Both are security definer, with `search_path=pg_catalog, private`.
- `anon`, `authenticated` and `inherit_upload_only` cannot execute the reader;
  `service_role` can. `anon`, `authenticated` and `service_role` cannot execute
  the authority.
- The five dependencies still hash to the values above.
- 0 rows in `generated_exports` and in `private.export_archive_jobs`.
- PostgreSQL 17.6.

No user data was read or written. Every export migration merged to `main` is now
applied. Many older production ledger rows carry versions other than the
repository's file names; that history is D-106's, and this receipt does not
change it.
