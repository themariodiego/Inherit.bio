# The hosted-proof branch: production's schema on a disposable Supabase branch · 19 September 2026

This folder records how the temporary Supabase preview branch for the hosted
proof (task: prove the VCF/VCF.gz/gVCF journey and the hosted capacity on a
preview stack, owner decision 14 of 18 September) was brought to the
production schema, and what was checked afterwards. Nothing here touched the
Inherit project (`zuvloczwgrayonqabnss`) beyond read-only catalog queries.

| Item | Value |
| --- | --- |
| Branch | `hosted-proof`, project ref `iofjhrtcyawjjhuxbgfd`, created by the owner in the dashboard at 23:56:04 UTC on 18 September (no GitHub sync, no production data) |
| Parent | `zuvloczwgrayonqabnss` (production, 117 migrations at the time) |
| Pinned commit | `c78d28743d61486aadc45714d2f9683cd27dee8f` (main after PR #145) |
| Replay window | 00:41:03 to 00:44:34 UTC on 19 September |
| Files | `replay-plan.json` (the 41 entries, sha256 and time of each), `parity.json` (the digest comparison), `align-legacy-grants.sql` (the one branch-only change) |

## Why the platform's own replay stopped

Supabase creates a branch by replaying the parent's migration history. It
applied the first 76 entries and stopped at entry 77,
`health_picture_canonical_results`, with `Hosted migration baseline changed`
(P0001, in the branch's Postgres logs at 23:56:21 UTC). That exception is
raised by the `stage_preflight` block the release discipline wraps around
every hosted apply since 7 September: it compares the count and the md5 of
the production project's own migration-history table, which no copy can
satisfy. The failed entry rolled back whole (its table and functions were
absent), so the branch stood exactly at production's entry 76.

## What was replayed and how

The 41 remaining entries were applied in production order:

- For 40 of them the repository holds the migration file. A comparison of
  each production statement with its repository file showed the file to be
  the DDL production ran: byte-equal for 24, the same statements inside a
  guard wrapper for 6, and the same statements with comment lines removed
  for 10 (the replay records both in `parity.json`). Those 40 files were
  fetched into the branch database itself by `pg_net` from the pinned
  commit's raw URLs, the sha256 of each fetched body was compared with the
  repository file's before anything ran, and each was executed inside the
  branch's own transaction. No file text was retyped.
- `install_own_report_retention_scheduler` has no repository file (an
  operator-only install of 8 September). Its production statement was
  applied as stored: pg_cron 1.6.4 and the inactive job
  `inherit-own-report-retention-15s-v1`. The job was then activated on the
  branch, as it is in production.
- The two `stage_preflight` blocks that name the production history were the
  only clauses not run; every other guard those two entries carry was.

The branch's migration list now reads the 76 platform entries followed by
eight `hosted_proof_replay_*` entries and one alignment entry. The
dashboard's branch status may keep saying the platform replay failed; that
label is the platform's and the schema is what this folder checks.

## Parity with production, checked object by object

One query, run read-only on both databases after the replay, digests every
function (body, owner, definer flag, settings, ACL, volatility, result type,
language), every table and sequence (owner, RLS flags, ACL, columns with
types, nullability and defaults, constraints, indexes), every policy,
trigger, view, enum, extension, cron job, schema ACL, storage bucket, default
ACL and the six application roles. Production has 778 such objects.

The first comparison found 35 differences. Twenty-nine were one cause: the
branch database was created with narrower default privileges for the
`postgres` role in `public` than the Inherit project has (tables gave
`anon` and `authenticated` only REFERENCES, TRIGGER and MAINTAIN, and
`service_role` no DML; sequences and functions granted nothing), so the
nineteen legacy relations that rely on defaults, three sequences and one
reader function came out narrower than production. `align-legacy-grants.sql`
set the branch's default privileges to production's and granted exactly the
production privileges on those objects; two function ACLs differed only in
recorded order and were re-granted in production's order.

After that change (`parity.json`):

| Result | Count | What it is |
| --- | --- | --- |
| Equal | 768 | identical digest on both databases |
| Comment-only body | 9 | functions created from the repository files, whose bodies carry the comment lines production's comment-stripped statements did not; with comment lines, trailing spaces and blank lines removed, the nine bodies hash equal on both sides |
| Platform-owned | 1 | the `postgres` role's memberships: the branch also holds `supabase_functions_admin` |
| Branch-only | 7 | `pg_net` and its three `net` relations (the fetch transport; production does not carry the extension) and three `supabase_admin` default ACLs for the `supabase_functions` schema (platform image) |
| Production-only | 0 | |

No table, column, constraint, index, policy, trigger, view, enum, bucket or
application-role difference remains.

## Limits

- This is schema parity, not data parity: the branch holds no production
  row, by design (synthetic fixtures only).
- The preview Workers' configuration (`workers/prepared-worker/wrangler.json`
  `env.preview` and `workers/prepared-artifacts/wrangler.json` `env.preview`:
  the branch URL and the preview signer's public half) is committed on the
  proof session's own branch, `claude/hosted-proof-20260919`, which also
  dispatches the preview deploy; it is not part of this record.
- The branch's JWT standby key, the preview Workers' two secrets, the Vercel
  Preview variables and the proof session's variables were the owner's steps,
  done on 19 September, and are not recorded here.
- The branch is billed by the hour while it exists and is deleted after the
  proof, by the owner's decision.
