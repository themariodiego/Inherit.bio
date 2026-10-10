# Positive owner-notice refusal diagnostic

This is source-only at parent a558 plus the isolated Reason-label correction.
The actual hosted positive journey gets the unique current documentary lookup
and a non-null proof, then Save choice answers opaque404. The refusal stage is
not yet proved. No client response, authority, permission or provider clock changes.

The executable local witness is `scripts/diagnostics/keyless-owner-contact.sql`.
Root must run it with `psql -X -v ON_ERROR_STOP=1 -f` against its disposable owned
full-schema database, save TAP/output and independently confirm rollback. It
uses the unchanged canonical publication/transfer/profile/reviewer fixture and
the genuine authenticated public notice door. It deliberately omits the manual
account-contact insertion in `supabase/tests/future_person_keyless_notice_package.sql`
lines9–12. Its fixed fixture JWT and synthetic document/provider metadata prove
only SQL behavior; they do not prove browser-issued Auth or delivery.

The source mismatch is specific. Auth provisioning creates an `account_subject`
principal without a contact (`20260901030000_provision_account_subjects.sql`).
Canonical draft creation selects that self principal as uploader, but stores the
verified owner's encrypted address under a separate `genetic_parent` principal
(`20260905103317_embryo_cohort_runtime.sql`:1045–1094). The current keyed wrapper
delegates this exact producer (`20260928130100_invitation_keyring_quota_doors.sql`:91–129).
The notice consumer deliberately selects the account principal and requires its
current non-null contact at that principal revision
(`20261001020000_future_person_keyless_notice_package.sql`:180–198).
The witness asserts these counts, settled lifecycle/clock conditions, the actual
unique lookup, and complete unchanged public/private/Auth row hashes after refusal.
No missing contact is inserted and no genetic-parent authority is reused.

## Native POST refusal stages

The canonical review route is `src/app/api/reviews/future-person/claims/[id]/route.ts`.
Each numbered stage below can independently yield the same opaque404.

1. Claims gate, canonical ID/no query, current sensitive account/session (64–66,117).
2. Same-origin/content type/current session-bound CSRF (119–125).
3. Strict closed decision body and current ten-minute decision nonce (129–132).
4. Own-JWT current review RPC42501; current retained intake key/identity (134–139).
5. Strict five-field verified tuple projection and current keyless indexes (149–151).
6. Current documentary RPC42501/22023/23505, then exact actor/session/assignment,
   document/authority receipt and encrypted ten-minute proof equality (153–162).
7. Fresh projected branch must remain `unclaimed_keyless` (163–164).
8. Actual prepare RPC42501/22023/23505 after subject-first/current owner/contact,
   current receipt, fixed deadline, competing claim and atomic nonce guards (170–202).

Unknown SQL errors/invalid final outcome are503, not the observed404. A prior200
lookup does not identify a later refusal stage or authorize skipping fresh checks.
To locate the browser's refusal, root should use a closed server-only stage code
and SQLSTATE allowlist, or genuine current Auth-scoped replay; never print identity,
selectors, tokens, keys, ciphertext, raw errors or payloads. In particular, check
the exact resolved owner account-principal/current-contact count and revision
before assigning stage8 as the browser cause.

## Producer remedy to review only after the witness

Prefer a guarded successor to canonical cohort creation over a consumer fallback.
The existing server route derives the owner email from `auth.getUser()` and seals
it independently of the browser body (`src/app/api/embryo-cohort-drafts/route.ts`:35–76).
The actual implementation must additionally prove the current verified Auth email
and session, live non-deleting account, and exact self account principal/revision.
The service-only producer can then establish that principal's own delivery contact
atomically while reserving the draft; it must preserve source custody, signing,
purpose-separated full held HMAC revisions and all existing authority guards.

Require zero-or-one current contact; unknown/duplicate/stale authority refuses.
A current equal verified contact may be reused only with its exact principal and
revision. A verified email change must use reviewed rotation/index semantics and
invalidate old contact authority without reviving ended grants or extending a
clock. No copied genetic-parent/claimant ciphertext, arbitrary parent selection,
claimant custody, or unsolicited mail. The notice must keep its exact immutable
owner account/principal/contact and authority-revision bindings; provider callback
still independently establishes delivery and the unchanged thirty-day clock.

Before implementation, root must reserve the successor migration and verify this
specific missing-contact cause. Required actual proofs include canonical native
producer→current owner contact→notice200, third-party uploader scope, foreign/
expired/deleted/unverified Auth refusal, duplicate/stale/rotated contacts, current
held HMAC revisions, contact changes invalidating the original notice receipt,
concurrency, and transaction rollback. New contact metadata is never delivery,
documentary, human review, release or acceptance credit.
