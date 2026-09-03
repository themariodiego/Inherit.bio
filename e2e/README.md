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
| `family.spec.ts` | 5, 14, 19, 33, 34 | Family surfaces (§5, X6.1, X9.2, G2.2, G5.1b): `/family` signed out keeps the jurisdiction panel and the Future Person panel (L-22) with no result; signed in, h1 "Family", ≤6 headings, exactly one primary ("Add another adult" → `/family/invite`), every rendered link answering 200 and every tile without a destination carrying its blocking sentence, "Just you so far." with nobody, ≤12 first-viewport interactives at 1280×800 and 390×844, axe clean in both themes; `/family/invite` renders the pre-consent statement verbatim above the form and inside no `details`, the "Invite them." heading, the optional note (which reaches the mail as words, never a link) and no Path B link; A invites B, B accepts in their own account, adds their own file and turns on one layer from their own session while the opposite column stays disabled with "Only {name} can turn this on."; A's card reads "Reports ready" with no file count before the grant; the Tier-2 gate withholds every result server-side (no `data-figure-kind`, no slug, nothing in `localStorage` or `sessionStorage`) until the exact checkbox is ticked, then the four covered reports, the "Shared with you" chip, the `Family / {name}` breadcrumb and the baseline-absence sentence exactly once; a report opens with its claim block attributed to B's own subject, never to the handle; pause makes the card read "Sharing paused" and turns `/genome/s-{B}/reports` into a 404 on the next request; resume restores it; stop names B in its dialog, writes the tombstone with its count, and leaves every derived surface empty with zero live grants |
| `family-health-picture.spec.ts` | 17, 20, 33, 34 | `/family/health-picture` over two accounts that have both turned on being seen side by side: the Tier-2 gate withholds every result server-side; the mandated comparison banner, the G4.5 no-ranking statement, the joint-selection and availability sentences and one trade-off line per column, none of them collapsible; one compare surface per layer, one attributed claim block per cell naming exactly one subject, no `aria-sort`, no `<th>` button and no button inside the table, and the exact baseline-absence sentence in both column footers; the carrier panel over seven synthetic classified positions with exactly one block carrying the 25-in-100 sentence and the exactness label, four carrying the no-probability sentence with their named reason (the two-copies reason included), every block naming both variants and both classifications, and no block for the two positions neither file shows the classified change at; the runs measure stored with each ingested file, equal to the real measure over the fixture; the count sentence once no match is left over a classified set, and the plain "nothing to check yet" sentence once the set is empty; another adult's estimate cells reading "Not shared with you" once their `reports.polygenic` grant is revoked, while their column and the carrier panel remain; the independent-login marker set through `mark_independent_login_v1` from a real session, and the Tier-2 gate passed in every browser context that reads a result; no `centimorgan`, `cM`, `kinship`, `shared DNA` or `related to` anywhere in the page; ≤24 first-viewport interactives at 1280×800 and axe clean in both themes; the Overview's `1 carrier match to look at` line with its subject pair and no value; and after one revocation, an empty page and no Overview line on the very next request |
| `search.spec.ts` | — | Global search (§2 §1.3): header "Search" button with shortcut hint on `/overview` and `/genome/me`; ⌘K/Ctrl+K and the button open the labelled modal dialog, Escape closes it and returns focus; `caffeine` → Reports group with the caffeine template link and the `You` chip; `settings` → Settings group with `/settings`; the account's own display label → People and embryos with `You`; group labels are `<p>` in the mandated order, ≤8 links per group, no `[data-figure-kind]`, `%` or genotype pair; arrow keys move focus, Enter follows; the no-results sentence in a polite live region; `/api/search` 401 signed out and destinations-only JSON signed in |

Lighthouse ≥90 (A16) is checked by `scripts/lighthouse-check.ts` (run against
the served build); a11y coverage here is axe-based and stricter per-rule.
