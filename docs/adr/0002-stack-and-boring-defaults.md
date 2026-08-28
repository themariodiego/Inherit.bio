# ADR-0002 — Stack and boring defaults

- Status: **Accepted** · 2026-08-28

## Decision

Next.js 16 (App Router, TypeScript strict, Turbopack) on Vercel; Supabase
for Postgres (+RLS), Auth (email+password with verification, GitHub OAuth),
Storage (TUS), and SQL migrations via the Supabase CLI; Resend + React Email
for all transactional mail; Tailwind v4 + shadcn/ui restyled to the shared
Plus Bio design language; tus-js-client for uploads; igv.js for the genome
browser; Vercel AI SDK for the copilot; Playwright + vitest + GitHub Actions
for CI; AGPL-3.0.

## Notable choices within the defaults

- **Next 16 `proxy.ts`** (middleware successor) refreshes Supabase sessions
  and gates the app shell.
- **BYOK key encryption:** AES-256-GCM in the app layer with a deployment
  env key (`BYOK_ENCRYPTION_KEY`), ciphertext in a table with zero client
  grants. Supabase Vault was considered (pgsodium is pending deprecation);
  app-layer crypto keeps the key outside the database entirely and works on
  any Postgres.
- **Report resolution at query time** rather than materialized result rows:
  templates join the canonical variant store on demand, so template updates
  apply instantly and deletion has fewer surfaces. PRS results are the
  exception (materialized per file at process time — they scan thousands of
  weights).
- **Fonts self-hosted via `next/font`**: zero runtime requests to Google
  Fonts, shrinking the third-party origin allowlist to just the
  user-invoked LLM endpoint.

## Alternatives rejected

- Supabase Edge Functions for processing (256 MB / 2 s CPU — see ADR-0001).
- pgmq for the worker queue (not clearly GA; plain table + `SKIP LOCKED` is
  portable).
- A separate marketing-site repo (needless split for a single product).
