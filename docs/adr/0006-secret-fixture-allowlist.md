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

### Reviewed prepared-storage rejection input (2026-09-08)

- Secret-Allowlist-ID: prepared-storage-credential-refusal

This exact dummy credential URL appears only in the prepared Storage transport's
configuration-rejection test. It is rejected while constructing the transport,
before any request is possible. The single source path, complete source line and
binding digest are pinned by the existing reviewed-negative-url mechanism. This
adds no detector, path-wide exemption, live credential or historical baseline change.

## Consequences

`pnpm gate:secrets` blocks production environment files, known provider-token
formats, credential-bearing URLs, contextual secret assignments, undeclared
fixture-value paths, undocumented genome fixtures, and future secret-like
additions anywhere in the v2-authored commit range. The previously documented
hosted Supabase publishable key is removed from the current tree; it predates
the pinned v2 baseline and remains visible only in immutable earlier history.

### Existing local fixtures in the manual participant-c smoke (2026-10-01)

The six already accepted local Supabase JWT, disposable encryption, job, cron
and synthetic mail fixtures are reused byte-for-byte in the exact additional
path `.github/workflows/participant-c-smoke.yml`. This manual instrument job
uses only a newly created loopback Supabase stack and an isolated TEST-LOCAL
app. It has no paid credential. The existing issuer/role/key-shape checks,
fixture values, scanner rules, exact-path occurrence checks and history baseline
remain intact. This adds no hosted key, new credential value or global path
exemption. The newly required GitHub OIDC request bearer stays in host memory;
its signed identity is checked, and it is omitted from every child environment.

### Existing local mail fixture in the owned Linux operator (2026-10-10)

The existing `e2e-resend-key` value is also permitted in the exact path
`scripts/comprehension/run-owned-linux.mts`. It configures only the disposable
loopback mail server at `http://127.0.0.1:8124`. Generated local app secrets remain
ephemeral; the operator's model credential never enters this configuration.
The fixture value, classification, detectors and historical baseline are unchanged.

### Existing local job fixture in the native mail control (2026-10-10)

The accepted `jobs-auth-fixture` value is also permitted in the exact path
`scripts/comprehension/native-mail-drain.test.ts`. Its two occurrences check the
unchanged hosted credential against a pure mocked mail endpoint. The native
success case separately uses the selected app's different current credential;
the fixed hosted value must still fail against that configuration. This test
opens no server, database, provider or child process. The fixture value and
classification, every detector, undeclared-path rejection, full current-tree
and history scans, and historical baseline remain unchanged.

### Exact isolated webhook source-expression review packet (2026-10-01)

- Secret-Allowlist-ID: isolated-webhook-generated-reference
- Secret-Allowlist-ID: isolated-webhook-malformed-reference
- Secret-Allowlist-ID: isolated-webhook-cross-variant-reference

These three review candidates bind distinct code identifiers in three exact
unit-test source lines. Two aliases refer to the same freshly generated per-run
software webhook key; the third is a loop variable containing only rejected
malformed inputs. No key literal is stored. Complete source-line and binding
hashes use the existing independently pinned expression mechanism. The scanner,
unique-value invariant, first-entry selection, exact-path/current/historical
context checks and history baseline remain unchanged. Literal replacement,
changed metadata/context, another path and changed historical source refuse.

Canonical assembly starts from C4 ordinarily merged with the qualified 035/853
prerequisite before the native patch is committed with these unique aliases.
The earlier frozen 7c/15f snapshots and failed scanner/type receipts remain
preserved; no shared history is rewritten. Key equality is tested as a boolean,
with the other complete environment fields still compared exactly, so a failed
unit assertion cannot dump the generated verifier. This packet awaits root's
concrete binding review before its mechanical scanner result is release proof.

### Exact historical owned-target unit marker (2026-10-02)

- Secret-Allowlist-ID: historical-owned-target-unit-marker

The fixed `unit-marker` string supplies two truthy environment properties only
in the pure owned-target unit test. It is never passed to an SDK, encryption
operation, subprocess or provider. The exact existing source line is equal in
the frozen historical-native source and current tree; its offset changed after
strict negative parser coverage was added. The complete line/path/value and
independent binding digest use the existing reviewed-source mechanism. A copied
assignment, replacement literal, changed line/context/metadata or other path
remains refused, including historical changes when current source is restored.
The detector, unique-value invariant and history baseline remain unchanged.

### Exact T6 ambient-verifier rejection marker (2026-10-09)

- Secret-Allowlist-ID: fresh-t6-ambient-verifier-refusal

The fixed `untrusted-ambient-verifier` marker is passed only to the pure T6
configuration test as two ambient inputs that must be discarded. No provider,
SDK, cryptographic operation or child process uses this marker. One unique
value and one test path bind exactly two complete source-line hashes, with the
whole binding independently pinned in the scanner. Every existing singleton
binding remains byte-exact. Current and historical findings must match one of
those two lines; a changed value, path, line, metadata or extra line refuses.
Detectors, the unique-value rule and the complete history baseline remain intact.
