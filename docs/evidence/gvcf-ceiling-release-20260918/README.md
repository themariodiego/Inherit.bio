# gVCF ceiling release verification — 18 September 2026

Status: released. PR #139 (`Size the synthetic fixture by decoded bytes with a
gVCF shape, and give gVCF its own admission ceiling`) merged to `main` as
`1d4f2cd5925ff7d4d1bc811993789d9f3e9fd072`; the Vercel production deployment
of that commit was READY on `www.inherit.bio` before the migration was applied
to the Inherit Supabase project, and a rollback-only production probe passed
13/13 afterwards. No limit moved: `maximum_gvcf_bytes` is null and every
reader falls back to the VCF ceiling (24 MiB) until an operator sets it, which
happens only after the hosted proof (runbook step 9).

## Identities

| Item | Value |
| --- | --- |
| PR head | `e02c13eded6b1cda70285976b947e8018198ce70` (branch `claude/zen-cori-qliz47`) |
| Merge commit | `1d4f2cd5925ff7d4d1bc811993789d9f3e9fd072`, parents `a155bea` and `e02c13e` |
| Tree | equal to the PR head tree (`git diff --quiet origin/main e02c13e` empty after the merge) |
| Migration file | `supabase/migrations/20260918150000_own_upload_gvcf_ceiling.sql` (SHA256 `2a3c4e1b…9aa61`, 24,679 bytes) |
| Hosted ledger row | `own_upload_gvcf_ceiling` version `20260918134705` (the hosted runner stamps application time; names are the identity, as `scripts/schema-drift-gate.ts` compares them) |
| Supabase project | `zuvloczwgrayonqabnss`, Postgres 17.6; executed as `postgres` through the management SQL API |
| Vercel | production deployment `dpl_BuQEhLVYf3Nq5kvre2N5RfygQLX4`, READY 13:44:31 UTC, aliased to `www.inherit.bio` |

## Order

This release reversed the usual order on purpose. The app's disclosure
schema is strict, so a database that sends `maximumGvcfBytes` to an app that
does not know the key would have refused every disclosure until the deploy
caught up. The app that accepts the optional key deployed first (READY
13:44:31 UTC); the guard ran at 13:45:26; the migration applied at 13:47:05
(hosted stamp); the postflight and probe followed within the minute.

## Continuous integration

- Pull request run [35346819710](https://github.com/themariodiego/Inherit.bio/actions/runs/35346819710) on `e02c13e`, the tree that merged: green on its first attempt at 13:42 UTC; the first execution of the migration, of `own_upload_gvcf_ceiling.sql` (26 assertions through the real issuance, finalization, normalization and enqueue RPCs) and of the extended disclosure test on a fresh database, and of the 14 fixture cases.
- Main's post-merge run for `1d4f2cd`, [35351892873](https://github.com/themariodiego/Inherit.bio/actions/runs/35351892873), passed on its first attempt at 14:36 UTC. The `Deploy Cloudflare` workflow ran as [35351892930](https://github.com/themariodiego/Inherit.bio/actions/runs/35351892930) and was skipped, as designed.
- The two merges before it on the same day passed their post-merge runs: PR #138 (`a155bea`, run 35346706164) and PR #137 (`77a5afd`, run 35341518205).

## Production database

1. `preflight.json` (read-only, 12:52 UTC): ledger at 115 rows ending in `source_revocation_inline`; no `maximum_gvcf_bytes` column; every private body the migration replaces byte-equal to the repository (md5 and length); no gvcf file in production, so no stored source changes ceiling on apply; zero active upload sessions.
2. `ddl-guard.sql` (read-only, passed 13:45:26 UTC): raises unless every preflight fact still holds, including the four body digests and `maximum_vcf_bytes` at 25,165,824.
3. Apply: one call with the exact repository text, `success`.
4. `postflight.json` (13:47:18 UTC): every replaced function has a deployed `prosrc` md5 and length equal to `expected-prosrc.json`; ACLs, owners, definer flags and `search_path` unchanged; the public wrappers untouched; the column is a nullable bigint with its check constraint and no default; the configuration row is unchanged with the new column null; preparation still disabled.
5. `probe.sql` → `probe-receipt.json` (13:47:39 UTC, 13/13): the column is unset and reads as the VCF ceiling; a zero ceiling is refused by the constraint; a valid ceiling is accepted and rolled back inside its block, leaving the column null; disclosure, gVCF issuance, normalization and the preparation source reader all refuse unknown identities with their existing codes, and an unknown declaration is refused before any authority read; no upload session or preparation job was created; the four bodies equal the repository text with definer status and the pinned `search_path`.

## Production application

`www.inherit.bio` answered 200 on `/` and on `/.well-known/inherit-upload-jwks.json` (one key, kid `d5e4e50d…`) and 307 on `/overview` (signed-out redirect) on the new deployment at 13:45 UTC. Vercel reported no runtime errors in the two hours around the deployment and the apply.

## Limits

- No limit changed. The gVCF ceiling is null and reads as the VCF ceiling; the owner's 2 GiB / 8 GiB pair is set only after the hosted proof (runbook step 9).
- The uploader's limit sentence names the array and VCF ceilings; it gains a gVCF clause when the two values diverge.
- The probe exercised refusals and the constraint only; the positive paths (a gVCF issued above the VCF ceiling, admitted to normalization and preparation) are proven by the pgTAP file on the CI run above, not on production.
- D-128 (a gVCF's called sites counted as blocks by the provenance counter) is open and unaffected by this release.
