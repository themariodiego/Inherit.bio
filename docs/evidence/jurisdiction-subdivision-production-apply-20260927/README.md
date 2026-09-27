# United States state declaration, applied to production — 27 September 2026

`supabase/migrations/20260927100000_jurisdiction_subdivision.sql` (SHA-256
`3c4d7027…9550`, text MD5 `f088ede3…2d31`), from #231, was applied to
production project `zuvloczwgrayonqabnss` before #231 merged. The order is the
reverse of 25 September on purpose:
- The new build calls `declare_jurisdiction_v2`, so the function has to exist
  before that build deploys.
- The migration keeps `declare_jurisdiction_v1` as a wrapper that returns the
  exact three keys the live build parses. The live build therefore keeps
  working between the apply and the deploy.

The owner chose to build the state declaration on 27 September, from
selectable options ("Stay off, prep US"; `docs/protocol/decisions.md`). The
owner has also given standing permission in this goal to run SQL on production
as engineering sees fit. This apply used the same guarded, dry-run-first
procedure as the earlier receipts. It wrote nothing beyond the migration and
its ledger row.

The migration adds three things:
- the nullable `profiles.jurisdiction_subdivision`, with its check;
- the state in the server-only guard;
- `attestation.jurisdiction` version 2, with version 1 superseded and its
  body intact.

It also adds `declare_jurisdiction_v2` and turns version 1 into the wrapper.
It changes no profile. Every committed US state is `unreviewed`, so no
capability changes for anyone.

## How it was applied

[`apply.sql`](apply.sql) (SHA-256 `2b481a95…41d4`) is one `DO` statement. In
order, it:

1. Refuses unless the embedded migration text has the reviewed file's MD5.
2. **Predecessor checks:**
   - `20260927100000` is absent from the ledger, and `20260925220000` is
     present;
   - no subdivision column and no version 2 writer exist;
   - the attestation is exactly version 1, current, with its published hash
     valid against its body;
   - these definitions hash to the values measured identically on production
     and on the rehearsal stack:
     - guard `d3f4c02b…2ba9`;
     - version 1 writer `01e02e78…dcbb2`;
     - `private.append_legal_audit_event` `5d7a70e2…3455`;
     - `public.revoke_directional_purpose_v1` `4f27d161…e61e`;
     - the seven profile check constraints;
     - the consent-artifact immutability trigger `51fc589c…3dc1`;
     - the profile guard trigger `529e2c2b…3b69`;
   - it snapshots the profile count and a digest of every profile's
     declaration columns.
3. Executes the migration verbatim.
4. **Postchecks** against the definitions measured on the tested stack:
   - guard `10c89e9b…cda1e`;
   - version 1 wrapper `77d25906…50d6`;
   - version 2 writer `e37e5c9d…aa3c`;
   - both writers security definer with an empty search path;
   - subdivision check `29b4d879…2f3771`;
   - the immutability trigger re-enabled and unchanged;
   - the column a nullable `text`;
   - attestations exactly v1 superseded (`7cfbbe7c…`) and v2 current
     (`a73dfd01…`), each valid against its own body;
   - no browser role can execute either writer or the guard, and
     `service_role` can execute both writers;
   - the profile count and declaration digest unchanged, and no state set;
   - both dependencies unchanged.
5. Inserts the ledger row under the repository's own version and name.

[`dry-run.sql`](dry-run.sql) (SHA-256 `a346faeb…66d7`) is the same statement
ending in a forced exception.

## Rehearsal and execution

| Step | Result |
| --- | --- |
| Local stack reset to production's schema (every migration except this one) | 130 ledger rows; last `20260925220000` |
| Local and production pre-state, one read-only query each | Identical definitions, constraints, triggers and attestation; both PostgreSQL 17.6. Production: 26 profiles, 7 declared |
| Post-migration definitions, measured locally in a rolled-back transaction | As listed above |
| Local dry run | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; state unchanged |
| Local apply, then re-run | Applied; ledger statement MD5 equal to the file's; the re-run refused (`already in the ledger`) |
| pgTAP against the rehearsed apply | Full suite, 95 files, 3,970 assertions, all pass |
| Production dry run, 10:43 UTC | `DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`; re-read at 10:43:39 unchanged (no v2, no column, v1 current, no ledger row, trigger enabled) |
| CI on #231's head `8000a30d` | `checks` ([run 36312596501](https://github.com/themariodiego/Inherit.bio/actions/runs/36312596501), including the browser suite and the new US-state journey), `build` and `guided-first-run` green |
| Production state re-read, 11:39:26 UTC | Unchanged since the dry run |
| Production apply | Committed at 11:44:00 UTC (v1's `superseded_at` and v2's `published_at`) |
| #231 merged | `e2d7fd3d` at 11:45:02 UTC |
| Production deployment of `e2d7fd3d` | `dpl_7E9pCAMDupTewj5ZdNqCa5y2hf6Z`, READY at 11:45:55 UTC |

## Production after the apply (read at 11:44:19 UTC)

- Ledger: 132 rows, the last `20260927100000` / `jurisdiction_subdivision`. It
  holds one statement, MD5 `f088ede3…2d31`, equal to the file.
- The guard, the version 1 wrapper and the version 2 writer hash exactly as
  tested.
- `profiles.jurisdiction_subdivision` is a nullable `text` column.
- `attestation.jurisdiction`:
  - version 1 (`7cfbbe7c…`) is superseded;
  - version 2 (`a73dfd01…`) is current;
  - each is valid against its own body.
- The immutability trigger is enabled.
- `authenticated` cannot execute the version 2 writer; `service_role` can.
- 26 profiles, 7 declared, none with a state: the same as before the apply.

Signed-out checks of `https://inherit.bio` after the deployment:
- `/` and `/auth/sign-in` answer 200.
- `/overview` and `/settings` redirect to sign-in.
- `PUT /api/settings/jurisdiction` with the site's Origin and no session
  answers 401. Without an Origin it answers 422 `origin`, because the origin
  check runs first, as before. `GET` answers 405.
- `/embryo-analysis` carries the new sentence: "Embryo scores that add up many
  small effects are for research only. Inherit will not offer them as a
  service."

## The order, this time

The 25 September receipt concluded that, for an additive migration the new
code depends on, the migration should be applied first and merged second.
That is what happened here:
- The apply committed at 11:44:00 UTC.
- The merge followed 62 seconds later.
- The new build served from 11:45:55 UTC.

For those 115 seconds the previous build ran against the new schema. It calls
only `declare_jurisdiction_v1`, which now wraps version 2 and returns its exact
three keys. Vercel logged no runtime error from 11:30 UTC onward.

No user data was read or written beyond the counts above.
