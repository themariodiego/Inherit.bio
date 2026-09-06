# Local canonical upload browser boundary checks

2026-09-06. **Partial verification, not a completed upload-to-results journey.**
Full-plan acceptance stays 18/65. No hosted change or real user file was used.

## Latest verified checkpoint

At source `294d8a0`, the production-browser runner exits zero: **2/2 cases
pass, no skips or retries**, including one actual browser upload through the
installed provider. The complete own-account sequence reaches prepared UI;
the stored file downloaded through the original, unproxied provider equals
the original fixture byte for byte. Exact source revision and normalized rows
are verified, with zero unchosen purposes, analytic results, worker jobs or
report-ready notices. The prepared screenshot was visually inspected.

The real HTTP adapter exposes a zero-byte POST as a non-null empty stream.
Finalization and normalization now check bounded EOF rather than testing only
`request.body === null`; any content or a stalled body is refused. The same
helper protects the bodyless retention route. Four helper tests and the 58
finalizer/normalizer regressions pass. Chromium did not expose the File-backed
XHR body to its debugging protocol, so byte equality is verified through the
actual stored-object download rather than an absent instrumentation field.

The clean source checkout passes **2,521 tests in 155 files** with
`corepack pnpm test --maxWorkers=2`; the secret gate passes over 1,022 tracked
files and 255 authored commits. Initial full runs found an old mock missing
the database's nullable structural-evidence field (corrected to explicit NULL)
and a five-second GIAB test timeout while two suites and a browser build ran
concurrently. With suites serialized and two workers, unchanged parser
assertions and timeout pass. No fixture was purged or assertion weakened.

This proves upload through preparation, **not selected report generation**.
The report-choice backend is separate; UI mounting, exact-purpose generation,
live output authorization and withdrawal cleanup remain before release.

## Infrastructure and scope

Run `node --import tsx scripts/run-upload-browser.mts` from the repository root.
It requires the existing local Docker stack and existing capacity policy.
It does not provision configuration, apply migrations, reset data or rotate
Auth signing keys. It refuses hosted/CI execution and existing web servers.

The runner starts another instance of the installed Storage HTTP application
inside the local Storage container. Only that instance trusts the run's
ephemeral public ES256 key. The private signing key exists in process memory
and the Next server's environment, never a key file or browser configuration.
The browser uses a loopback HTTP proxy; the Supabase URL and database issuer
remain `http://127.0.0.1:54321` and its `/auth/v1` issuer.

Browser Storage requests reach the actual provider with their original
restricted Authorization header. Other local traffic is forwarded unchanged;
external tunnels are refused. The app's server-side Storage calls still use
the normal local gateway, sharing the identical database and file backend.
There is no `route.fulfill`, substituted Storage decision or seeded file row.
The original HTTP provider harness remains separate and unchanged.

CORS is served by the normal local gateway, not the internal Storage app.
The proxy forwards OPTIONS to that gateway and relays its actual current
CORS policy onto the provider response. It does not alter the provider status
or body. Before a production build, the runner verifies a real preflight and
an actual refused, unauthenticated POST through this boundary. A successful
suite must also have at least one successful upload observed by the proxy.

The dedicated Playwright configuration disables network traces to avoid
persisting the one-use bearer. The runner closes its provider, proxy and
browser processes in `finally`. Synthetic records remain like other local
browser fixtures; no broad cleanup or deletion of existing data is performed.

## Findings and corrections

| Boundary | Evidence | Outcome |
| --- | --- | --- |
| Account completion → insurance → own-upload presentation | First run: account completion 200 and insurance signature 201, then unavailable UI. Database logged `issue_own_upload_nonce_v1` validation error before creating the third nonce. Context, artifacts and existing signature matched. | Fixed the host/database expiry race, below. |
| Browser cross-origin preflight | Second run: valid lease issued, but no Storage POST response. Direct installed provider OPTIONS returned 404 without CORS; unchanged local gateway returned 200 with its CORS headers. | Fixed test proxy gateway handling; third run passed the preflight/denied-POST checks and reached actual Storage. |
| Restricted browser upload → canonical finalization | Third run: synthetic session reached `uploaded`; no final object was claimed and no file was finalized. The browser's canonical `/finalize` response was 422. | Still failing. A valid issued UUID and query-free, body-omitted browser POST reaches the endpoint, whose pre-claim guard rejects any non-null `request.body`. Next can represent a zero-byte POST as an empty stream. Integration must verify bounded zero-byte EOF rather than infer body presence solely from that property. |
| Empty report-library filter → recovery | Passed in all three runs; final recorded case took 1.9 seconds. Keyboard activation clears the results-only filter, restores search focus and shows the unchanged uncovered library. | Verified locally. Not a whole G gate. |

### Consent expiry race

The app minted a token expiring exactly ten minutes after its host clock;
SQL correctly rejected expiries beyond ten minutes on the database clock.
Persistent read-only clock samples put the database 2–4 milliseconds behind
the host with 1–2 millisecond round trips. A slower unskewed rollback probe
accepted both durations. With a controlled 100 millisecond host-clock lead,
the same synthetic snapshot returned SQLSTATE 22023 for ten minutes and
accepted nine minutes. Both probes rolled back; no nonce was retained.

Own consent and account-completion token lifetimes are now nine minutes;
their readers enforce that exact duration. The database ceiling remains ten
minutes. Sixty focused consent/account tests passed, including exact expiry
and clock-headroom assertions. The parent independently applied the same
headroom to report-choice presentations.

## Initial infrastructure handoff (superseded by the checkpoint above)

- `e2e/own-upload-positive.spec.ts` requires actual consent screens, picker,
  exact restricted Storage bytes, finalization, source-bound normalization,
  matching download through the original Storage endpoint, no unchosen
  analytic outputs or report-ready notice, and accurate prepared UI.
- `e2e/report-library-recovery.spec.ts` supplies the no-file recovery case.
  Its separate covered-results/Back test is not selected by this runner;
  report readiness remains an independent precondition.
- `e2e/helpers.ts` no longer sends the legacy upload declaration or ordinary
  login token to Storage. It uses current real consent screens and the picker.
  Existing report-dependent callers deliberately fail if only normalization
  completed: explicit purposes and actual report generation must be connected,
  never manufactured by setting `annotated` in a fixture.
- Scoped infrastructure lint, app typecheck and standalone MTS typecheck
  passed. The final production-browser run had **one pass and one failure**,
  no retries: the recorded finalization 422 is unresolved here. A production
  build succeeded, but this is not a passing browser-suite claim.
- Teardown was checked after the final run: ports 3100/3101 were not listening
  and no isolated browser-provider process remained in the Storage container.
  The runner exited after closing its in-process proxy.

Next: fix and test the zero-byte finalization boundary, then rerun the same
positive assertions. Only afterward claim normalization/UI completion or
expand into chosen report generation. Real-jurisdiction launch, hosted signer
configuration, scheduled retention and all four upload paths remain outside
this local receipt.
