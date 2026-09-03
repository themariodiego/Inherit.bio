# E2E suite

Playwright specs run against a **production build** of the app backed by the
**local Supabase stack** (real PostgREST, Storage, Auth, Mailpit) — nothing
that is under test is mocked. The one deliberate mock is an
OpenAI-compatible LLM endpoint (`mock-llm.ts`), so the copilot's consent gate
and tool loop can be exercised with zero real third-party traffic.

## Running

```bash
pnpm supabase start          # local stack (Docker)
pnpm seed                    # providers + templates + PRS into the local DB
# one-time host alias so the mock LLM is classified as a cloud provider:
echo "127.0.0.1 mock-llm.test" | sudo tee -a /etc/hosts
pnpm exec playwright install chromium
pnpm e2e
```

`playwright.config.ts` builds and serves the app on port 3100 with the local
stack's credentials, a test `BYOK_ENCRYPTION_KEY`, and `RESEND_BASE_URL`
pointed at the in-test mock Resend API.

## What each spec proves (acceptance matrix)

| Spec | Item | Proves |
| --- | --- | --- |
| `auth.spec.ts` | A2 | sign-up → Mailpit verification link → session; password reset |
| `providers.spec.ts` | A3 | ≥12 providers, source+date metadata, US→NY exclusion flags |
| `upload-vcf.spec.ts` | A5, A8 | GIAB VCF upload→parse→annotate; rsID/gene search; igv browser; honest ancestry labels |
| `copilot.spec.ts` | A9 | local-mode instructions; consent dialog names provider+data classes; tool call + cited answer; revocation |
| `tier2-upload.spec.ts` | A10 | BAM resumable TUS upload interrupted+resumed, hashed, re-downloadable |
| `rls.spec.ts` | A12 | cross-user reads/writes denied on real PostgREST + storage; anon denied; llm_keys hard-denied |
| `deletion-export.spec.ts` | A13 | export ZIP contents; deletion removes rows + storage (privileged re-query) |
| `network-audit.spec.ts` | A14 | first-party-only request origins on landing/dashboard/report/legal; no fbq/gtag |
| `legal.spec.ts` | A15 | legal pages complete + placeholder-free; disclaimers on report surface; Plus Bio disclosure |
| `a11y.spec.ts` | A16 | axe WCAG 2 AA on key pages, both themes; design tokens present |
| `research.spec.ts` | A7 | fixtured release → review-queue draft → publish → changelog + digest |
| `report-gate.spec.ts` | — | sensitive reports withhold the result server-side until `?reveal=1`; the choice is remembered per user and category |
| `report-skeleton.spec.ts` | — | six fixed report headings; one attributed genotype figure per covered variant; exact not-covered, partial-state and not-diagnostic strings; layer-labelled counts and nine-category order |
| `overview.spec.ts` | — | Overview hub: four headings, nine box links named exactly by their labels, one primary button per state, counts with unit noun and note, no figures or dashes, X6.1 first-viewport budgets at 1280×800 and 390×844, phone bottom bar (five 44px labelled items, `aria-current`), State C split count, ancestry line and starter list |

Lighthouse ≥90 (A16) is checked by `scripts/lighthouse-check.ts` (run against
the served build); a11y coverage here is axe-based and stricter per-rule.
