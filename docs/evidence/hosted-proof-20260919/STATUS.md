# Hosted proof · status

Branch `claude/hosted-proof-20260919`, created from `main` at `c78d287`.
This file is the live record the main release session reads. Times are UTC.
Nothing here claims more than what was measured; the "Not yet proved" list is
as binding as the "Done" list.

## Done

- 01:38 · Session started. The three owner-set variables are present
  (`INHERIT_PREVIEW_SUPABASE_SERVICE_ROLE_KEY`,
  `INHERIT_PREVIEW_UPLOAD_SIGNING_JWK`, `INHERIT_PREVIEW_VERCEL_BYPASS_TOKEN`);
  the branch name, URL and anon key were derived as instructed. Disk: 30 GB
  free on the session allowance.
- 01:41 · Step 4.1 edits: the preview signer's public half (kid
  `4d1d178c-3f0c-41d0-902f-788c83fdef3d`, lowercase, version 4) is the one
  entry of the preview gateway's `SIGNING_PUBLIC_KEYS`; its `TOKEN_ISSUER`
  and the preview container's `NEXT_PUBLIC_SUPABASE_URL` name the branch
  project `iofjhrtcyawjjhuxbgfd`; the container README says so. The hosting
  configuration and deploy guard tests pass (26/26). See
  `key-comparison.json` for the committed key.
- 01:41 · Read-only preflight of the branch (`preflight.json`):
  `own_preparation_config` disabled, provider `supabase`, no bucket,
  `max_job_seconds` 900, `max_artifact_bytes` 100 MiB, monthly limit 100;
  original retention enabled; zero users, files, jobs, artifacts, Storage
  objects and admissions. Production read the same minute for comparison
  only: 24 MiB VCF and array, 128 MiB per account, 2 active uploads, gVCF
  ceiling null.

## Found on the way

- `private.upload_authorization_config` has NO ROW on the branch (the branch
  was created without data and that row is operator-seeded, not migrated;
  production's row names its own issuer). Every upload lease on the branch
  fails closed until a row exists, so step 4.3 inserts one with the branch's
  issuer `https://iofjhrtcyawjjhuxbgfd.supabase.co/auth/v1` and the owner's
  ceilings. Production is not touched.
- The Supabase Storage upload limit of the branch project is not readable
  from SQL (`storage.buckets.file_size_limit` is null on all three buckets,
  which means "use the project's global limit"); the connected tools expose no
  Storage settings call. The proof measures it directly: the first upload
  above 5 GB says whether the branch inherited the 9 GB setting.

- 01:45 · Pushed `b38cc54`; draft pull request #147 opened; `Deploy
  Cloudflare` dispatched for `preview` on this branch: run 35413646358,
  conclusion success at 01:47:59 (the `cloudflare` environment accepted the
  branch). Vercel Preview `dpl_GN9c7UQD98Jp6mnDT5R9KPb4pV7V` READY at
  01:46:20 at `inherit-git-claude-hosted-proof-20260919-mariodiego.vercel.app`.
- 01:47 · Step 4.3 applied on the branch only (`enable-preparation-receipt.json`):
  preparation enabled, provider `r2`, bucket `inherit-prepared-preview`,
  `max_job_seconds` 3600 (the column's ceiling, so the proof measures rather
  than freezes; the recommendation comes from the measurements); the missing
  `upload_authorization_config` row inserted with the branch issuer, 24 MiB
  array, 2 GiB VCF, 8 GiB gVCF, 12 GiB per account, 2 active uploads.
- 01:48 · Served key equals committed key (`key-comparison.json`): the Preview
  deployment serves one key, kid `4d1d178c-3f0c-41d0-902f-788c83fdef3d`,
  same `x` and `y` as the committed entry.

- 01:55 · First browser journey (64 MiB synthetic VCF, Chromium through the
  session's egress proxy with the bypass header on the deployment origin
  only): sign-in worked; `/files/upload` then rendered "We cannot prepare
  this upload right now". Root cause, traced on the branch: the upload page
  mints its account-completion and consent tokens with an HMAC key derived
  from `BYOK_ENCRYPTION_KEY` (`src/lib/crypto.ts`, `dataKey()`), and that
  variable exists on the Vercel production target only. The branch's own
  side is fine: `own_upload_context_v1` answers (birth date missing → account
  completion), the two upload consent artifacts are current, the nonce
  function accepts a call. This session may not write to a secret store (the
  environment's policy refused both the Vercel variable and the local key
  generation), so it is an owner action below.

## Found on the way (continued)

- `public.report_templates` is empty on the branch (seeded by `pnpm seed`,
  not migrated; production holds 162 rows). The "result rendered" step needs
  them; seeded at 02:05 with `pnpm seed` against the branch (16 providers,
  162 templates, 146 reference variants, 3 polygenic scores; reference rows
  only, no personal data).

- 02:03 · The preview container never reached the branch. The branch's API
  logs since 00:00 UTC hold no `claim_next_own_preparation_work_v1` call at
  all (the app's own calls are there), across every five-minute tick after
  the 01:47 deploy. Reproduced without Docker by assembling exactly the file
  set the image copies and running `pnpm worker:prepared --once` against the
  branch: `prepared_worker_unavailable`, exit 1, before any request. Cause:
  `src/lib/uploads/own-preparation-worker.ts` imports
  `docs/route-register.json`, and the image copies `src/` alone while
  `.dockerignore` drops `docs/`. With that one file added the same run
  reports `preparation_idle` and `cleanup_idle` (02:05:30, one claim call on
  the branch). So every container start since 18 September exited the same
  way, and "each run reports idle" in the README was never observed. Fixed
  on this branch: the Dockerfile copies `docs/route-register.json`,
  `.dockerignore` lets it through, the README says so, and
  `scripts/cloudflare-hosting-config.test.ts` now follows the worker entry's
  import graph and requires every file it reaches outside `src/` to be
  copied (the test fails on the old Dockerfile). Redeploy of `preview`
  dispatched after the push: run 35414765750, success at 02:10:49. The fix
  reaches production with the merge.
- 02:23 · The preview container is alive. The branch's API logs show, from
  Cloudflare's network (colo CMH), the three calls one `--once` run makes
  (`claim_next_own_preparation_work_v1`, `prepare_due_prepared_scratch_v1`,
  `claim_own_prepared_cleanup_v1`, all 200) at 02:15:07 and 02:20:07: one
  wake per cron tick, first request about 7 seconds after the tick. With no
  job queued that is the idle path; the first job still waits on the owner
  action below.
- 02:12 · Full unit suite on this branch: 5134 passed, 48 skipped, 6 failed
  in 4 files, all environmental and untouched by this branch (six in
  `scripts/ci-browser-runtime.test.ts` because this session runs as root,
  two claims files because the pinned Playwright cannot find its Chromium
  build here, one because the tree was dirty while the suite ran); the new
  hosting test passes.

## In progress

- Blocked on the owner action below. Once the variable exists and the Preview
  redeploys (any push to this branch, or a redeploy from the Vercel
  dashboard), the 64 MiB VCF journey runs again, then VCF.gz, gVCF, the
  ceiling files, the cap refusal and the withdrawal residue check.

## Not yet proved

- Everything in step 5: no upload, no job, no artifact, no withdrawal has run
  on the preview stack yet.
- That the preview container runs a job: the deploy succeeded, but no job
  has been claimed yet.

## OWNER ACTION NEEDED

The Vercel Preview target needs one more variable, or no upload page can
render on any Preview deployment.

1. Open https://vercel.com/mariodiego/inherit/settings/environment-variables
2. Add a variable:
   - Key: `BYOK_ENCRYPTION_KEY`
   - Value: a FRESH key, never production's, from `openssl rand -base64 32`
     (44 characters ending in `=`); anything that is not 32 bytes of base64
     is refused by the app
   - Environments: **Preview only** (leave Production and Development unticked)
   - Sensitive: on
3. Save, then either push anything to `claude/hosted-proof-20260919` or use
   "Redeploy" on deployment `dpl_GN9c7UQD98Jp6mnDT5R9KPb4pV7V` in
   https://vercel.com/mariodiego/inherit/deployments so the value applies.
4. Start a fresh session in the same Claude Code environment with the same
   brief; this session's variables are unchanged. Remove the variable at
   teardown (runbook step 6).

Why this key: it encrypts users' own model keys at rest and derives the keyed
digests behind consent tokens; production's value must not be copied to a
preview deployment that talks to a branch database.
