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
| 2026-09-03 | G1.1–G1.5, G1.8 (static), G1.9, G1.10 (corpus), G1.15, G1.17 | GitHub Actions `checks` on `ce63b75` | 0 | CI run 33729602251, job 100566285867 (typecheck, lint, build, unit, legal, names, templates, readability, secrets, local Supabase seed, full browser suite) |
| 2026-09-03 | G1.2–G1.4, G1.8 (static), G1.10 (corpus), G1.15, G1.17 | `pnpm typecheck && pnpm lint && pnpm test && pnpm gate:templates && pnpm gate:legal && pnpm gate:readability && pnpm gate:secrets` | 0 | tree with W1 (figure contract) and W2 (taxonomy migration): 233 unit tests in 26 files; readability 1,491 blocks |
| 2026-09-03 | G1.1–G1.5, G1.8 (static), G1.9, G1.10 (corpus), G1.15, G1.17 | GitHub Actions `checks` on `d682684` and `12274ef` (taxonomy migration applied to the local stack, seed, full browser suite) | 0 | CI runs for head SHAs d682684 and 12274ef on pull request #41 (run 33731658476 for 12274ef) |
| 2026-09-03 | header profile E2E (`e2e/response-headers.spec.ts`) | GitHub Actions `checks` on `a33a819` | 0 | CI run for head SHA a33a819 on pull request #41 |
| 2026-09-03 | G1.2–G1.4, G1.8 (static), G1.10, G1.15, G1.17 | `pnpm typecheck && pnpm lint && pnpm test && pnpm gate:readability && pnpm gate:legal && pnpm gate:templates && pnpm gate:secrets` | 0 | tree at `31e1d7c` (report skeleton, Overview, extended readability extractor); 290 unit tests; readability 1,621 blocks (956 long, 434 short-role, 266 sentence-capped, 152 copy-registry) |
| 2026-09-03 | G1.10 (extended extractor, first run) | `pnpm gate:readability` | 1 | 34 findings on the working tree before remediation (32 surfaced by the `src/copy`/`src/emails` extension, 2 from the new `/science` heading); closed in `47bc818`, `7810ea6`, `31e1d7c`; see D-004 |
| 2026-09-03 | G1.10 (isolated pre-push check) | `pnpm gate:readability` in a detached worktree at `7810ea6` | 1 → 0 | one finding (`What we won't do.` read as `wont` after the token was removed early); fixed by `4a3e0c6`, superseded by `31e1d7c`; see D-005 |
