# Defect ledger

Append-only. Every admissible defect has an id, the lens that found it, a
reproduction, a severity and a status. Simulated lenses are labelled
`simulated: true` and are never described as user observations.

| Id | Date | Lens | Surface | Reproduction | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D-001 | 2026-09-03 | on-call engineer | branch topology | `git merge-base --is-ancestor origin/main origin/codex/readability-incident-response-remediation` is false: 32 verified commits were unreachable from `main` | high | fixed (pull request #41) |
| D-002 | 2026-09-03 | on-call engineer | `pnpm gate:readability` | 12 legal long blocks above grade 11 on `/terms`, `/legal/self-hosting`, `/legal/state-genetic-privacy` | medium | fixed (`a4e58b9`) |
| D-003 | 2026-09-03 | on-call engineer | `/science` | The report chips link to `/science#evidence` and the list's "Why?" to `/science#polygenic`; `src/app/(marketing)/science/page.tsx` had neither anchor | medium | fixed (`47bc818`) |
| D-004 | 2026-09-03 | on-call engineer | `pnpm gate:readability` | Extending the extractor to `src/copy/**/*.ts` and `src/emails/` surfaced 32 findings the JSX-only scan had never seen (29 unregistered plain words, one grade-9.1 mandated sentence, one grade-10.5 e-mail sentence, one contraction read as `dont`) | medium | fixed (`47bc818`, `7810ea6`, `31e1d7c`) |
| D-005 | 2026-09-03 | on-call engineer | `pnpm gate:readability` | Removing the stripped tokens `wont`/`doesnt` before the contraction rule landed broke the gate on `What we won't do.` at commit `7810ea6` (caught in the isolated pre-push verification, never on CI) | low | fixed (`4a3e0c6`, superseded by `31e1d7c`) |
| D-006 | 2026-09-03 | adversarial review (brief, privacy lenses) | `/genome/[subject]/reports/[slug]` | h1, breadcrumb and title carried the gene suffix; no category eyebrow; support panel nested inside "How sure we are"; provenance absent from "Where this comes from"; array explanation chosen when a VCF was present; density markers not on the selectors' elements; two generic bullets | medium | fixed (review-fix batch, this branch) |
| D-007 | 2026-09-03 | adversarial review (brief lens) | `/genome/[subject]/reports` | list header rendered the per-variant VCF sentence with no variant; search input removed against §4.4 item 7 | medium | fixed (review-fix batch) |
| D-008 | 2026-09-03 | adversarial review (privacy lens) | subject bar, Overview | an accepted-invitation record (owner null, subject account = invitee) was shown to the invitee as another adult "Uploaded with their permission" and on the bar as "Shared with you"; `minor` records got a permission chip; "Add a file" on other records uploaded to the caller's own record | high | fixed (review-fix batch) |
| D-009 | 2026-09-03 | adversarial review (brief lens) | `/overview` | an annotated file hid a second upload in flight (State C won over B); "regions found" counted with an invented 2% threshold; strings duplicated from their canonical homes; a second disclaimer in the sidebar | medium | fixed (review-fix batch) |
| D-010 | 2026-09-03 | adversarial review (brief lens) | all new surfaces | runtime links are literal paths; `src/lib/primary-routes.ts` (§5.5) does not exist | medium | open — task #12 |
| D-011 | 2026-09-03 | review-fix agent (report surfaces) | `/genome/[subject]/reports/[slug]` | the six skeleton sections sit 40px apart (`space-y-10`) while `docs/density-baseline.json` requires ≥96px between adjacent top-level sections at ≥1024px | low | open — take with the density gate (G2.5), which does not yet measure report pages |
| D-012 | 2026-09-03 | CI run 33750829586 | `e2e/search.spec.ts` | the caffeine test pressed Enter on the first Reports result and expected the CYP1A2 template, but two seed templates match "caffeine" and the ADORA2A one ranks first; the spec now follows the specific link (product behaviour unchanged) | low | fixed (this branch) |
