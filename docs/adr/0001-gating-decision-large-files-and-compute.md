# ADR-0001 — Gating Decision: large-file upload path, size caps, and compute placement

- Status: **Accepted** · 2026-08-28
- Deciders: Sequence engineering
- This ADR gates every feature: no capability may be claimed that it shows
  infeasible.

## Verified platform limits (all checked 2026-08-28 against official docs)

| Limit | Value | Source |
| --- | --- | --- |
| Vercel Function request body | **4.5 MB** max (413 beyond) | [vercel.com/docs/functions/limitations](https://vercel.com/docs/functions/limitations#request-body-size) |
| Vercel Function response body | **4.5 MB** max (same section; streaming not documented as exempt) | ibid. |
| Vercel Function max duration (Fluid) | Hobby 300 s fixed; Pro 300 s default / **800 s** GA max (1800 s beta) | [duration limits](https://vercel.com/docs/functions/configuring-functions/duration#duration-limits) |
| Vercel Function memory | 2 GB / 1 vCPU default (Pro max 4 GB / 2 vCPU) | [memory](https://vercel.com/docs/functions/configuring-functions/memory) |
| Vercel Cron | Hobby: daily only, ±59 min jitter; Pro: per-minute | [cron pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| Supabase Storage object size | Free **50 MB**; Pro up to **500 GB** (global file-size-limit setting applies) | [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits) |
| Supabase Storage resumable uploads | TUS at `…/storage/v1/upload/resumable`, chunk size **exactly 6 MiB** | [resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) |
| Supabase Free plan quotas | 1 GB storage, 500 MB database | [pricing](https://supabase.com/pricing) |
| Supabase Pro plan quotas | 100 GB storage incl., 8 GB DB incl. (expandable) | ibid. |
| Supabase Edge Functions | 256 MB memory, 2 s CPU per request, 150 s (Free) / 400 s wall | [functions limits](https://supabase.com/docs/guides/functions/limits) |
| Supabase Cron (pg_cron) | available all plans, sub-minute capable | [cron](https://supabase.com/docs/guides/cron) |
| Supabase built-in auth email | 2/hour, non-production only; custom SMTP recommended | [auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp) |
| Resend free tier | 100 emails/day, 3 000/month; `resend.dev` sender delivers only to the account owner | [quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [403 resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) |

## The constraint arithmetic

A 30x whole-genome dataset is ~80–120 GB FASTQ, ~50–80 GB BAM, ~15–25 GB
CRAM, ~1.5 GB VCF.GZ; a consumer array export is ~5–25 MB. Alignment of one
30x genome needs tens of CPU-hours and ≥16 GB RAM. Against the table above:

1. **No genome file can transit a Vercel Function** (4.5 MB body cap, both
   directions).
2. **No alignment or variant calling can run on Vercel or Supabase Edge
   Functions** (2 s CPU / 256 MB / ≤800 s wall vs. tens of CPU-hours).
3. **Free-plan Supabase caps objects at 50 MB and total storage at 1 GB** —
   BAM/CRAM support at consumer scale requires Pro (500 GB objects) or
   self-hosting.

## Decision

**Upload path.** All uploads go browser → Supabase Storage directly over the
TUS resumable protocol (6 MiB chunks), with client-side streaming SHA-256
(hash-wasm) and client-side format sniffing before the first byte is sent.
No upload touches a Vercel route. Downloads are served with short-lived
signed URLs (redirect), never proxied through a function.

**Tier caps (demo deployment, configurable via `NEXT_PUBLIC_MAX_*_BYTES`):**

| Tier | Formats | Cap (demo) | What happens |
| --- | --- | --- | --- |
| 1 | 23andMe / AncestryDNA / MyHeritage / FTDNA text, VCF / VCF.GZ / gVCF | 100 MB array, 200 MB VCF | Fully parsed → canonical GRCh38 variant store → reports, PRS, ancestry |
| 2 | BAM / CRAM | 5 GB (requires Supabase Pro; 50 MB on Free) | Stored, hashed, listed, re-downloadable; analyzed only by the Tier-3 worker |
| 3 | FASTQ (+ Tier-2 analysis) | not accepted serverless | Self-host worker (`worker/`): queue consumer the user runs on their own machine/cloud; ships with a real VCF-annotation stage; alignment/calling documented as the extension path |

**Processing placement.**

- *Parse/normalize/liftover (Tier 1):* a Node runtime Vercel route
  (`maxDuration 300`) streams the object from Storage and batch-inserts
  variants. A ~25 MB array file parses in seconds; a 200 MB VCF stays well
  inside 300 s. The 4.5 MB body limit is irrelevant because the file arrives
  from Storage, not the request.
- *Annotation:* at query time, by joining `user_variants` against the
  server-side `ref_variants` reference store (refreshed by a scheduled job).
  **User genotypes are never sent to any third-party annotation API**;
  reference data is fetched independently of any user's data.
- *PRS + ancestry (admixture, mtDNA/Y haplogroups):* computed inside the same
  processing route from bundled, license-audited reference data (seconds of
  CPU).
- *Scheduled jobs* (research-library watch, annotation refresh): Vercel Cron
  (Pro, per-minute capable; the demo schedules daily) hitting
  `JOBS_SECRET`-protected routes. pg_cron+Edge Functions considered and
  rejected: Edge Function CPU/memory caps rule out dataset parsing, and one
  Next.js codebase beats a second runtime. (Self-hosters without Vercel can
  call the same routes from any scheduler.)
- *Worker (Tier 3):* plain-table job queue (`worker_jobs`,
  `FOR UPDATE SKIP LOCKED`) consumed over a direct Postgres connection.
  pgmq/Supabase Queues considered: functional but not clearly GA, and a plain
  table keeps the worker portable to any Postgres.

**Honest labeling.** The upload UI states each tier's behavior before upload;
Tier-2 files are labeled "stored, not analyzed (needs the self-host
worker)"; processing-time labels show measured p50/p95 from
`processing_time_stats()`, never marketing estimates.

**Email.** Resend is the only mail path (SMTP into Supabase Auth for
verification mail where configured; API for app mail). The demo sends from
`resend.dev` (delivers only to the operator — documented); self-hosters set
their own verified domain via `EMAIL_FROM`.

## Consequences

- "Upload your FASTQ" is **not** claimed anywhere in the product. FASTQ
  support exists only as the documented worker extension path.
- The public demo runs on Supabase Free (50 MB objects): demo Tier-2 caps
  are set accordingly and the UI says so. Production sizing (Pro: 500 GB
  objects, 100 GB storage, 8 GB+ DB) is in `docs/self-hosting.md`.
- A full-WGS VCF (~1.5 GB gz) exceeds the demo VCF cap; the cap is stated at
  the upload surface with the self-host escape hatch.
