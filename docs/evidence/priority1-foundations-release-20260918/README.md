# Priority-1 foundations release verification — 18 September 2026

Status: released. PR #136 (`Priority 1 foundations: signer public key, monthly
cap, Cloudflare hosting configuration, source-revocation fold`) merged to
`main` as `adfd0a796b55870840bbb9075298ab3923d90864` after its two migrations
were applied to the Inherit Supabase project and a rollback-only production
probe passed. The public-key endpoint answers on `www.inherit.bio`. This
record closes D-126 by the owner's decision and G5.3a on the evidence below;
it activates nothing: preparation stays disabled, no Cloudflare resource
exists, and the deploy workflow is skipped until the owner enables it.

## Identities

| Item | Value |
| --- | --- |
| PR head | `9a2491c37bf28935a27ab2b2fc371c0ada0b13f8` (branch `claude/zen-cori-qliz47`) |
| Merge commit | `adfd0a796b55870840bbb9075298ab3923d90864`, parents `ca88d9d` and `9a2491c` |
| Tree | equal to the PR head tree (`git diff --quiet origin/main 9a2491c` empty after the merge) |
| Migration files | `supabase/migrations/20260918080000_own_preparation_monthly_cap.sql` (SHA256 `143e9c0a…b54950`, 4,748 bytes); `supabase/migrations/20260918113000_source_revocation_inline.sql` (SHA256 `ba92245e…f186f`, 18,915 bytes) |
| Hosted ledger rows | `own_preparation_monthly_cap` version `20260918100630`; `source_revocation_inline` version `20260918100756` (the hosted runner stamps application time; names are the identity, as `scripts/schema-drift-gate.ts` compares them) |
| Supabase project | `zuvloczwgrayonqabnss`, Postgres 17.6; executed as `postgres` through the management SQL API |
| Vercel | project `prj_K7bVowhjFr0uIapXraH41hthJkgy`, team `team_XInx0PxxHVKb2DXdL3asLX8R` |

## Continuous integration

- Pull request run [35327691091](https://github.com/themariodiego/Inherit.bio/actions/runs/35327691091) on `9a2491c`, the tree that merged: green, the first execution of both migrations and of `own_preparation_monthly_cap.sql`, the extended `genome_file_deletion.sql` and `embryo_cohort_runtime.sql` on a fresh database, and of the three new browser cases (the stranded-deletion backstop, the three-bucket residue reads, the corrected portrait fixture).
- The one earlier failure on this branch's D-126 head ([35323262621](https://github.com/themariodiego/Inherit.bio/actions/runs/35323262621), `67effb1`) was the new browser case's own `psql` assertion expecting the aged record's id without psql's `UPDATE 1` command tag; every migration and pgTAP file had passed. Fixed in `9a2491c`.
- The runs on the intermediate heads also passed: `7b699a2` ([35321937537](https://github.com/themariodiego/Inherit.bio/actions/runs/35321937537), signer key + cap + hosting configuration) and `f7e7a2d` ([35322437702](https://github.com/themariodiego/Inherit.bio/actions/runs/35322437702), with the D-127 fixture fix).
- Main's post-merge run for `adfd0a7`, [35332554044](https://github.com/themariodiego/Inherit.bio/actions/runs/35332554044), passed on its first attempt at 10:55 UTC. The new `Deploy Cloudflare` workflow ran as [35332554047](https://github.com/themariodiego/Inherit.bio/actions/runs/35332554047) and was skipped, as designed, because `CLOUDFLARE_DEPLOY_ENABLED` is unset.

## Production database

1. `preflight.json` (read-only, 10:02 UTC): ledger at 113 rows ending in `family_ancestry_shared_authority`; neither migration present; `source.revocation-7d` in class `revocationDispositionWorker`; `private.genome_file_deletions` with its seven original columns and zero rows; preparation disabled with provider `supabase`; the three function bodies the migrations build on byte-equal to the repository (md5 of `prosrc`).
2. `ddl-guard.sql` (read-only, passed 10:04:33 UTC): raises unless every preflight fact still holds, including that no deletion record exists and preparation is disabled.
3. Apply: the first call for the cap failed with a gateway 502 before execution; a read-only recheck at 10:05:55 UTC showed the database unchanged and the apply was repeated with the same text; both migrations then applied with their exact repository text (10:06:30 and 10:07:56 UTC by the hosted stamps).
4. `postflight.json` (10:08 UTC): every function the migrations define has a deployed `prosrc` md5 equal to `expected-prosrc.json`; ACLs `service_role` only on the public functions and `postgres` only on the private helpers; `search_path` empty on the fold functions; the registry row reads `inlineEventDriven`; the month ledger has RLS on, no policies, no privileges and no rows; `monthly_admission_limit` is 100 with preparation still disabled.
5. `probe.sql` → `probe-receipt.json` (10:09 UTC, 14/14): the claim answers null on the empty table and writes nothing; malformed tokens and out-of-range retry delays are refused; releasing or finishing an unknown record, and the owner path without a session, are unauthorized; enqueue while disabled answers the disabled gate and writes no month row; the month ledger refuses a mid-month key and a valid row was accepted then rolled back inside its block, leaving the ledger empty. The probe exercised refusals only; the stranded-deletion journey itself is proven by the browser case on the CI run above.

## Production application

`GET https://www.inherit.bio/.well-known/inherit-upload-jwks.json` answered 200 at 10:02:40 UTC with `cache-control: public, max-age=300`, `x-content-type-options: nosniff` and exactly one key carrying `kty`, `crv`, `kid`, `x`, `y`, `alg` ES256 and `use` sig and no private member (the coordinates are not copied here; they are public and served live). Vercel reported no runtime errors in the 45 minutes around the deployment.

## Limits

- Nothing is activated: `own_preparation_config.enabled` is false, `INHERIT_PREPARED_WGS_ENABLED` is not set on Vercel, no R2 bucket, Worker or container exists in Cloudflare, and the deploy workflow is skipped by design.
- The Supabase-provider guard proposed with D-126 is not added; seven pgTAP files assert that provider's path and must be rewritten first.
- The cohort source-object executor does not exist and cannot be reached: no embryo source can exist before ingest ships.
- The backstop retries a stranded deletion every retention run after a 15-minute delay and never gives up; a record whose shared graph changed after the deletion started is refused by the same graph check the owner path applies and stays pending, which is visible in `private.genome_file_deletions` and nowhere else. No alert exists for a record older than seven days.
- The probe did not create a synthetic stranded deletion on production.
