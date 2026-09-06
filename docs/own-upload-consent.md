# Own-account upload journey — implementation checkpoint

Status: in progress on `codex/complete-upload-journeys`; not released and
not an accepted G2.6/G5.2 journey. Existing production upload behavior is
unchanged. This implements the first missing signing boundary identified
in the whole-plan upload audit, not a replacement for the four-path goal.

## Implemented boundary

`POST /api/consents` now dispatches the exact closed `tier1-self` body to
`src/lib/uploads/own-consent-route.ts`. A versioned own-DNA artifact supplies
the one checkbox. The insurance disclosure is separately signed first.
The HMAC presentation is account/session/subject/version/hash bound and
expires after ten minutes. It is also carried in the same-origin CSRF
header. No name, typed date or criminal-liability warning is part of this
Tier-1 signature. Body overrides, extra statements, token retargeting and
open database responses are refused rather than silently discarded.

The service-only invoker RPC calls its unexposed fixed-search-path private
implementation. It verifies the live auth user and originating session,
current account/auth/jurisdiction/binding revisions, exact own-subject
principal, stored adult date and immutable presented document hash before
consuming the nonce and recording the signature. A stored hour-old live
session is valid; the destructive-action reauthentication interval is not
applied to ordinary consent. The insurance signature must refer to the
currently published, hash-verified disclosure at the same revisions.

A new revocable `upload_class` consent grants only `store`. Re-signing
supersedes only that exact class grant, leaving migrated self-source and
analytic-purpose records untouched. No file, analysis, mail or model row is
created. The new nullable birth-date field is not backfilled; an invoker
trigger protects it from direct client writes despite existing profile
table-level grants. Account completion must validate it server-side.

## Verification completed locally

- 37 focused token/request/route tests passed; type checking and scoped lint
  passed. The artifact test recomputes the file hash and checks exact seed
  equality. Tests include signed-but-malformed envelopes, cross-context
  tokens, account/session/subject swaps, missing origin/CSRF signals, extra
  fields, false affirmation and closed receipt validation.
- 30 rollback-only database assertions passed. They include missing and
  underage dates, direct-client date-write denial, unchanged ordinary profile
  editing, disclosure-before-class order, full artifact hash checks, zero
  signature/nonce-consumption on refused attempts, actual service-role
  execution, replay, expiry, foreign subject, stale account/auth/binding
  revisions, deletion hold and originating-session deletion.
- The history fixture explicitly contains a migrated grant before signing;
  its preservation assertion is not an empty-set comparison.
- The local security advisor returned no findings after the signing
  implementation. No hosted schema or user data was changed.

The attempted four-suite regression run was **not green**. The new 30-case
suite passed again, but the old account-deletion test stopped after two
assertions because a global scalar subquery found multiple existing rows.
The invitation suite failed nine checks after its unscoped mail claim did
not yield its expected token; the family suite failed six global-count
checks (for example, 24 existing grants where it expected zero). These tests
assume a clean database, while this shared local stack retains earlier
browser fixtures. This run does not establish regression safety. Do not
reset or purge the shared stack to make it pass; run the complete regression
suite on an isolated clean stack/CI before release. Existing test assertions
were not weakened or scoped away.

The draft migration was created with the CLI and iterated against local
Supabase using SQL without adding migration-history entries. Do not blindly
reapply it to that same local database. Generated types were inspected and
only the new date field and signing RPC added; unrelated differences in the
local schema were not used to delete existing type definitions.

## Required before this branch can ship

### Account-completion and screen integration checkpoint (2026-09-06)

The local branch now connects the actual upload pages to the account-context
RPC, short-lived presentation issuance, initial date declaration and the two
independent artifact decisions. The own-DNA checkbox saves with one click
and enables the file chooser on the same screen only after server success.
Returning with current signatures and an active class grant skips those
decisions. Preparation exceptions render an unavailable upload block without
taking down the existing file controls.

The additive account-completion endpoint is registered with its exact
request, authorization and closed response. It writes an unset birth date
and advances the account revision; it does not grant storage or analysis.
The signing snapshot now carries independent subject and account-binding
revisions. The real adult-invitation acceptance transition produces subject
revision two and account-binding revision one; its subsequent own-account
disclosure signing is exercised in the new database suite.

Verified on this branch:

- Typecheck and scoped lint exit zero; 84 focused unit tests pass across
  account date/request, account route, signing route/token and route builders.
- Both own-upload database suites pass 72 rollback-only assertions. The
  42 new assertions include the real adult acceptance transition using a
  scoped synthetic delivery-token fixture. They do not claim mail delivery
  or the full other-adult upload journey.
- The production-build browser run passes all three focused cases: the
  real account-details/disclosure/own-DNA sequence and both existing file
  deletion cases. No retries or skips. The new sequence asserts zero
  transport/processing requests and zero analytic grants, then reloads
  without repeated decisions. It stops before file selection.
- A first browser run passed both deletion cases but failed the new test's
  database read: it selected a nonexistent purpose-grant column. The query
  now selects the real target column while retaining the zero-grant assertion.
- The synthetic ready-screen screenshot was visually checked: content and
  file controls render, and the flow records no browser page errors.
- Readability passes (2,475 blocks); static legal checks pass (25 files).
  The local database security advisor reports no findings.

This is not production evidence. No hosted changes or real account file
operations were performed. No new PR is open for this branch. The full
regression suite has not yet run against an isolated clean database.

### Remaining release work

1. Connect the original signup age/jurisdiction contract. Initial completion
   before upload now covers missing account dates but does not replace that
   signup requirement or provide identity verification.
2. Extend browser coverage to changed artifacts, expired presentations and
   revocation races. Current-signature reload is verified; not every stale
   screen case has a browser proof yet.
3. Enforce the identical live class consent at upload-session issuance,
   Storage insert, finalization and processing. Replace the normal browser
   session bearer with the registered upload-only role/JWT, and migrate the
   request to the canonical target/format shape. No checkbox-only enforcement.
4. Connect explicit per-purpose consent to normalization and analysis. Class
   storage permission must not silently enable analysis. Preserve earlier
   file/report rights that are independently still valid.
5. Prove actual file selection → decisions → transfer → processing → result
   with browser tests, plus denial and revocation races. Fixtures may not
   preseed the consent/upload steps claimed as journey coverage.

Accepted Path-A adults uploading in their own accounts use this own-subject
case, not the Path-B per-file recipient reconfirmation ritual. Path-B and
both embryo paths still need their complete separate integration, including
physical source cleanup and honest result/unavailability states. Full-plan
acceptance remains **18/65**.
