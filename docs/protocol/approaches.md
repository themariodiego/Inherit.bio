# Approach-family registry

Append-only. Each entry names the surface, the approach family (its core
mechanism, not its styling), its status, and the evidence that kept or killed
it. A route is eliminated only by evidence recorded in `decisions.md`.

| Date | Surface | Family | Status | Evidence |
| --- | --- | --- | --- | --- |
| 2026-09-03 | Figure contract | One `ClaimBlock` container receives an array of figure specs and renders every quantity through `Figure` / `RelativeFigure`; attribution lives on the container only | active | Chosen because server components cannot introspect children; unit tests assert the once-per-block modelled marker and the single attributed ancestor. |
| 2026-09-03 | Evidence vocabulary migration | New enum type plus column swap in one transaction, old levels captured before the swap, 119 changelog rows after it | active | `ALTER TYPE … ADD VALUE` cannot be used in the same transaction; Postgres has no `DROP VALUE`; see `docs/protocol/decisions.md`. |
| 2026-09-03 | Evidence vocabulary migration | `text` column plus CHECK constraint | rejected | Loses the generated literal union the code relies on; the brief keeps calling the type `public.evidence_level`. |
