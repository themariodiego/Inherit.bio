# Resumption baseline — 25 September 2026

The 25 September handoff paused the project at 41 YES and 24 NO and asked the
next session to reconcile its snapshot with the actual state before new
engineering. This record is that reconciliation. It changes no acceptance row.

## Host

A fresh clone in an ephemeral cloud container, not the workstation the
handoff describes. Node 22.22.2 (the handoff's workstation used 22.17.0),
pnpm 10.33.0, `pnpm install --frozen-lockfile`. None of the handoff's local
worktrees or `/tmp` evidence directories exist here. The clone is shallow,
grafted at `b6e6af6`; every commit a comparison below names was present.

All production reads were read-only SQL through the hosting connector, on
reference tables and the migration ledger only. No user table was read.

## Ledger

| Requirement | Method | Result | Limitation | Next dependency |
| --- | --- | --- | --- | --- |
| `main` unchanged since the handoff | `git fetch`; `git rev-parse` | `57d6b4efd3247d91f2c144ad90d27ce3ca15d445`, tree `a1935615293ba730d4407463277a4a5cdc12390f`: identical | — | — |
| Open pull requests unchanged | GitHub API, open pull requests | The same 18 drafts and heads as the handoff's inventory | Nothing merged, closed or retargeted | Owner decisions on the stale-but-included drafts |
| No newer CI | GitHub Actions runs | Latest are the two successful `main` runs `35872383338` and `35872991042` | Raw logs not re-audited | — |
| Matrix count | Recounted the 65 G rows in `docs/acceptance-matrix.md` | 41 YES, 24 NO; row-for-row identical to the handoff extract | — | — |
| Unpublished export work reachable | `git ls-remote` | **Not on the remote.** `codex/async-export-delivery` (`da576e5`) and its two untracked ZIP64 files exist only on the owner's workstation | G5.6 cannot continue from any other host | The owner pushes that branch and the two files |
| Production deployment | Hosting API, production deployments | `dpl_BimWfPBZby76ZcWB1umiLq1FHjd4`, READY, `57d6b4e`; nothing newer | Aliases not re-read | — |
| Production migration ledger | Ledger names against `supabase/migrations`, by name as `gate:schema-drift` compares | 126 applied, 125 files. Missing: only the two embryo public doors withheld on purpose (D-132). Extra: the recorded operator scheduler and the two 23 September guarded-release rows | `gate:schema-drift` itself needs a database URL this host does not hold; its committed logic was run over the names instead | See below |
| The two guarded-release rows | Their single statements re-read and hashed | SHA-256 `6389fc14…575c` and `216fb328…ad3c`, equal to the release record. All six repository migrations appear verbatim inside them with their original ledger rows; the only other schema text is expected-state JSON in the guards | — | Now recorded in `data/gates/operator-applied-migrations.json`, so `gate:schema-drift` reports only the real gap |
| Deployed report catalog matches the corrected repository | Two independent comparisons of all 162 published `report_templates` rows; [catalog-parity.json](catalog-parity.json) | **154 identical, 8 not.** The eight are the eight batches of `data/report-scientific-corrections.json`; each equals its registered `previousCommit` in title, summary, variants and citations; all 36 registered pre-correction fields are live | Measured before the refresh, not in this row | D-134. Refreshed later the same day with the owner's approval; see `docs/evidence/production-catalog-refresh-20260925/` |

## What the catalog finding means

Deploying code never refreshes `public.report_templates`, and CI seeds it from
`data/templates` on every run, so nothing compared the deployed catalog with
the repository. Production therefore serves the corrected application over
the uncorrected text for ADORA2A, APC I1307K, FGFR2, ALDH2, TREM2 R47H, APOE,
TCF7L2 and Factor V Leiden, and the application recognises that exact text as
superseded: those report pages show the historical-wording notice above it,
each new report captures it permanently, and Copilot refuses such a context.
The full reading is D-134 in `docs/protocol/defects.md`.

`pnpm gate:catalog-drift` now detects this, and running its committed
comparison over the 162 production rows reported these eight and nothing else.
The owner then approved a guarded refresh, applied the same day; the same
comparison now reports nothing. Completed reports stay as they were captured.

## Not done here

No deployment, merge or paid activity. The one production write, the
catalog refresh, is recorded separately with its own authorization. No hosted journey,
billing read or credential probe. The handoff's `/tmp` receipts and local
worktrees could not be consulted from this host.
