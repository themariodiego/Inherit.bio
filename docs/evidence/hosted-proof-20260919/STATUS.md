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

## In progress

- Step 4.2: push, draft pull request, dispatch `Deploy Cloudflare` for
  `preview` on this branch.

## Not yet proved

- Everything in step 5: no upload, no job, no artifact, no withdrawal has run
  on the preview stack yet.
- The served key equals the committed one (waits for this branch's Preview
  deployment to be READY).
- The preview container's deploy with the new configuration.

## Owner action needed

None at this time.
