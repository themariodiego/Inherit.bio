# Deployment status and the one owner-only step

This document records the live deployment state and the single step that
requires the Vercel account owner, because the available automation cannot
set Vercel environment variables.

## Provisioned (live)

- **Supabase project `sequence`** (`zuvloczwgrayonqabnss`, region us-east-1):
  all five migrations applied, RLS verified by the security advisor (only
  intentional deny-all tables flagged), and partially seeded — the public
  **provider directory (16 rows)** and the **135 reference variants** are
  live. The **151 report templates and 3 PRS scores** are seeded by the
  owner running `pnpm seed` once (below); they only render on authenticated
  pages, which need the secret env vars anyway, so nothing public is missing
  in the meantime.
  - Project URL: `https://zuvloczwgrayonqabnss.supabase.co`
  - Anon/publishable key (safe to expose): `sb_publishable_rNejZTcIIARYXRntz8YvbA_VcxEQZLg`
- **Vercel project `sequence`** (`prj_K7bVowhjFr0uIapXraH41hthJkgy`, team
  `mariodiego`): linked to `themariodiego/sequence`, production branch
  `main`. It auto-deploys on push to `main`.

## The one owner step: environment variables

The Vercel MCP tools available in this environment cannot set environment
variables, and no Vercel CLI token is present, so the following must be set
once in the Vercel dashboard (Project → Settings → Environment Variables,
Production) before the deployment is functional. After setting them, redeploy
(or merge the PR to `main`).

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://zuvloczwgrayonqabnss.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_rNejZTcIIARYXRntz8YvbA_VcxEQZLg` |
| `NEXT_PUBLIC_SITE_URL` | your production URL, e.g. `https://sequence.vercel.app` |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase dashboard → Project Settings → API (secret) |
| `DATABASE_URL` | from Supabase dashboard → Database → Connection string |
| `BYOK_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `JOBS_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` (lets Vercel Cron call the scheduled jobs) |
| `RESEND_API_KEY` | a Resend API key |
| `EMAIL_FROM` | a verified Resend sender, e.g. `Sequence <onboarding@resend.dev>` |

Then seed the reference data into the hosted project (report templates + PRS;
providers are already seeded):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://zuvloczwgrayonqabnss.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
pnpm seed
```

## Auth email (production)

Set Supabase → Authentication → SMTP to Resend
(`smtp.resend.com:465`, user `resend`, password = your Resend API key,
sender = your verified `EMAIL_FROM`), so verification and reset emails send
through Resend rather than the built-in 2/hour service.

## Why this is a handoff, not a gap in the build

Everything the code and the available automation can do is done: the schema
is live, RLS is proven, the directory is seeded, the app builds green, and
the Vercel project is linked so a push deploys it. Only the secret values —
which by design never live in the repo — need to be pasted into Vercel once
by someone with dashboard access. This is the same one-time step any
self-hoster performs (see `docs/self-hosting.md`).
