# Jurisdiction declaration, applied to production — 25 September 2026

`supabase/migrations/20260925140000_jurisdiction_declaration.sql` (SHA-256
`02b2a272…e316`, text MD5 `97c3f2f6…35f0`) merged to `main` in #212 as
`9c4a0c02` and was applied to production project `zuvloczwgrayonqabnss`
immediately afterwards. The owner approved this order in chat on 25 September:
once CI was green, merge, then apply guarded (`docs/protocol/decisions.md`).
The migration adds the declaration columns, the D-135 guard trigger, the
published `attestation.jurisdiction` text and the one writer,
`public.declare_jurisdiction_v1`. It changes no existing profile. No real
jurisdiction is reviewed (G5.5), so a declared country still resolves every
restricted capability as `unreviewed`.

## How it was applied

[`apply.sql`](apply.sql) (SHA-256 `b01dd5e5…0dae1`) is one `DO` statement, so it
is atomic whatever the client does with multi-statement text, as in the
[export receipts](../export-content-reader-production-apply-20260925/README.md).
In order, it:

1. Refuses unless the embedded migration text has the reviewed file's MD5.
2. Checks predecessors:
   - the version is absent from the ledger;
   - the export content reader row is present;
   - no declaration object exists yet (writer, guard, columns, trigger or
     attestation);
   - **no profile holds a jurisdiction code**, since the new check constraint
     requires every stored code to carry its declaration record;
   - the profile check constraints and the consent-artifact immutability
     trigger hash to the tested set;
   - the auth columns and `extensions.digest` the writer uses exist;
   - the two functions it calls hash to the tested definitions
     (`private.append_legal_audit_event` `5d7a70e2…3455`,
     `public.revoke_directional_purpose_v1` `4f27d161…e61e`).
3. Executes the migration verbatim.
4. Postchecks against the definitions measured on the tested local stack:
   - writer `01e02e78…dcbb2`, security definer with an empty search path;
   - guard `d3f4c02b…2ba9`;
   - trigger `529e2c2b…3b69`;
   - check constraint `cc367821…9fa5`;
   - the five profile jurisdiction columns and their types;
   - exactly one attestation row, version 1, whose stored hash is the SHA-256
     of its own body;
   - no browser role can execute the writer or the guard, and `service_role`
     can execute the writer;
   - the profile count is unchanged, and no profile is declared or has left
     revision 1;
   - both dependencies are unchanged.
5. Inserts the ledger row under the repository's own version and name.

[`dry-run.sql`](dry-run.sql) (SHA-256 `b5106681…d282`) is the same statement
ending in a forced exception.

## Rehearsal and execution

| Step | Result |
| --- | --- |
| Local stack at production's schema (`main` before #212 with the reader applied) | Writer absent; 127 ledger rows |
| Local and production pre-state, one read-only query each | Identical dependencies, constraints, trigger, auth columns and roles; both PostgreSQL 17.6 |
| Definition hashes, measured locally in a rolled-back transaction | As listed above; nothing left after rollback |
| Local dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; state unchanged |
| Local apply, then re-run | Applied, ledger statement MD5 equal to the file's; the re-run refused |
| pgTAP against the rehearsed apply | Full suite, 92 files, 3,846 assertions, all pass |
| Production dry run, before the merge | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; state re-read unchanged |
| CI on the merged head `4ac2ac8d` | [36176206183](https://github.com/themariodiego/Inherit.bio/actions/runs/36176206183) green |
| #212 merged | `9c4a0c02` |
| Production apply | Committed at 20:10:57 UTC |

## Production after the apply (read at 20:11:07 UTC)

- Ledger: 129 rows. `20260925140000` / `jurisdiction_declaration` holds one
  statement, MD5 `97c3f2f6d38c7713cb62e134869e35f0`, equal to the file.
- Writer, guard, trigger and constraint hash exactly as tested.
- `attestation.jurisdiction` version 1, body hash
  `7cfbbe7cf54bc5e5e376bcf8f7b916ad9598826755021a56fe613bae6bea0efd`, valid
  against its own body.
- `anon` and `authenticated` cannot execute the writer; `service_role` can.
- 21 profiles: none declared, all at jurisdiction revision 1.

Signed-out checks of `https://inherit.bio` afterwards:
- `/` and `/auth/sign-in` answer 200.
- `/overview` and `/settings` redirect to sign-in.
- `PUT /api/settings/jurisdiction` without a session answers 401, and `GET`
  answers 405.

## The order was not quite what was intended

The plan was for the schema to be in place before the new code served
traffic. Otherwise a signed-in person would be sent to `/settings` by the new
gate while the declaration form could not load yet. Vercel's production
deployment of `9c4a0c02` (`dpl_GTsphpL45cSCRfKRVettCGjYoNJV`) was READY at
20:09:33 UTC, and the apply committed at 20:10:57 UTC. The deployment beat the
apply by **84 seconds**, because sending the long apply statement after the
merge took longer than the build.

In that window the deployment served six requests: two retention crons, the
mail job, one Resend webhook, `/` and `/providers`. All answered 2xx. No
runtime error was logged, and no signed-in page or the declaration endpoint was
requested. So nobody met the gap. The lesson: this migration only adds
objects, and the previous code neither reads nor writes any of them. Applying
it just before the merge would have removed the window entirely. For an
additive migration the new code depends on, apply first, then merge.

No user data was read or written beyond the counts above.
