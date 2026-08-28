# Adversarial audit report

Six adversarial audits were run over the codebase (security/RLS, privacy
data-flow, scientific correctness, UX fidelity & accessibility, clean-room
install, legal-copy completeness). Each medium+ finding was independently
re-verified by a second agent instructed to default to false-positive.

**Result: 12 findings, 5 medium actionable — all 5 verified real (0 false
positives) — plus 7 info/low.** Legal, privacy data-flow, and UX-contrast
audits returned clean. Every finding is dispositioned below.

## Confirmed findings — all fixed

| # | Sev | Audit | Finding | Disposition |
| --- | --- | --- | --- | --- |
| 1 | Medium | Security | Process route fetched a client-set `bucket_path` with the service-role key (storage-RLS bypass); no owner-prefix check. Latent — the random UUID segment makes the victim path unguessable — but zero ownership validation on a service-role path. | **Fixed** `src/app/api/files/[id]/process/route.ts`: refuse any `bucket_path` not under `${user.id}/` before the fetch. |
| 2 | Medium | Security | SSRF: the BYOK OpenAI-compatible `base_url` (validated only as a URL) is fetched server-side; an authenticated user could target cloud metadata / internal services and read the streamed response. | **Fixed** `src/lib/llm.ts` + `src/app/api/chat/route.ts`: `ssrfReasonForBaseUrl` always blocks link-local/cloud-metadata and blocks loopback/RFC-1918 unless `ALLOW_PRIVATE_LLM_ENDPOINTS=true` (the self-host/local-model case). Unit-tested. |
| 3 | Medium | Science | The CFTR F508del report was dead code: its indel interpretation keys contained `/`, which `genotypeKey` strips, so a real F508del carrier saw "not recognized". Failed safe (a non-answer, never a wrong answer). | **Fixed** the template keys to the sorted no-separator form; extended `scripts/validate-templates.ts` to check indel keys and reject `/` in keys (all 151 templates pass); added a `reports.test.ts` indel regression test. |
| 4 | Medium | Clean-room | `docs/self-hosting.md` told worker installers to `cp .env.example .env` where no `worker/.env.example` existed, with the wrong var name in the comment. | **Fixed**: added `worker/.env.example` (correct `SUPABASE_URL`, not `NEXT_PUBLIC_*`) and aligned the doc command with `worker/README.md`. |
| 5 | Low | Clean-room | `CRON_SECRET` is read by the scheduled-job routes and required for Vercel Cron auth but was absent from `.env.example`, so crons would silently 401. | **Fixed**: added `CRON_SECRET` (and `ALLOW_PRIVATE_LLM_ENDPOINTS`) to `.env.example`. |

## Info/low findings — disposition

| Sev | Audit | Finding | Disposition |
| --- | --- | --- | --- |
| Low | Security | `worker_jobs` is client-insertable with an unconstrained payload the worker dereferences with the service role. | **Accepted, mitigated in scope**: `worker_jobs` insert is owner-only (RLS); the process route (finding 1) and the Tier-3 worker both now validate storage paths against the owner prefix. The worker is a self-host component operating on the operator's own project. |
| Info | Science | Misophonia citation label read 2023 vs PubMed 2022. | **Fixed** the label. |
| Low | UX | Marketing header nav vanished below `md` with no replacement. | **Fixed**: added a scrollable mobile nav row. |
| Low | UX | The screen-reader-only file input was a keyboard focus stop. | **Fixed**: `aria-hidden` + `tabIndex=-1` (the visible "Choose file" button drives it). |
| Info | UX | `--forest-deep` token defined but unreferenced. | **Accepted**: kept as a documented palette token (hover/emphasis) for the design system; harmless. |
| Low | Clean-room | Node prereq (20.9) vs worker needing 22+. | **Fixed** the doc to note the worker's Node 22+ requirement. |
| Info | Clean-room | `SERVER_URL` (legal gate's optional rendered-page mode) undocumented. | **Accepted**: it is an optional CI/dev override; the gate falls back to a source scan, and it is documented in the gate script's header comment. |

## Audits that returned clean

- **Privacy data-flow**: no genome-derived data leaves the deployment absent a
  stored consent grant; the reference/research jobs are catalog-keyed, not
  user-keyed; no trackers; fonts self-hosted; the genome browser contacts no
  external host; no genotype data in logs or error columns.
- **Legal-copy completeness**: all eight Section-1 requirements plus the
  dual-surface Plus Bio disclosure present with real content; no
  coverage-inflation or diagnostic claims; on-surface report disclaimer.
- **UX contrast**: all body text passes WCAG AA in both themes; both themes
  redefine every token; attribution accurate and never implies a Plus Bio
  product.
- **Scientific spot-check** (beyond finding 3): 20+ variants verified against
  Ensembl GRCh38 (positions, ref/alt, strand-correct risk direction incl.
  ADH1B and PTPN22), 18 PMIDs confirmed real and on-topic, PGS000011 confirmed
  genuine PGS Catalog data, PRS math and the palindrome guard correct.
