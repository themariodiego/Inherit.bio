# ADR 0006: Local credential fixtures and secret scanning

- Status: Accepted
- Date: 2026-09-01

## Decision

CI and browser tests may commit only the exact deterministic values recorded in
`scripts/secret-allowlist.json`. The secret gate validates their local-only
shape, verifies every declared occurrence, rejects an occurrence on any other
path, scans the current tracked tree, and scans lines added by every non-merge
commit after the pinned v2 baseline.

The allowlist itself is not a way to approve live credentials. It rejects
hosted Supabase key formats and permits Supabase JWTs only when their decoded
issuer is `supabase-demo`. Adding a fixture requires an accepted ADR containing
its exact `Secret-Allowlist-ID` marker; changing only the JSON is insufficient.

The following initial local fixtures are accepted:

- Secret-Allowlist-ID: historical-local-supabase-anon-jwt
- Secret-Allowlist-ID: local-supabase-anon-jwt
- Secret-Allowlist-ID: local-supabase-service-role-jwt
- Secret-Allowlist-ID: e2e-byok-key
- Secret-Allowlist-ID: jobs-auth-fixture
- Secret-Allowlist-ID: cron-auth-fixture
- Secret-Allowlist-ID: e2e-resend-key
- Secret-Allowlist-ID: density-anon-fixture
- Secret-Allowlist-ID: density-service-role-fixture

### Reviewed non-secret source reference (2026-09-06)

- Secret-Allowlist-ID: co-parent-local-fixture-reference

The assignment scanner also reports the JavaScript identifier `testKey` in
`e2e/co-parent-invitation.spec.ts`, including commit `235a1aa`. It is not a
credential: its declaration reads the local fixture from `playwright.config.ts`.
The narrow code-reference entry requires this exact identifier, path and
declaration to remain present. It does not permit a new key literal, a changed
source expression, a second assignment path or any hosted credential.
Identifier mentions in prose are not treated as credential literals.
Credential detectors and the history baseline remain unchanged.

## Consequences

`pnpm gate:secrets` blocks production environment files, known provider-token
formats, credential-bearing URLs, contextual secret assignments, undeclared
fixture-value paths, undocumented genome fixtures, and future secret-like
additions anywhere in the v2-authored commit range. The previously documented
hosted Supabase publishable key is removed from the current tree; it predates
the pinned v2 baseline and remains visible only in immutable earlier history.
