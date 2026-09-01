# Test diff register

Baseline: `864736979c92a08ba77e8580d61946eba6864918` (`8647369`).

This register covers test and test-runner changes after the baseline. A change
is listed only when it strengthens or extends an assertion; weakened, deleted,
skipped, quarantined, or retry-dependent tests are not permitted.

| Path | Kind | Reason | Strengthened or replacement assertion |
| --- | --- | --- | --- |
| `playwright.config.ts` | Runner strengthened | G1.5 requires zero retries in every environment and machine-readable proof of zero skipped results. | `retries` is unconditionally `0`; the JSON reporter writes `test-results/results.json`; `scripts/run-e2e.ts` makes `pnpm e2e` fail when any result is skipped or has `retry > 0`. |
| `e2e/adult-subject-invitation.spec.ts` | New E2E coverage | Covers the TEST-LOCAL adult-subject invitation Path A reservation and acceptance boundary. | Follows the captured email link, proves the raw token is absent from durable mail payloads, binds the subject to the matching recipient account, and proves the inviter has zero directional grants and the subject has zero files. |
| `scripts/secret-gate.test.ts` | New unit coverage | Pins the G1.17 credential detector against future provider formats and false-positive regressions. | Detects provider tokens, JWTs, private-key headers, credential-bearing URLs, and generic secret assignments while rejecting documented placeholders and environment lookups. |

No pre-existing E2E test has been modified, weakened, deleted, skipped, or
quarantined in this change set. Existing design-token assertions are unchanged.
