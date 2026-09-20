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

- 03:07 · Preview rebuilt with the owner's variable
  (`dpl_ETP5JCWoEzj8bmnS3tKoiq3LKDXd`, READY 03:07:35). The upload page
  renders and discloses the branch ceilings ("VCF or gVCF files up to 2147
  MB"). Three driver problems cost the next hour, none of them the product's:
  the session's egress proxy re-terminates TLS and Chromium's TLS 1.3
  handshake with it fails intermittently (`ERR_TOO_MANY_RETRIES`; fixed by
  capping the browser at TLS 1.2), the proxy port changed once, and the
  driver selected the file before React had hydrated the uploader, so the
  change event was lost (fixed by re-selecting until the input turns busy).
- 04:19 · FIRST FULL JOURNEY on the preview stack (`e2e/fixtures/tiny-grch38.vcf`,
  547 bytes): upload-session 201, Storage POST 200, finalize 200 in 2.5 s,
  `/process` 202 (queued, job `9a86edb7…`, admission 1 of 100), the container
  claimed it at the 04:20 cron tick (about 17 s after enqueue), published it
  at 04:20:21 (14 artifacts, 26,160 bytes, provider `r2` /
  `inherit-prepared-preview`), and the page showed "Your file is stored and
  prepared" 35 s after finalization. Receipt: `journeys/vcf-tiny.json`.
- 08:04 · The session was idle from about 04:20 to 07:59 (no wake arrived);
  the 64 MiB VCF journey with chosen reports started at 08:04.
- 09:06 (19 September) · **The 64 MiB VCF did not finish preparation.** Upload
  and finalization were fine (Storage POST 2.6 s at about 25 MB/s, finalize
  8.8 s), the admission was granted (the month's count went 1 to 2) and the
  job was enqueued at 08:06:03 with a deadline of 09:06:03 (`max_job_seconds`
  3600, the column's ceiling). At 09:06:09 the page said "We could not confirm
  whether file preparation finished"; a cleanup of mode `unpublished-scratch`
  removed 13 scratch artifacts at 09:10:07 to 09:10:10, the job row is gone
  and the file stays `uploaded` with its original in Storage. So one hour on
  `standard-1` (1/2 vCPU, 4 GiB) was not enough for 64 MiB, against 14 seconds
  of container work for 547 bytes. The container itself is healthy: it has
  woken on every five-minute tick since, idle.
- The session was then idle from 19 September 09:06 to 20 September 09:46
  (about 24 hours 40 minutes, no wake arrived). Work resumed on 20 September;
  every timestamp below is 20 September.

- 11:31 (20 September) · **gVCF journey passed end to end**, 4 MiB decoded
  (815 KB gzip): sniffed and stored as `gvcf`, prepared by the container,
  reports generated in 15 s, then withdrawn from the browser: DELETE 204 in
  3.1 s, the Storage listing for the original empty, its download "Object not
  found", the `genome_files` row gone and the file gone from the list.
- 11:25 to 11:31 · **VCF.gz journey passed** too (4 MiB decoded, 856 KB gzip):
  prepared 78 s after enqueue (40 s of that waiting for the five-minute tick,
  38 s of container work), 18 artifacts reserved, 8 final artifacts of 907,471
  bytes in R2, reports generated in 25 s.
- 11:53 · **The 64 MiB failure is a container death, not slowness.** The retry
  job was claimed one second after enqueue, wrote 46 artifacts and 11,138,849
  bytes of prepared blocks in 92 seconds, saved checkpoint revision 3, and then
  stopped: no artifact, no checkpoint and no claim renewal after 11:26:37, with
  the claim expiring at 11:30:06 and the job left `claimed`. The next tick
  picked up the queued gVCF instead and published it normally, so the Worker,
  the cron and the gateway are all healthy. Extrapolating the healthy rate
  (11.1 MB of artifacts in 92 s) a 64 MiB source should finish in a few
  minutes, so the hour it waits out is the job deadline expiring over a dead
  container, not work in progress.

- 12:45 · **THE 64 MiB VCF IS PREPARED.** With the container host fixed and
  the preview container on `standard-2`, the same file went through in one
  wake: claimed 36 s after enqueue, first artifact 5 s later, 183 artifacts
  and 58,148,752 bytes written to R2, published 279 seconds after the claim,
  and the page showed it prepared 320 s after finalization. Its summary reads
  431,548 variants and 237,111 observed calls, and Cloudflare's container
  metric reports a maximum sampled memory of 647,372,800 bytes (617.4 MiB)
  for the run, about a tenth of `standard-2`'s 6 GiB. Receipt:
  `journeys/vcf-64mib-held.json`, numbers in `measurements.json`.
- 12:11 · **The monthly cap refuses the admission** past a limit set to the
  month's count: `/process` answered 429 `preparation_capacity_reached`, the
  page showed the refusal wording, the file was kept, no job row was created
  and the count did not move. The limit was restored to 100 at 12:30
  (`cap-refusal-receipt.json`).
- 12:45 · **The owner's ceilings do not fit this design.** The measured rate
  is 0.229 MiB of source per second of container work. The schema caps any
  job at one hour (`own_preparation_jobs_worker_deadline_bound`, and
  `max_job_seconds` is checked at most 3600), which at that rate is about
  824 MiB. Multiplying that rate out, a 2 GiB VCF would need about 2 h 29 m
  and an 8 GiB gVCF about 9 h 57 m. That is a projection from one file, not a
  measured refusal: neither size has been prepared here. It is the reason to
  measure at those sizes before production's ceilings move, and
  `measurements.json` labels it the same way.
- 12:59, corrected at 13:10 · **At 2 GiB the first finalization attempt is
  refused, and that is not the same as a wall.** With a fixture 527 bytes
  under the ceiling, twice: the lease issued (201, so the ceiling admits the
  file), the browser hashed 2 GiB in 12 s, and Supabase Storage accepted a
  single 2 GiB POST in 59.2 s and 62.8 s (34.6 and 32.6 MB/s), which is also
  the first direct evidence that the branch inherited the 9 GB global upload
  limit. The first finalization attempt then answered 503
  `{"error":"unavailable"}` after 31.4 s and 78.1 s. The branch's edge log
  names the operation that ran out of time and it is not the route's
  300-second limit: every storage operation in that path carries a fresh
  30-second signal, and on the second attempt the route validated all 537
  ranges of the object in 47.1 s, wrote its checkpoint, and then issued the
  server-side copy, which Supabase completed in 37,985 ms with a 200 about
  eight seconds after the route had abandoned it.
  **Two claims made at 12:59 are withdrawn.** "No `Retry-After`" was never
  measured (the receipts captured status and body only, and the route's
  fenced path sets it), and "the person is told to try again, meaning another
  2 GiB upload" is contradicted by the product: an interrupted finalization
  keeps the staged bytes and the validated checkpoint, the page retries by
  itself after 2, 20 and 70 seconds, and the button it then offers says the
  file already reached private storage and finishing it does not send it
  again. The driver stopped at the first refusal, which is not where the
  product stops, so whether 2 GiB finalizes is unsettled and being
  re-measured. Detail: `ceiling-finalization-logs.json`, numbers in
  `measurements.json`.
- 13:04 · **8 GiB is admitted at issuance.** The gVCF ceiling trial's lease
  was issued 201 for 8,589,933,057 bytes declared gVCF (1,535 bytes under the
  ceiling), after the browser hashed it in 45.9 s. Its single Storage POST is
  in flight as this line is written.

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

- The 8 GiB gVCF ceiling trial, the last part of step 5 that has not been
  attempted: the same driver, stopping as soon as the job is admitted, to
  see whether issuance admits 8 GiB, whether Storage takes a single 8 GiB
  POST under the 9 GB global limit, and how finalization answers.

## Not yet proved

- **Preparation at either ceiling.** The 2 GiB VCF never reaches preparation
  (finalization answers 503, above) and the 8 GiB gVCF trial is running as
  this line is written. Nothing above 64 MiB has been prepared on this stack,
  so the "two and a half hours / ten hours" figures above stay a projection
  from one file.
- **How container memory grows with source size.** One run, one size: 617.4
  MiB of maximum sampled memory at 64 MiB of source cannot be split into
  fixed overhead and growth per byte, so it must not be scaled to the
  ceilings.
- **Deletion latency, and which R2 objects were the withdrawn file's.** The
  bucket reconciles with no unaccounted payload object, but that is a later
  snapshot of the whole bucket: it times nothing, and a completed withdrawal
  takes the cleanup rows with the file, so its former keys cannot be named
  and checked one by one (`withdrawal-residue.json`).
- One measurement per size, on one branch, with one fixture generator.
- Nothing about production. Runbook steps 6 (teardown) and 8 (production
  activation) are the owner's and have not been started.

## Owner action needed

One, for the teardown (runbook step 6), and one closed.

### Open: repeat the bucket reconciliation immediately before teardown

The owner read the bucket at 12:53 on 20 September and it reconciled (105
zero-byte objects, 238 with payload bytes, all accounted for). Journeys have
run since, so repeat it at teardown (runbook step 6), the same way: open
https://dash.cloudflare.com → R2 → `inherit-prepared-preview`, read the
object count and each object's size, and check every non-empty object
against an artifact row for a file still retained. An object carrying
payload bytes that matches no retained file is the finding.

### Closed The one below was done by the owner at 03:03:01 UTC (a
`BYOK_ENCRYPTION_KEY` of type sensitive, Preview target only, is listed on
the project; its value is never read here). The push carrying this note
rebuilds the Preview so the value applies; the journey then verifies the
upload page.

### Done: OWNER ACTION (kept for the record)

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
