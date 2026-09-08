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

### Reviewed rejection inputs and deterministic expression (2026-09-07)

- Secret-Allowlist-ID: browser-origin-credential-refusal
- Secret-Allowlist-ID: storage-proxy-credential-refusal
- Secret-Allowlist-ID: model-endpoint-credential-refusal
- Secret-Allowlist-ID: ready-origin-credential-refusal
- Secret-Allowlist-ID: chat-token-deterministic-expression

The first four entries are exact dummy user/password URL inputs to unit tests
that require rejection before any connection or envelope creation. Their
destinations are the reviewed loopback, synthetic model and application-origin
validation cases; the application-origin case does not authorize a request to
that public host. These are not working credentials or permission to commit
credentials for those hosts. The fifth entry is the assignment scanner's
fragment of a deterministic repeated-byte test-key expression, not a key literal.

Each new entry binds the exact detector value, one exact source path, and a
SHA-256 of the entire reviewed source line. The scanner separately pins the
digest of that binding. A JSON or ADR edit alone cannot approve another value,
path, expression or source context. Filtering checks the actual source line
for each current-tree or historical finding, so a correct current declaration
cannot hide a different earlier assignment. The expression fragment is exempt
from literal-occurrence scanning in prose only; contextual assignment detection
remains active everywhere. URL literals remain subject to exact-path scanning.

Adversarial tests preserve detector findings and reject changed credentials,
undeclared test paths, edited binding metadata, altered source lines and changed
historical contexts even when today's source is restored. No whole-file or
test-directory exemption, provider-token detector change, or history-baseline
change is permitted by this decision.

## Consequences

`pnpm gate:secrets` blocks production environment files, known provider-token
formats, credential-bearing URLs, contextual secret assignments, undeclared
fixture-value paths, undocumented genome fixtures, and future secret-like
additions anywhere in the v2-authored commit range. The previously documented
hosted Supabase publishable key is removed from the current tree; it predates
the pinned v2 baseline and remains visible only in immutable earlier history.
