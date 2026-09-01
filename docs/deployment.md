# Deployment status and the one owner-only step

This document records the live deployment state and the single step that
requires the Vercel account owner, because the available automation cannot
set Vercel environment variables.

## Provisioned (live)

- **Supabase project `Inherit`** (`zuvloczwgrayonqabnss`, region us-east-1):
  all five migrations applied, RLS verified by the security advisor (only
  intentional deny-all tables flagged), and fully seeded — the **provider
  directory (16 rows)**, **151 report templates**, **3 PRS scores (697
  weights)**, and the **reference variants** are live. Re-running
  `pnpm seed` (below) stays safe — every write is an idempotent upsert.
  - Project URL: `https://zuvloczwgrayonqabnss.supabase.co`
  - Anon/publishable key: retrieve it from Project Settings → API; do not
    commit even publishable credentials to this repository.
- **Vercel project `inherit`** (`prj_K7bVowhjFr0uIapXraH41hthJkgy`, team
  `mariodiego`): linked to `themariodiego/Inherit.bio`, production branch
  `main`. It auto-deploys on push to `main`.

## The one owner step: environment variables

The Vercel MCP tools available in this environment cannot set environment
variables, and no Vercel CLI token is present, so the following must be set
once in the Vercel dashboard (Project → Settings → Environment Variables,
Production) before the deployment is functional. After setting them, redeploy
(or merge the PR to `main`).

> **Note**: production env belongs here — in the hosting platform's
> environment variables — never in a committed file such as
> `.env.production`. `NEXT_PUBLIC_*` values are inlined into every bundle at
> build time, so builds must receive them explicitly; a committed env file
> would silently bake its values into anyone's local `pnpm build`.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://zuvloczwgrayonqabnss.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase dashboard → Project Settings → API (publishable) |
| `NEXT_PUBLIC_SITE_URL` | the production URL: `https://inherit.bio` |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase dashboard → Project Settings → API (secret) |
| `DATABASE_URL` | from Supabase dashboard → Database → Connection string |
| `BYOK_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `JOBS_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` (lets Vercel Cron call the scheduled jobs) |
| `RESEND_API_KEY` | a Resend API key |
| `EMAIL_FROM` | a verified Resend sender, e.g. `Inherit <onboarding@resend.dev>` |

To re-seed reference data later (all upserts, safe to repeat):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://zuvloczwgrayonqabnss.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
pnpm seed
```

## Auth URLs (production) — required, or auth emails bounce to localhost

Supabase's auth redirects default to `http://localhost:3000`, and the app's
`emailRedirectTo` is only honored if it is on the project's allowlist. Until
this is set, every verification/reset link dead-ends at
`localhost:3000/?code=…` ("This site can't be reached"). Note the email
address itself still gets **confirmed** — the verify happens on Supabase's
domain before the redirect — so an affected user can simply sign in at the
production URL; only the redirect is broken.

In Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://inherit.bio` (once the domain is attached to the
  Vercel project)
- **Redirect URLs**: add
  - `https://inherit.bio/**`
  - `https://sequence-mariodiego.vercel.app/**` (still-working Vercel alias)
  - `https://sequence-murex.vercel.app/**` (still-working Vercel alias)
  - optionally `https://sequence-*-mariodiego.vercel.app/**` for preview
    deployments

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
