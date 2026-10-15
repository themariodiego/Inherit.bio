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

## 2026-10-10 — Actual complete TEST service admission

`src/lib/exports/account-archive-test-admission.ts` is the separate read-only
admission used by the controlled complete-account browser probe. It checks the
actual native and private gateway configuration on both sides of the native
empty-obligation census. It accepts no source rows, provider response, target,
origin, grant, clock or reset command from a fixture. Register this exact file
in the same token inventory because its name and comments describe that
admission. Keep the complete scan and every other entry unchanged.

The new job endpoint accepts no fixture body. Its authenticated empty POST
selects only generation or disposal of the real native due page. Production
generation remains unapproved, and actual TEST service/browser/provider and
later physical-disposal qualification remain required.
