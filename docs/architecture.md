# Inherit architecture

One Next.js 16 app (App Router, TypeScript strict) + one Supabase project +
Resend. Everything user-facing runs in the app; heavy compute that cannot
run serverless lives in the optional self-host worker
([ADR-0001](adr/0001-gating-decision-large-files-and-compute.md)).

```
Browser ── one scoped upload request ──► Supabase Storage (private originals)
   │                                          │
   │ metadata / consent / result requests     │ verified source read
   └──────────────────────────► Next.js app ◄──┘
                                  │ server-only authority checks
                                  ▼
                            Supabase Postgres
                         (RLS + purpose-bound RPCs)
                                  ▲
             optional prepared worker ──► private prepared artifacts
```

The diagram shows the current own-genome path. Its standard upload uses a
single direct-to-Storage request with a dedicated upload-only bearer, not a
normal login token. Legacy TUS uploads and the older `worker_jobs` consumer
are separate paths; neither makes the own uploader resumable.

## Data model

- `genome_files` holds file ownership, subject, processing state and source
  provenance. Own upload leases and finalization checks bind the exact
  source to the authenticated account and session.
- `user_variants` and `report_observed_calls` hold normalized database-backed
  calls. Missing, filtered and conflicting observations are not negative
  findings. Prepared sources instead use registered private objects and a
  published manifest; their readers do not fall back to database calls.
- `private.own_analysis_runs` binds each completed own result to its file,
  purpose, grant, source revision and captured content. `user_prs` and
  `ancestry_results` also remain in use by older processing paths.
- `purpose_grants` and consent records govern separate storage, report,
  ancestry and Copilot uses. Server-only RPCs recheck current authority;
  possession of a file identifier or a service-role client is not a user
  permission.
- `llm_settings` and `llm_keys` hold connection settings and encrypted keys.
  Own Copilot captures its permitted source/result context and rechecks it
  before provider requests, tool reads and message commits
  ([own Copilot authority](own-copilot-authority.md)).
- `ref_variants`, `ref_genes`, `prs_scores` and `prs_weights` are public
  reference data, seeded independently of user genomes and enriched on a
  schedule ([ADR-0005](adr/0005-annotation-reference-store.md)).
- `report_templates` holds the status-driven report library
  (`draft/review/published/retired`). The research pipeline creates review
  drafts; its publisher requires a recorded human decision. The seed command
  installs the bundled catalogue directly as published.
- `providers` holds directory products, dated prices, shipping rules and
  source URLs.
- `private.own_preparation_jobs` is the canonical preparation queue;
  `worker_jobs` is the separate older annotation queue.

## Own-genome processing

1. Account completion and current storage consent precede upload issuance.
   The database supplies deployment and account limits; the transport also
   imposes a stored-byte bound. The signer must be accepted by Storage.
2. The browser checks and hashes supported array, VCF or gVCF input, sends
   the source directly to Storage, and requests finalization. Finalization
   validates the stored source, integrity and single-sample structure.
3. `/api/files/[id]/process` dispatches to ordinary normalization or, when
   both deployment and database admission allow it, queued preparation.
   Supported GRCh37 calls use bundled liftover data to reach GRCh38.
4. Report purposes are selected separately. Generation reads the authorized
   source, resolves the current published templates, and commits captured
   results. Ancestry uses the bundled regional and lineage panels, retaining
   coverage and unavailable states. Polygenic output is coverage only;
   the existing calculation does not provide a validated personal score,
   percentile or risk estimate (`src/lib/genome/prs-output.ts`).
5. Report-ready mail is queued through the authorized completion path. Mail
   delivery needs the separate email configuration and delivery jobs.

Completed own per-file reports and ancestry retain captured content and
provenance; updating a template does not rewrite those results. Library
previews and legacy readers also exist, so a live template page must not be
mistaken for a new completed analysis. Copilot has separate current consent
and connection requirements and reads the permitted captured results.

## Optional prepared-object path

`INHERIT_PREPARED_WGS_ENABLED` defaults to `false`. Enabling the flag alone
is insufficient: database admission, source and artifact budgets, a
compatible running worker, and configured artifact storage must agree.
`pnpm worker:prepared` is the operator-started entry; hosted worker and
artifact-gateway code is under `workers/`. Preparation publishes a verified
manifest before report readers can use its objects. Cleanup uses registered
artifact identities and provider-specific fencing; an acknowledgement is
not proof that all payload bytes are gone.

This path does not change the upload transport or its limits. A configured
ceiling or passing small synthetic fixture does not establish full-size WGS
capacity. See [self-hosting](self-hosting.md), [worker setup](../worker/README.md)
and the [large-file proposal](large-file-upload-proposal.md).

## Privacy invariants (enforced, not asserted)

| Invariant | Enforcement |
| --- | --- |
| Own upload bytes bypass the app request body | Scoped direct-to-Storage upload; app routes handle metadata, authorization and finalization |
| No third-party requests from rendered pages | `e2e/network-audit.spec.ts` — origin allowlist is first-party only (fonts self-hosted) |
| No user data to annotation APIs | Reference ETL keyed by the platform catalog; joins happen in Postgres ([ADR-0005](adr/0005-annotation-reference-store.md)) |
| Own Copilot requires current named permission | Source, grant and connection checks before provider requests, tool reads and commits; denial returns no provider result |
| Cross-user isolation | RLS, scoped Storage authorization and server-only authority RPCs; direct API checks in `e2e/rls.spec.ts` and own-journey tests |
| Deletion has a tracked completion state | Own upload, file and account cleanup require storage work and completion checks; pending work is not reported as completed deletion |
| BYOK keys unreadable | `llm_keys` has zero anon/authenticated grants; AES-256-GCM under env key |

## The genome browser without a third-party reference

igv.js normally fetches reference sequence/annotation from public hosts —
which would leak the locus a user is viewing. Inherit defines a custom
`chromsizes`-format genome served from `/public/genomes/` (positions-only)
and feeds igv a single annotation track built from the user's own variants
via an RLS-scoped region API. No external origin is contacted; the network
audit covers it.

## Jobs

Vercel Cron (daily on the demo) hits `JOBS_SECRET`/`CRON_SECRET`-protected
routes; self-hosters can call the same routes from any scheduler. The
research pipeline records upstream release keys in `research_releases`,
drafts `review` templates (fixture-drivable for tests), and publishes via
`/api/jobs/research-publish`. That route takes no input (D-101): it drains
the templates a human reviewer approved in `template_reviews`, oldest
approval first, and the caller cannot name one.

## Worker (Tier 3)

`worker/` is a self-contained Node app consuming `worker_jobs` over a
direct Postgres connection (`FOR UPDATE SKIP LOCKED`). It ships with one
real stage (VCF annotation against `ref_variants`) and documents the
alignment/variant-calling extension path. It exists because ADR-0001 shows
that compute cannot run on Vercel or Supabase serverless — the platform
never claims otherwise.
