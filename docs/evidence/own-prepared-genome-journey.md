# Prepared own-genome browser journey

This is an authored CI fixture. Its browser, database and Storage journey has **not run yet**. Local validation covers the launcher/configuration unit tests, strict TypeScript, lint and test discovery only. Those checks are not evidence that a participant completed this journey or that a hosted file size works.

The new `prepared-source` Playwright project runs in the standard isolated Linux GitHub-hosted CI job, on port 3104 from the existing single production build. Discovery lists it without starting an app. Ordinary local execution retains the existing four app variants. Actual CI refuses a missing or malformed runtime preflight instead of omitting this project; retries remain zero and the existing fresh-report no-skip gate applies.

## Real boundary under test

The fixture composes the committed merged regional ancestry VCF and the one existing caffeine position into a 169-record, 7,937-byte synthetic VCF. It uploads those bytes through the real browser consent/picker/Storage/finalization path. No source, grant, analysis result, job, manifest or observed call is seeded. The application must return a queued 202 receipt before the real production worker publishes a prepared object source and the application's normal polling returns 200.

The test then requires one published job and manifest with acknowledged members, zero database normalization runs, zero observed-call rows, and no analysis run before the person chooses reports. It uses the real report-choice signatures to generate the caffeine report and ancestry, compares displayed results with Copilot's captured tool output, and reads the raw caffeine genotype through `get_genotype`. The existing isolated HTTPS inference fixture provides deterministic tool choices and prose. It supplies neither genotypes nor report/ancestry results.

The authored assertions also cover six saved conversation messages without inference on history reload; actual ancestry withdrawal, refusal of the old context/history and removal of its stored pairs; continued raw-source use in a new conversation; then selected-file deletion through the native browser polling, a 204 completion receipt, retired prepared metadata and unavailable original download. These remain pending actual CI execution, including the prepared Copilot dispatcher integration.

## Isolation and bounded setup

The setup admits only the already qualified disposable CI identity, the exact running `sequence` database and Storage containers, and the current runtime's unpredictable ownership label and read-only checkout mount. It verifies those identities before every SQL operation. It captures the complete existing preparation configuration while disabled, refuses any pre-existing preparation job or cleanup, and temporarily changes only `enabled`. A `finally` block restores that field and compares the whole captured row, including after an uncertain activation response. Concurrent configuration drift is an explicit failure; limits are never changed or silently overwritten.

Before launch, the queue must contain exactly the new fixture file, queued with no prior attempt. The worker command is fixed to the existing cleanup-first `--once` entry. It receives only the exact loopback Supabase origin, the ephemeral service credential and the preparation flag over stdin. The child is unprivileged, has no effective capabilities and runs inside the existing egress-isolated namespace. No caller-controlled command, path, provider or extra environment field is admitted.

The inside launcher bounds stdin acquisition to five seconds, worker execution to 90 seconds, then uses TERM and a five-second KILL escalation. The host also has a finite 110-second bound. Unknown/failed exit, unexpected output, output overflow and timeout all fail; a second worker attempt is refused even after a lost response. Only the exact cleanup-idle plus preparation-complete result and successful process close produce the fixed completion token. No credentials, provider diagnostics or worker source identifiers are printed.

## Limits of this evidence

- The fixture is a small synthetic VCF, not a large-file throughput or capacity measurement. Configured ceilings are unchanged and are not tested sizes.
- There is no hosted execution, deployment, paid inference, local app/DB/Docker run or production mutation in authoring this patch.
- Timed original retirement remains unproven here. The one-month expiry is not backdated and no trigger, clock, authorization or cleanup fence is bypassed. Selected-file deletion is a separate owner action, not evidence of expiry-driven retirement or physical-media erasure.
- The unit tests inject command/process adapters. Their passing results validate refusal, command shape, restoration and bounded failure behavior; they do not replace the actual CI browser/DB/Storage run.

## Local authoring validation

On 23 September 2026, the six targeted CI/configuration/launcher suites passed 56 tests. Changed-file strict TypeScript and lint passed. Readability passed with 2,713 blocks. Browser discovery listed 527 tests in 80 files, including this project, without starting a server. The staged secret gate passed (1,873 tracked files, 712 authored commits, 171 allowlisted detections and 27 genome fixtures). Actual CI execution remains pending.

## Test-diff record

Added one browser journey and launcher boundary tests. Existing browser tests and runtime/namespace/Storage guards remain; the fixed app/proxy allowlists gain only port 3104. Existing four-port assertions are preserved with the fifth port added. The new journey's 300-second test budget includes one at-most-96-second worker attempt and subsequent browser actions; no existing test timeout changes. No skip, retry, deletion, assertion relaxation, limit increase, fixture-only application authority or release-row change is introduced.
