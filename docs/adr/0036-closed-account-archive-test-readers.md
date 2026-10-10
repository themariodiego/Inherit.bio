# 0036 — Closed account archive TEST readers

Status: implementation decision for the default-off draft.

`src/lib/exports/account-archive-test-flow.ts` accepts an optional trusted
synthetic reader so authored tests can exercise the actual ZIP, R2 and download
composition. The function requires TEST jurisdiction and the dedicated account
R2 opt-in before any reader or native operation; ordinary production generation
remains null. Omitted readers use the existing service readers.

Register only this exact file in the mock-token inventory. Keep the complete
production scan, stale-entry refusal and all other entries unchanged. Authored
reader tests do not prove native/provider deployment, delivery or purge.
