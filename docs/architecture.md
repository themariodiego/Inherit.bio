# Sequence architecture

One Next.js 16 app (App Router, TypeScript strict) + one Supabase project +
Resend. Everything user-facing runs in the app; heavy compute that cannot
run serverless lives in the optional self-host worker
([ADR-0001](adr/0001-gating-decision-large-files-and-compute.md)).

```
Browser ──TUS (6 MiB chunks)──────────────► Supabase Storage  (private bucket,
   │                                            │               per-user prefix RLS)
   │  supabase-js (anon key, RLS)               │ stream
   ├──────────────► Supabase Postgres ◄─────────┤
   │                  (RLS everywhere)          │
   │  fetch /api/*                              │
   └──────────────► Next.js on Vercel ──────────┘
                      │  service role (server only)
                      │
        Vercel Cron ──┤  /api/jobs/research-refresh   (GWAS/PGS/ClinVar release watch)
                      │  /api/jobs/annotation-refresh (Ensembl enrichment of ref store)
                      │
     Self-host worker ┴─ direct Postgres: worker_jobs queue (SKIP LOCKED)
```

## Data model (all user tables RLS owner-only)

- `genome_files` — one row per upload; tier 1 (fully processed) or 2
  (stored). Status machine: `uploading → uploaded → parsing → annotated`
  (or `failed`), Tier 2: `stored`. Measured processing timestamps feed
  `processing_time_stats()` for honest p50/p95 labels.
- `user_variants` — canonical GRCh38 store, one row per called variant
  (arrays: every genotyped position incl. no-calls skipped at parse; VCF:
  variant lines only). Indexed by (user, rsid) and (user, chrom, pos).
- `ref_variants` / `ref_genes` / `prs_scores` / `prs_weights` — the
  reference store: report-relevant slices of public datasets, seeded from
  the template catalog and enriched on a schedule
  ([ADR-0005](adr/0005-annotation-reference-store.md)). World-readable, no
  user data.
- `report_templates` — the report library, status-driven
  (`draft/review/published/retired`); the research pipeline inserts
  `review` drafts; publishing writes `changelog_entries` and triggers the
  opt-in digest.
- `user_prs`, `ancestry_results` — materialized per-file results computed at
  process time.
- `llm_settings` + `llm_keys` (zero client grants; AES-256-GCM ciphertext),
  `consent_grants`, `chats`/`chat_messages` — the copilot surface
  ([ADR-0004](adr/0004-llm-copilot-privacy-model.md)).
- `providers` — the directory as data: products, prices with capture dates,
  shipping structure, state exclusions, source URLs, last-verified dates.
- `worker_jobs` — the Tier-3 queue.

## Processing pipeline (Tier 1)

`/api/files/[id]/process` (Node runtime, 300 s):

1. Stream the object from Storage (service role) — never through a request
   body.
2. Sniff/parse: array formats or VCF/gVCF (`src/lib/genome/parsers/`),
   streaming line parsers with per-vendor genotype normalization.
3. GRCh37 arrays → GRCh38 via bundled Ensembl chain file
   (`src/lib/genome/liftover.ts`).
4. Batch-insert `user_variants` (10 k rows/request).
5. Compute admixture (EM over AIM panel), mtDNA/Y haplogroups (tree walk
   over curated markers), PRS (dosage × weight with palindrome-safe strand
   handling, analytic percentile under HWE) — all from bundled,
   license-audited reference data, all labeled with what the file supports.
6. Report-ready email via Resend.

Reports are **not** materialized: report pages resolve templates against
`user_variants` at query time (`src/lib/genome/reports.ts`), so template
updates apply instantly and deletion surfaces stay small.

## Privacy invariants (enforced, not asserted)

| Invariant | Enforcement |
| --- | --- |
| No genome data through Vercel request bodies | TUS direct-to-storage; 4.5 MB body cap makes violations fail loudly |
| No third-party requests from rendered pages | `e2e/network-audit.spec.ts` — origin allowlist is first-party only (fonts self-hosted) |
| No user data to annotation APIs | Reference ETL keyed by the platform catalog; joins happen in Postgres ([ADR-0005](adr/0005-annotation-reference-store.md)) |
| No cloud LLM without named consent | 403 `consent_required` server-side before any tool runs; grants revocable (`e2e` copilot spec) |
| Cross-user isolation | RLS on every table + storage prefix policies; attacked directly in `e2e/rls.spec.ts` |
| Deletion deletes | Storage prefix walk + auth-user cascade; verified by privileged re-query in `e2e/deletion-export.spec.ts` |
| BYOK keys unreadable | `llm_keys` has zero anon/authenticated grants; AES-256-GCM under env key |

## The genome browser without a third-party reference

igv.js normally fetches reference sequence/annotation from public hosts —
which would leak the locus a user is viewing. Sequence defines a custom
`chromsizes`-format genome served from `/public/genomes/` (positions-only)
and feeds igv a single annotation track built from the user's own variants
via an RLS-scoped region API. No external origin is contacted; the network
audit covers it.

## Jobs

Vercel Cron (daily on the demo) hits `JOBS_SECRET`/`CRON_SECRET`-protected
routes; self-hosters can call the same routes from any scheduler. The
research pipeline records upstream release keys in `research_releases`,
drafts `review` templates (fixture-drivable for tests), and publishes via
`/api/jobs/research-publish`.

## Worker (Tier 3)

`worker/` is a self-contained Node app consuming `worker_jobs` over a
direct Postgres connection (`FOR UPDATE SKIP LOCKED`). It ships with one
real stage (VCF annotation against `ref_variants`) and documents the
alignment/variant-calling extension path. It exists because ADR-0001 shows
that compute cannot run on Vercel or Supabase serverless — the platform
never claims otherwise.
