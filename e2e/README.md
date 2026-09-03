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
| `ancestry.spec.ts` | A8, 30–34 | Ancestry surface (§4.6, A.8, G4.4, X16.5) on two users: the tiny VCF renders the grey state (the exact "covers only 0 of {panel size} ancestry markers" sentence, no chips, no toggle, no visible `%` outside the disclosure, lineage empty states, `#neanderthal` present, `archaic-hominin` absent, axe in both themes); the synthetic marker fixture renders the shown state (every `ancestry-share` figure with a one-decimal value and a `no range yet` or range unit and no other `%` text node, shown + unassignable + hidden = 100.0 in both toggle states with both chips present, toggling changes the visible rows and paths, Tab order over paths equals descending share, panel open/close/focus return on click, Escape and background click, no denylist word in any label, gradient last stop `stop-opacity="0"` with a feather ≥ 15% of the path's bbox width, ≤ 12 first-viewport interactives at 1280×800, first-party origins only and no `/geo/` request) |
| `genome-data.spec.ts` | A5 | Expert path (§7.3) on the tiny VCF: the genome browser renders one attributed claim block per results table with every genotype as an observed `genotype` figure (class `variant-call`, provenance `computed:genome/browser`, value `A/C`), rsIDs and ungrouped coordinates as text, breadcrumb `My Genome / {name} / Data / Genome browser`, the subject bar, h1 "Genome browser" and exactly the three headings Genome browser / Results / Region, no `.eyebrow`, no `title` in the table, headers Variant / Position / Gene / Your two letters, the region range `chr15:74744576-74754576` as text, the first-party sentence, one default button ("Search") and ≤ 12 first-viewport interactives at 1280×800 with the track's canvas in view; gene search (the covered row `A/C`, every other row "Not covered by your file"), the clinical-gene status sentence, the trait suggestion linking the caffeine report by its current title, the no-match sentence with the reports link; `/genome/me/data` titled "Data and methods" with the two outline links, one `coverage` figure and one attributed block per score and no `%` text; the Settings and ancestry "Data and methods" links to `/genome/me/data` |
| `search.spec.ts` | — | Global search (§2 §1.3): header "Search" button with shortcut hint on `/overview` and `/genome/me`; ⌘K/Ctrl+K and the button open the labelled modal dialog, Escape closes it and returns focus; `caffeine` → Reports group with the caffeine template link and the `You` chip; `settings` → Settings group with `/settings`; the account's own display label → People and embryos with `You`; group labels are `<p>` in the mandated order, ≤8 links per group, no `[data-figure-kind]`, `%` or genotype pair; arrow keys move focus, Enter follows; the no-results sentence in a polite live region; `/api/search` 401 signed out and destinations-only JSON signed in |

Lighthouse ≥90 (A16) is checked by `scripts/lighthouse-check.ts` (run against
the served build); a11y coverage here is axe-based and stricter per-rule.
