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
