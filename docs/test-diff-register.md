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
| `scripts/name-gate.test.ts` | New unit coverage | Pins G1.9/G6 normalization, carve-out precedence, and evaluative-distance behavior. | Detects lowercase-domain, camelCase, kebab-case, snake_case and compact forms; proves the provider carve-out is path-limited and absent for commit messages; checks the exact 200-character proximity boundary. |
| `scripts/readability.test.ts` | New unit coverage | Pins the G1.10 scorer before corpus remediation begins. | Proves opaque-token normalization, deterministic sentence/word/syllable counts, contraction handling, and all ten versioned calibration grades within the 0.2 tolerance. |
| `scripts/readability-gate.test.ts` | New unit coverage | Prevents the static G1.10 extractor from inventing composite copy blocks or regressing remediated provider, lifestyle-template, brain-health-template, gastrointestinal-template, or longevity-template copy. | Proves nested copy containers are scored separately, inline markup stays inside its visible block, `alt`/`title` strings remain independently covered, and every displayed provider field plus all four remediated template categories remains free of readability findings. |
| `e2e/copilot.spec.ts` | Updated copy assertion | Keeps the existing cloud-provider consent flow aligned with the remediated plain-language endpoint state. | The flow, actions, provider naming, data classes, tool call, citations, and revocation assertions are unchanged; only the expected state sentence changes. |
| `e2e/upload-vcf.spec.ts` | Updated copy assertion | Keeps the existing local-only genome-browser provenance check aligned with the remediated sentence. | Upload, processing, locus rendering, rsID search, genotype, and external-network assertions are unchanged; only the expected provenance sentence changes. |

No pre-existing E2E test has been weakened, deleted, skipped, or quarantined in
this change set. Existing design-token assertions are unchanged.
