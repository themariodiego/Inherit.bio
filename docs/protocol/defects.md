# Defect ledger

Append-only. Every admissible defect has an id, the lens that found it, a
reproduction, a severity and a status. Simulated lenses are labelled
`simulated: true` and are never described as user observations.

| Id | Date | Lens | Surface | Reproduction | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D-001 | 2026-09-03 | on-call engineer | branch topology | `git merge-base --is-ancestor origin/main origin/codex/readability-incident-response-remediation` is false: 32 verified commits were unreachable from `main` | high | fixed (pull request #41) |
| D-002 | 2026-09-03 | on-call engineer | `pnpm gate:readability` | 12 legal long blocks above grade 11 on `/terms`, `/legal/self-hosting`, `/legal/state-genetic-privacy` | medium | fixed (`a4e58b9`) |
