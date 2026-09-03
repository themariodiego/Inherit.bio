# Approach-family registry

Append-only. Each entry names the surface, the approach family (its core
mechanism, not its styling), its status, and the evidence that kept or killed
it. A route is eliminated only by evidence recorded in `decisions.md`.

| Date | Surface | Family | Status | Evidence |
| --- | --- | --- | --- | --- |
| 2026-09-03 | Figure contract | One `ClaimBlock` container receives an array of figure specs and renders every quantity through `Figure` / `RelativeFigure`; attribution lives on the container only | active | Chosen because server components cannot introspect children; unit tests assert the once-per-block modelled marker and the single attributed ancestor. |
| 2026-09-03 | Evidence vocabulary migration | New enum type plus column swap in one transaction, old levels captured before the swap, 119 changelog rows after it | active | `ALTER TYPE … ADD VALUE` cannot be used in the same transaction; Postgres has no `DROP VALUE`; see `docs/protocol/decisions.md`. |
| 2026-09-03 | Evidence vocabulary migration | `text` column plus CHECK constraint | rejected | Loses the generated literal union the code relies on; the brief keeps calling the type `public.evidence_level`. |
| 2026-09-03 | Readability copy-registry extraction | TypeScript AST walk of `src/copy/**/*.ts` and `src/emails/`: every top-level constant, object, array, tuple and function body; `${…}` slots scored as the placeholder word; role inferred from the nearest key or export name | active | Covers copy that never appears as a JSX literal; each block points at the literal's own line; eight fixture-repo tests pin the rules. |
| 2026-09-03 | Readability copy-registry extraction | Render every route and harvest the DOM text | rejected | Needs the app and a database in the gate, misses states that are not rendered on the run, and cannot attribute a finding to a source line. |
| 2026-09-03 | Contractions in the vocabulary check | Expand `n’t`, `’re`, `’ve`, `’ll`, `’d`, `I’m`, `let’s` to their full words before matching; other apostrophes dropped | active | The mandated label `I don’t have one yet` is checked as `do not`; registering `dont` was rejected because the register would then contain a non-word. |
