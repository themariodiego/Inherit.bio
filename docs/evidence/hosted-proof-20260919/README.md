# Hosted proof on the preview stack · 19 September 2026

Runbook steps 4 (finish) and 5 of `docs/hosted-preparation-activation.md`,
run on the temporary preview stack: Supabase preview branch `hosted-proof`
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
| `preflight.json` | Read-only state of the branch before any write (01:41), with the production comparison. |
| `enable-preparation-receipt.json` | The guard, the exact statements and the postflight of step 4.3 (01:47:40). |
| `key-comparison.json` | The preview gateway's committed key against the key the Preview deployment serves (01:48:21, equal). |

## What ran, in order

1. 01:38 · Session start; the three owner-set variables present; disk 30 GB.
2. 01:41 · Step 4.1: preview signer's public half committed as the preview
   gateway's one key; preview issuer and container project URL set to the
   branch; README updated; hosting and guard tests 26/26.
3. 01:41 · Read-only preflight of the branch and of production (`preflight.json`).
4. 01:45 · Push `b38cc54`; draft PR #147; `Deploy Cloudflare` for `preview`
   dispatched on this branch: run 35413646358, success at 01:47:59.
   Vercel Preview `dpl_GN9c7UQD98Jp6mnDT5R9KPb4pV7V` READY at 01:46:20.
5. 01:47 · Step 4.3 on the branch (`enable-preparation-receipt.json`): the
   missing `upload_authorization_config` row inserted with the branch issuer
   and the owner's ceilings; preparation enabled on `r2` /
   `inherit-prepared-preview`; `max_job_seconds` 3600 for measurement.
6. 01:48 · Served key equals committed key (`key-comparison.json`).
7. 01:55 · First browser journey (64 MiB synthetic VCF): sign-in reached,
   upload page unavailable. Cause: `BYOK_ENCRYPTION_KEY` absent on the
   Vercel Preview target (owner action in `STATUS.md`).
8. 02:03 · The preview container had never reached the branch (no claim
   call in the branch's API logs since 00:00). Reproduced from the image's
   file set: the worker module imports `docs/route-register.json`, which the
   image did not copy. Fixed in `87ab3fa` (Dockerfile, `.dockerignore`,
   README, hosting test). `Deploy Cloudflare` for `preview` dispatched
   again: run 35414765750.
9. 02:05 · `pnpm seed` against the branch (reference data only).

## Measurements

None yet. Every upload, job, artifact and withdrawal measurement waits on
the owner action in `STATUS.md`.
