# Hosted proof on the preview stack · 19 and 20 September 2026

Runbook steps 4 (finish) and 5 of `docs/hosted-preparation-activation.md`, run
on the temporary preview stack: Supabase preview branch `hosted-proof`
(project `iofjhrtcyawjjhuxbgfd`), the Vercel Preview deployment of branch
`claude/hosted-proof-20260919`, the preview gateway and container Workers,
and the private bucket `inherit-prepared-preview`. Synthetic files only.
Production (`zuvloczwgrayonqabnss`, `www.inherit.bio`) was read twice for
comparison and never written. `STATUS.md` is the live record; this file is
the ordered account. Times are UTC.

## Files

| File | What it holds |
| --- | --- |
| `STATUS.md` | Done, found, in progress, not yet proved, owner actions, with times. |
| `measurements.json` | Every preparation measured, the throughput it gives, what fits inside the schema's one-hour job bound, and the recommendation. |
| `preflight.json` | Read-only state of the branch before any write, with the production comparison. |
| `enable-preparation-receipt.json` | The guard, the exact statements and the postflight of step 4.3. |
| `key-comparison.json` | The preview gateway's committed key against the key the Preview deployment serves (equal). |
| `journeys/` | One receipt per browser journey, plus the tiny file's job rows. |
| `withdrawal-residue.json` | What the withdrawal established, what it did not, and the owner check for the bucket. |
| `cap-refusal-receipt.json` | The monthly cap refusal, with the limit set for the test and restored. |

## What is proved

- **The whole journey works**, in a real browser against the Preview
  deployment: consent, upload with the restricted Storage bearer,
  finalization, admission, preparation by the preview container into R2,
  the prepared result on the page, chosen reports, and withdrawal.
- **All three formats**: a 547-byte VCF, a 4 MiB VCF.gz, a 4 MiB gVCF (stored
  as `file_type` `gvcf`), and a 64 MiB VCF.
- **Withdrawal removes the original and its records**: delete answered 204,
  the Storage listing for the original is empty, its download answers "Object
  not found", and the `genome_files` row is gone (`journeys/gvcf-4mib.json`).
  The prepared artifacts in R2 are covered by the route's own contract, not by
  a reading of the bucket: see `withdrawal-residue.json` for exactly what that
  204 carries, what a payload tombstone looks like, and the owner check that
  the bucket itself still needs.
- **The monthly cap refuses the admission past its limit**: `/process`
  answered 429 with `preparation_capacity_reached`, the page showed the
  refusal wording, the file was kept and no job row was created. The limit
  was set to the month's admitted count for the test and restored to 100
  afterwards (`cap-refusal-receipt.json`).
- **Throughput at 64 MiB**: 279 seconds of container work, 183 artifacts and
  58.1 MB written to R2 (`measurements.json`).

## Two defects found, both fixed on this branch

1. **The image never carried the route register.** `src/lib/uploads/
   own-preparation-worker.ts` imports `docs/route-register.json`, which the
   Dockerfile did not copy, so every container start since 18 September
   exited before its first request and no job was ever claimed. Fixed in
   `87ab3fa`; `scripts/cloudflare-hosting-config.test.ts` now follows the
   worker entry's import graph and fails on any file it reaches outside
   `src/` that the image does not copy.
2. **The container was evicted about ninety seconds into every run.** The
   Durable Object returned as soon as it had started the container; an object
   with no pending work is evicted and takes its container with it. Small
   files finished inside that window and a 64 MiB file never could: it died
   twice, on `standard-1` and on `standard-2` alike, and its job then sat
   `claimed` with an expired lease, was passed over by six five-minute ticks,
   and left the person waiting the full hour for "we could not confirm
   whether file preparation finished". Fixed in `a2624b1`: the wake awaits
   the container's exit and re-arms a twenty-second alarm while it runs.

## What ran, in order

1. 19 September 01:38 · Session start; the three owner-set variables present.
2. 01:41 · Step 4.1: the preview signer's public half committed as the
   preview gateway's one key; preview issuer and container project URL set to
   the branch; hosting and guard tests 26/26.
3. 01:41 · Read-only preflight of the branch and of production.
4. 01:45 · Push `b38cc54`; draft pull request #147; `Deploy Cloudflare` for
   `preview`: run 35413646358, success 01:47:59. Vercel Preview
   `dpl_GN9c7UQD98Jp6mnDT5R9KPb4pV7V` READY 01:46:20.
5. 01:47 · Step 4.3 on the branch: the missing `upload_authorization_config`
   row inserted with the branch issuer and the owner's ceilings; preparation
   enabled on `r2` / `inherit-prepared-preview`; `max_job_seconds` 3600.
6. 01:48 · Served key equals committed key.
7. 01:55 · The upload page could not render: `BYOK_ENCRYPTION_KEY` was absent
   from the Vercel Preview target. Raised as an owner action; the owner set it
   at 03:03 on 20 September.
8. 02:03 · The route-register defect found and fixed; preview redeployed
   (run 35414765750). First container wakes that reach the branch, 02:15 and
   02:20.
9. 02:05 · `pnpm seed` against the branch (reference data only).
10. 04:19 · First full journey: the 547-byte VCF, prepared 31 seconds after
    enqueue.
11. 20 September 09:49 to 11:31 · The VCF.gz and gVCF journeys, both
    published, reported and (for the gVCF) withdrawn, with the original
    and its records gone.
12. 11:25 to 12:06 · Two 64 MiB attempts died mid-run, which isolated the
    eviction defect; the preview container was moved to `standard-2`
    (run 35509151886) and the host fix deployed (run 35510939794).
13. 12:39 to 12:45 · The 64 MiB VCF prepared end to end: 183 artifacts,
    58,148,752 bytes in R2, 279 seconds of container work.
14. 12:11 · The monthly cap refusal, with the limit restored afterwards.

## What is not proved

- **The ceilings are unproved, and the doubt about them is a projection.**
  Nothing above 64 MiB has been prepared on this stack. Multiplying the one
  measured rate out, a 2 GiB VCF would need about two and a half hours and an
  8 GiB gVCF about ten, against a schema that caps any job at one hour
  (`own_preparation_jobs_worker_deadline_bound`, with `max_job_seconds`
  checked at most 3600). That is arithmetic from a single file, not an
  observed refusal: it is the reason to measure at those sizes, not a
  substitute for doing so. `measurements.json` carries the numbers and says
  the same.
- **The 2 GiB and 8 GiB trials themselves.** Their upload, finalization and
  admission were being attempted when this was written; their preparation was
  deliberately not waited out.
- Peak memory: not available. Observability is off on the container Workers
  by configuration and no connected tool reports a container's memory.
- The R2 bucket's own object count after withdrawal: no connected tool lists
  objects in a bucket, and a completed withdrawal removes the cleanup rows
  along with the file, so there is nothing left to read back for that file
  either. `withdrawal-residue.json` records a live tombstone from another
  file's cleanup and the exact owner check the bucket still needs.
- One measurement per size, on one branch, with one fixture generator.
