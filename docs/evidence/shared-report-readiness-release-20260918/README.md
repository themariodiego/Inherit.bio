# Shared-report readiness release verification — 18 September 2026 (D-129)

Status: released. PR #145 (`Prove two Family route-state pairs, hold every
pre-existing route to its disposition, and announce a completed shared run
whatever it covers`) merged to `main` as
`c78d28743d61486aadc45714d2f9683cd27dee8f`; the Vercel production deployment
of that commit was READY on `www.inherit.bio` before the migration was applied
to the Inherit Supabase project, and a rollback-only production probe passed
13/13 afterwards. No limit moved and no data changed: the migration replaces
two function bodies, and both completed report runs in production are
announced under the old and the new predicate alike, so no card changed.

## Identities

| Item | Value |
| --- | --- |
| PR head | `c5b318177ff7b9308b363fda9504a5212f99210d` (branch `claude/zen-cori-qliz47`) |
| Merge commit | `c78d28743d61486aadc45714d2f9683cd27dee8f`, parents `717b2f8` and `c5b3181` |
| Tree | `3d16373147af5bfab46421212bd0dad99aa330a6`, equal to the PR head tree |
| Migration file | `supabase/migrations/20260918213000_shared_report_readiness_completed_runs.sql` (SHA256 `4d8b9db0419b50d1c71eea9bc7a04fe6e2b65e14d22860eed0447bcb7db878cc`, 10,524 bytes) |
| Hosted ledger row | `shared_report_readiness_completed_runs` version `20260918231857` (the hosted runner stamps application time; names are the identity, as `scripts/schema-drift-gate.ts` compares them) |
| Supabase project | `zuvloczwgrayonqabnss`, Postgres 17.6; executed as `postgres` through the management SQL API |
| Vercel | production deployment `dpl_9FSB4LTvt4Fn6ECbt5PKitNtGBHh`, created 23:15:27 UTC, READY 23:16:01 UTC, aliased to `www.inherit.bio` |

## Order

App first, then the database, as for every function-body release. The
readiness response keeps its shape (`hasReports` boolean), so either order is
safe; the app that carries the browser assertion for the new reading deployed
first (READY 23:16:01 UTC), the guard ran at 23:16:51, the migration applied
at 23:18:57 (hosted stamp), the postflight followed at 23:20:35 and the probe
at 23:21:21.

## Continuous integration

- Pull request run [35401497676](https://github.com/themariodiego/Inherit.bio/actions/runs/35401497676)
  on `c5b3181`, the tree that merged: green on its first attempt at 23:12 UTC;
  the first execution of the migration, of the pgTAP case (the fixture run
  re-completed through the real wrapper with its one report captured as not
  covered), of the hub assertion in `e2e/family-coverage-states.spec.ts`, of
  `e2e/route-dispositions.spec.ts` and of the `/family/[person] complete` case.
- Main's post-merge run for `c78d287`,
  [35404976294](https://github.com/themariodiego/Inherit.bio/actions/runs/35404976294),
  started at 23:15 UTC and was in progress when this record was written; the
  record commit that follows appends its conclusion.
- The `Deploy Cloudflare` workflow did not run on this push: the merge changed
  nothing its trigger watches, and the last runs remain PR #143's.

## Production database

1. `preflight.json` (read-only, 21:32:43 UTC, before the merge): ledger at 116
   rows ending in `own_upload_gvcf_ceiling`; both bodies byte-equal to the
   repository's then-current definitions (md5 and length); ACLs, owners,
   definer flags and `search_path` recorded; 3 analysis runs, of which the 2
   completed report runs are announced under both predicates.
2. `ddl-guard.sql` (read-only, passed 23:16:51 UTC): raises unless every
   preflight fact still holds.
3. Apply: one call with the exact repository text, `success`, hosted version
   `20260918231857`.
4. `postflight.json` (23:20:35 UTC): both replaced functions have a deployed
   `prosrc` md5 and length equal to `expected-prosrc.json`
   (`f760ed0078c2f66208e81c27f7f5aff9` / 4171 and
   `62c04f1a13844e4ff826c8197892da1b` / 4565); ACLs, owners, definer flags and
   `search_path` unchanged; ledger at 117 ending in the new name; run counts
   unchanged.
5. `probe.sql` → `probe-receipt.json` (23:21:21 UTC, 13/13): the bodies equal
   the repository text with definer status, the pinned `search_path` and
   unchanged ACLs; the deployed predicate no longer names coverage and keeps
   the content branch; no browser role can execute either reader and the
   service role keeps the public projection only; an unknown mode, an unknown
   recipient, an unknown owner and an unshared purpose are refused with their
   existing codes in both modes; stored results untouched and every completed
   report run announced under both predicates; nothing written.

## Production application

`www.inherit.bio` answered 200 on `/` and on `/family`, and 307 to sign-in on
`/overview`, at 23:22 UTC on the new deployment. Vercel reported no runtime
errors in the three hours to 23:22 UTC.

## Limits

- No limit changed and no row changed. The two readers' readiness branch now
  announces a completed run whatever it covers; content mode, authority,
  receipts and privileges are as they were.
- The private reader's readiness branch has no caller today; it was changed so
  the two bodies stay one definition.
- The hub's `/family not-covered` and `partial-coverage` pairs were waived by
  the owner the same evening for their own reason (the card has nothing to say
  about coverage); this release is the defect fix, not a state proof.
