# Export chat reader, applied to production — 26 September 2026

`supabase/migrations/20260925220000_export_archive_chat_reader.sql` (SHA-256
`64244611…f11e`, text MD5 `b90a5270…7ee8`) merged to `main` in #216 at
09:03:50 UTC. It was applied to production project `zuvloczwgrayonqabnss`
before 09:06:38 UTC, when the result was read back. The owner decided this
order for export migrations: merge first, then apply guarded
(`docs/protocol/decisions.md`, 25 September). Before the merge, the owner
confirmed the migration's two chat choices (26 September). **G5.6 stays NO.**

The migration:

- replaces `private.export_archive_authority_v1`, which now builds the
  `export-authority-v3` graph, adding each own chat with a digest of its
  messages;
- replaces `public.export_archive_content_v1`, which gains the `chats` and
  `chat-messages` operations;
- creates `private.export_archive_chat_messages_v1`, which decides which chats
  and turns can be exported. No role can execute it directly, including
  `service_role`.

Nothing in the deployed application reaches any of them. The export functions
are reached only through the export RPCs, and the one application module naming
those RPCs, `src/lib/exports/archive-persistence.ts`, is imported only by its
test. The publication hold on segmented exports is unchanged.

## How it was applied

[`apply.sql`](apply.sql) (SHA-256 `d85cbbbc…7e6e`) is one `DO` statement, as in
the [history reader apply](../export-history-reader-production-apply-20260926/README.md).
In order, it:

1. Refuses unless the embedded migration text has the reviewed file's MD5.
2. Checks predecessors:
   - the version is absent from the ledger;
   - the history reader row (`20260925210000`) is present;
   - no export job exists, because a v2 job would fail closed under v3;
   - the replaced functions are the applied v2 definitions, and the helper
     does not exist yet:

   | Function | Definition MD5 before |
   | --- | --- |
   | `private.export_archive_authority_v1(jsonb,text,uuid)` | `195dd68d…1051` |
   | `public.export_archive_content_v1(text,uuid,uuid,text,jsonb)` | `21713437…1b73` |
   | `private.export_archive_chat_messages_v1(uuid,uuid,uuid,bigint,integer)` | absent |

   - the six existing functions the new code calls hash to the definitions the
     local suite ran against:

   | Function | Definition MD5 |
   | --- | --- |
   | `private.export_archive_current_v1(uuid,text)` | `707ebdae…01f6` |
   | `private.own_export_source_v1(uuid,uuid,uuid)` | `27abc582…9d6f` |
   | `private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)` | `17ea9257…71d2` |
   | `private.current_own_report_grant_read_v1(uuid,uuid,uuid,text)` | `9169efeb…ddf9` |
   | `private.own_analysis_completion_matches_v1(uuid,text,jsonb)` | `21fc418c…8d49` |
   | `private.own_copilot_projection_v1(jsonb)` | `1b5b0cb7…6d57` |

   - the columns of the five tables the helper reads match the tested schema.
     This check is new in this apply. PL/pgSQL does not resolve column names
     when a function is created, so a missing column would otherwise surface
     only when an export ran. The fingerprint is the MD5 of each column's name,
     type and nullability, ordered by name:

   | Table | Column fingerprint |
   | --- | --- |
   | `public.chat_messages` | `5d8dbf58…` |
   | `public.chats` | `11209f3b…` |
   | `public.directional_grants` | `0a79046b…` |
   | `public.purpose_grants` | `b93f12a1…` |
   | `public.subject_consents` | `2fffaaf8…` |

3. Executes the migration verbatim.
4. Postchecks:
   - all three functions against the hashes measured on the tested local
     stack: authority `f4620173…4581`, reader `8f5007d0…c699`, helper
     `d690ea2f…839b`;
   - all three are security definer with `search_path=pg_catalog, private`;
   - `service_role` can execute only the reader;
   - `anon`, `authenticated` and `inherit_upload_only` can execute none of
     them;
   - the six dependencies are unchanged.
5. Inserts the ledger row under the repository's own version and name.

[`dry-run.sql`](dry-run.sql) (SHA-256 `e2226841…0d88`) is the same statement
ending in a forced exception.

## Rehearsal and execution

| Step | Result |
| --- | --- |
| Local database reset to `main` at `6aef5a2a`, before #216 | Authority `195dd68d…`, reader `21713437…`, helper absent, as in production |
| New definitions measured locally in a rolled-back transaction | The three hashes above; the helper executable by no role; nothing left after rollback |
| Local dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; state unchanged |
| Local apply | All three hashes as measured; ledger row present, statement MD5 equal to the file's |
| Local re-run | Refused: already in the ledger |
| Export pgTAP against the rehearsed apply (`export_archive_chat_reader`, `_history_reader`, `_content_reader`, `_persistence`) | 218 of 218 (37, 60, 44 and 77) |
| #216 merged with `main` locally, before merging on GitHub | Documentation gates pass (`readability`, `claims`, `legal`, `names`, `secrets`) |
| Unit suite on that merge | 6,269 tests passed, 9 failed and 140 skipped, across 19 failed files; each failure is environmental (below) |
| Production pre-state, read-only (08:58:49 UTC) | 130 ledger rows without this version; both functions, the absent helper, all six dependencies and all five table fingerprints as above; 0 jobs |
| Production dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; the integrity check passing proves the transcribed migration text was exact |
| Production state re-read (09:03:39 UTC) | Unchanged |
| #216 merged | `a38d956a`, 09:03:50 UTC; CI green on the pull request's head `dd154da5` |
| Production apply | Committed without error |

The 19 failed files do not come from #216, which changes only SQL and
documentation:

- 15 browser-driven files cannot launch, because this container lacks the
  Playwright browser build they expect;
- one runtime test refuses to run as root;
- one email-capture input check fails the same way on `main`;
- two files timed out under full-suite load, and both pass when run alone on
  the merge (19 of 19).

Every failing file was run on `main` too, with the same result or a pass in
isolation.

## Production after the apply (read at 09:06:38 UTC)

- Ledger: 131 rows. `20260925220000` / `export_archive_chat_reader` holds one
  statement, MD5 `b90a52709fe911eaa1ae866b41a77ee8`, equal to the file.
- The functions hash to the tested definitions:
  - `private.export_archive_authority_v1`: `f46201730da410b9d9a2350bf4f14581`;
  - `public.export_archive_content_v1`: `8f5007d0245b323eb28b3d3c116cc699`;
  - `private.export_archive_chat_messages_v1`: `d690ea2fe2d3daacc75e290cf225839b`.
- All three are security definer, with `search_path=pg_catalog, private`.
- Only `service_role` can execute the reader. No role can execute the
  authority or the helper.
- The six dependencies still hash to the values above.
- 0 rows in `generated_exports` and in `private.export_archive_jobs`.

No user data was read or written. Every export migration merged to `main` is now
applied.
