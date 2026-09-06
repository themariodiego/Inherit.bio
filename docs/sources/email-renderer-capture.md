# Production email capture

This is an email-channel adapter for the rendered-claim audit, not a completed
claims gate. It never sends mail, reads recipients, or calls a hosted service.

## Capture contract

`captureEmailClaims` in `src/lib/claims/capture-emails.ts` accepts a new output
directory and the existing corpus registry, seed and computed-module resolvers.
The caller must supply real resolvers; unresolved data is not silently approved.
The implementation reads the checkout commit, refuses changed production render
inputs, and checks the commit and inputs again before publishing its receipt.
Run against a locked dependency installation and a frozen checkout. This local
check does not attest the build environment or defend against concurrent edits
that are changed and restored between checks.

Discovery reads every runtime named export under `src/emails`, independently of
the fixture list. Only the shared `base.tsx` layout and test files are excluded.
The current inventory is 12 exports in 11 entry files, including both account
deletion templates. New exports fail until explicitly classified and exercised.

The 27 fixtures exercise current conditional branches with synthetic labels,
dates and links. No account or secret is needed. The nonempty full research
digest uses all 162 public seed titles and summaries; the single-entry fixture
uses the first slug in sorted order. Branch coverage is code-reviewed policy,
not an automatic proof that future conditions have fixture coverage.

Each fixture passes through the actual `renderMail` and `mailSubject` production
functions. Capture retains the exact unmodified UTF-8 HTML, plain-text subject,
explicit fixture JSON, and collected observation JSON. Each artifact has a
SHA-256 receipt and is read back before use. Existing output directories and
artifacts cannot be overwritten. `capture.json` binds the commit, independent
requirements, observations, artifact receipts and full audit result.

Local Chromium parses those retained HTML bytes with JavaScript and network
access disabled. The same DOM collector used by the corpus tests reads the
entire body. Its exact checked-in function is compiled with TypeScript for the
browser realm and retained as a hashed `collector.js` artifact. This avoids
host-runner function-name helpers leaking into Playwright serialization; both
Vitest and standalone `tsx` capture paths are tested for observation parity.
Subject bytes are separately observed as plain text, never as HTML.
Any attempted resource request fails capture. This captures renderer output,
not a delivered-mail provider transformation or mail-client screenshot.

## Scope and honest failures

Every fixture requires an explicit `email-body` region. Nonempty digest fixtures
also require `research-digest-entries`; the empty digest does not. Capture does
not inject these regions or claim/source markers into the HTML. Footer, button
and navigation prose stays in observations, and the existing numeric-claim
checks apply everywhere. Ordinary nonnumeric content outside required regions
is not automatically a sourced claim. Future annotation integration must put
every relevant assertion inside the declared regions; capture alone cannot
certify that semantic classification.

Surface IDs are exact fixture identities, for example
`email:src/emails/research-digest.tsx#fixture=research-digest--public-catalog`.
The subject appends `#envelope=subject`. Canonical claims must declare exact
observed surfaces; a base-path wildcard is not accepted. The digest currently
renders summaries, not study-context paragraphs.

All 54 observations are fed to the existing full four-channel audit. This
email-only adapter therefore reports missing static-build, seeded-authenticated
and export channels. Current production emails lack the required regions and
canonical claim wrappers, so those are real failures too. Tests use deliberately
unresolved registry lookups and assert failure; they create no fake production
claims. Actual registry population, mail annotations, the other three renderer
adapters, independent source review and full scope reconciliation remain needed
before G1.11/G4.7 can pass.

## Verification

`vitest run src/lib/claims/capture-emails.test.ts` exercises real production
rendering in Chromium, export discovery, missing/new entrypoints, explicit
digest scope, retained-byte parity, subject capture, network isolation and
immutable receipts. Test artifacts remain in an explicitly created temporary
directory; they contain synthetic inputs and public catalog prose only.
