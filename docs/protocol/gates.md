# Gate run ledger

Append-only. One row per gate run: command, exit code, artifact. A gate row
without all three is not evidence.

| Date | Gate | Command | Exit | Artifact |
| --- | --- | --- | --- | --- |
| 2026-09-03 | G1.2 | `pnpm typecheck` | 0 | merged tree `b565055`; CI run 33728103297 |
| 2026-09-03 | G1.3 | `pnpm lint` | 0 | same |
| 2026-09-03 | G1.4 | `pnpm test` | 0 | 168 tests, 19 files |
| 2026-09-03 | G1.5 | `pnpm e2e` (CI) | 0 | CI run 33728103297, job 100561617660 |
| 2026-09-03 | G1.8 (static) | `pnpm gate:legal` | 0 | 25 source files |
| 2026-09-03 | G1.15 | `pnpm gate:templates` | 0 | 151 templates |
| 2026-09-03 | G1.17 | `pnpm gate:secrets` | 0 | tracked tree and post-baseline commits |
| 2026-09-03 | G1.9 | `pnpm gate:names` | 0 (CI) / 1 (local: `NAME_DENYLIST_FILE` unset) | CI run 33728103297 |
| 2026-09-03 | G1.10 (corpus) | `pnpm gate:readability` | 0 | 1,489 blocks; `a4e58b9` |
