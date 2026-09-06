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

1. Connect stored adult-date capture at signup and existing-account completion;
   do not invent dates, read user-editable metadata as authority, or turn the
   own-DNA confirmation into a typed-date ceremony. The route register lacks
   a legacy account-completion path; resolve that explicitly as an additive
   contract, not an undocumented API.
2. Mint and persist the one-use presentation from the real upload screen,
   render the two independent decisions, and connect existing-current and
   changed-document states. Expired nonce cleanup must remain bounded and
   must not reset the token's original lifetime.
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
