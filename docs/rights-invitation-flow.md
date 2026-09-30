# Rights invitation flow — implementation checkpoint

PR71 merged as `e9778f8d5e5847deeb5b3d057f7c25ba67b418da` and is live
on both public domains. Full main-branch integration run `34019023140` passed.
Full-plan acceptance remains **18/65**. G5.4 is still NO.

## Contact-key rotation and invitation quotas (2026-09-28, local, not released)

Two G5.4 blockers are built under TEST-LOCAL, exactly as
`lifecycleDispositionContracts.global-contact-refusal-bar-v1` and
`securityRateLimitContract` in `docs/route-register.json` describe them.

**Keyring** (`barKeyring`, `secretRotation`). Migration
`20260928130000_hmac_keyring.sql` adds `private.hmac_key_versions`: two
keyrings, `contact` and `rate-limit`, each with one `active` revision, any
number of `retiring` ones and `retired` ones.

- The application keys an address under every revision it holds
  (`src/lib/hmac-keyring.ts`). Revision 1 is the digest already stored, from
  `BYOK_ENCRYPTION_KEY`, so no stored value changes. Later revisions are
  dedicated secrets in `INHERIT_HMAC_KEYRING`.
- The database keeps only the usable revisions of a presented set. A request
  missing one is refused, never matched with less: that is the invitation gap
  rotation must not open. A bare digest is accepted only while revision 1 is
  the one usable revision.
- A match under any usable revision is the same contact. The set is declared
  for the one transaction, so the existing bar checks see every revision;
  new contacts are written under the active revision and indexed under all.
- A refusal bars the contact under every other keyring revision it is linked
  to, with the refusal's own deadline (`private.fan_out_refusal_bar_aliases_v1`).
  Only cross-revision aliases are copied; nothing is renewed or shortened.
- A live invitation keeps the revision it was written under. Acceptance
  compares the presented digest under that revision, so a session opened
  before a rotation still works after it.
- A revision retires only when no unexpired bar, pending invitation, pending
  contact, subject-control authority or quota bucket depends on it. After
  that its digests are dropped from every presented set.

**Quotas** (`quotaAuthority`). Migration
`20260928130100_invitation_keyring_quota_doors.sql` moves the six RPCs that
receive a contact digest behind keyed doors. Both invitation RPCs reserve and
count the buckets first, inside the same transaction, before any identity,
draft, token or address match: 10 attempts an hour and 30 a UTC day per
acting account, and 30 an hour per source network. A call without both
bucket keys is refused. An exhausted
quota writes nothing else and returns the same empty receipt a barred address
gets. Buckets hold only the operation, dimension, window, key revision,
digest, counters, first-attempt time, fixed purge time and a coded outcome;
`/api/jobs/retention` deletes them at their purge time
(`security.rate-limit-hmac-24h`). No API role can write, reset or erase a
bucket; the service role keeps read access only.

**The source network** (owner decision, 28 September 2026). The platform's
client address is read once, in `sourceNetwork` in
`src/lib/source-network.ts`: IPv4 whole, IPv6 by /64, anything unreadable as
one shared `unknown`. Only `src/lib/rate-limit-keys.ts` may import it, and it
passes the value straight into a keyed digest; the bucket is purged within 24
hours and never decides a jurisdiction. `scripts/jurisdiction-inference.test.ts`
allows exactly that one call, as it allows the sanctions check, and fails a
second read in the same file, a read anywhere else, a new importer, and any
use outside the digest. A self-hosted deployment must sit behind a proxy
that sets the client address; without one, every request shares one
network and the limit is 30 invitations an hour for the whole site.

Not built, and why:

- **The blocked-attempt protective notice**
  (`api.invitations.policy.blockedAttemptNotice` says "may"). Its two quotas,
  `perContactHmacProtectiveNotice` and `globalProtectiveOutbox`, govern a
  message that is never sent, so they have nothing to count yet.

Verification: three new database suites, `hmac_keyring_rotation.sql` (54),
`hmac_keyring_cohort_rotation.sql` (14) and `invitation_attempt_quotas.sql`
(58). Eleven planted regressions each fail at least one of them: no declared
aliases, no bar fan-out, a bare digest after rotation, retired revisions still
matched, sessions compared under the active revision, no retirement guard, a
quota that never refuses, optional quota keys, a rotation that restarts a
window, a service role that can reset a bucket, and no network bucket. Four
more, planted in the application, each fail a unit test: a second address
read in the reader, a new importer of it, the address sent outside a digest,
and a route that omits the network key. The existing database suites fail exactly as before on the shared
local database, and the 31 independent-session lock checks pass with both
migrations applied inside each probe's transaction.

### Rotation runbook

1. Generate the new secret (`openssl rand -base64 32`) and add it as the next
   revision to `INHERIT_HMAC_KEYRING`, for example `2:<secret>`. Deploy. The
   database ignores a revision it has not rotated to.
2. Rotate the database, as the database owner:
   `select private.begin_hmac_key_rotation_v1('contact', 2);` (or
   `'rate-limit'`). From this commit on, every invitation must present both
   revisions.
3. Retire the old revision when nothing depends on it:
   `select private.retire_hmac_key_version_v1('contact', 1);`. It refuses
   while any dependency is live. For the contact keyring that is up to 365
   days (the refusal bar); for the rate-limit keyring at most 24 hours.
4. Remove a retired revision's secret from `INHERIT_HMAC_KEYRING`. Revision 1
   has no separate secret: it is derived from `BYOK_ENCRYPTION_KEY`, and
   retiring it only stops the database from matching it.

## Rights-purpose matrix and the Future Person claim start (2026-09-28, local, not released)

**The matrix** (`policyResolvers.withdrawal-target-v1.purposeMatrix`).
Migration `20260929150000_rights_purpose_matrix.sql` stores the register's ten
purposes, their actions and the route each action reaches, in
`private.rights_purpose_matrix`. `scripts/rights-purpose-matrix.test.ts` fails
if the seed and the register differ in either direction.

- `private.rights_session_purposes` lists the purposes a credential is
  actually stored under, with the one target kind each binds. Today that is
  the two invitation kinds. A matrix purpose with no row there has no issuer,
  so no session of it can exist.
- A trigger on `public.rights_sessions` refuses an insert, or a change of
  purpose or target kind, that is not one registered pair
  (`databaseConstraint`).
- `private.rights_action_permitted_v1(purpose, action, route)` is the one
  gate a new rights route asks. No future-person purpose reaches
  `api.withdraw` or token-target export.

**The claim start** (`api.future-person-claim`, `rights.future-person-claim`).

- The page is public, reads no account and is never jurisdiction-blocked. It
  shows the refusal standard and the no-guess rule before its first control.
  It offers the form only where a record can exist, which today is TEST-LOCAL
  (`src/lib/future-person/claims-open.ts`); everywhere else it says claims are
  not open and collects nothing.
- `src/proxy.ts` gives each page view a ten-minute form cookie and a sealed
  token bound to it. The POST must send both, from the exact origin. A
  browser that already holds the cookie keeps it, because Next.js prefetches
  the page it is showing; a new cookie there would strand the served token.
- A Record Key, a Recovery Key and a keyless start all get the same 202 and
  the same kind of claim-session cookie. Nothing on the path looks for a
  record, so the answer cannot depend on one.
- The identity and contact fields are sealed in the application under a key
  made for the one claim, and that key is sealed with the deployment key. The
  database holds both as ciphertext and cannot open either. A key is kept only
  as its SHA-256. The claim session is kept only as the SHA-256 of its cookie.
- `private.start_future_person_claim_v1` counts every limit before it writes:
  per network 10 in 15 minutes, 40 a UTC day and three live; per key or
  contact one live and three a day; 500 live in all. A refused start is the
  shared 429 with no cookie and no row but its counters. A replayed form is
  the opaque 404.
- An intake lives 24 hours from its start, ends after 30 idle minutes, and is
  never extended. The retention job deletes it
  (`purge_future_person_claim_intakes_v1`), and the deleted row takes its
  sealed key with it.
- A rate-limit key revision cannot retire while an intake written under it is
  unexpired, so a rotation cannot lift the one-live limit early.

**The documents step** (2026-09-28, local, not released). Migration
`20260929151000_future_person_claim_documents.sql` builds
`legal-evidence-ingest-v1` for the two claim document kinds, and the owner's
choice of scanner, self-hosted ClamAV, runs in the scan worker
(`docs/claim-document-scanning.md`).

- A browser holding a live claim sees the documents step. The page renders a
  one-time nonce bound to the claim cookie, and
  `POST /api/future-person/claim/session/documents` opens one evidence
  session for one document: its kind, declared type, size and SHA-256, a
  hash-only evidence cookie and an expiry no later than the claim's. At most
  three open sessions per claim, and three documents per kind.
- `PUT /api/evidence/[session]/chunks/[sequence]` takes at most five chunks of
  at most 4,000,000 bytes. The database reserves each sequence once, under a
  key it makes in the private `future-person-identity` bucket. The server
  hashes the bytes itself, seals them under the claim's data key with the key
  as authenticated data, and writes them create-only. Too many bytes, a body
  over the chunk limit or a failed write ends the session.
- `POST /api/evidence/[session]/complete` spends the one-time completion
  nonce, checks the chunks are exactly 0 to n-1 and add up to the declared
  size, and composes one sealed object only if the SHA-256 and the type read
  from the bytes match. The document is then **quarantined**. The route says
  `202 {"status":"scanning"}` until the scan has answered, then `201
  review_pending` or one closed refusal. evidence-complete-v1 promises only
  the 201; the interim 202 is this build's answer to a scan that runs in a
  worker, and is not yet in the register.
- Only `private.record_claim_document_scan_v1` can mark a document clean: a
  literal `OK`, bound to the document's SHA-256, under signatures at most 24
  hours old. A trigger refuses any other path to clean. Infected,
  unscannable and oversize documents are refused at once, their objects
  deleted, and the ledger records the reason and nothing else.
- `private.claim_document_review_object_v1` is the read gate the reviewer
  routes will call. It returns nothing before a clean verdict, and nothing
  after the claim ends. No API role can call it.
- `jobs.retention` deletes fragments, refused documents and everything of an
  ended claim, and the claim is purged only once no object is left behind it.

**Not built.** The named-human review with MFA, the claim completion
(`api.future-person-claim-complete`), the release, the claimant rights routes
and keyless notice release. The register's one-time chunk-nonce header is
not read; the fragment reservation stands in for it, pending an owner
decision (`docs/route-divergence.json`). The older
`public.future_person_claim_sessions` and `public.future_person_claim_documents`
tables are left alone: the first requires an embryo id, and the second hangs
off `public.future_person_claims`, which does too. A public claim must never
learn one.

## Local reviewer document display contract · 30 September 2026

The named-reviewer page is `/reviews/future-person/claims/[id]`. A current own-JWT named assignment and recent MFA are required before it renders a case, and its fresh browser GET rechecks that authority. A complete document is fetched through the existing closed raw chunk GET bodies and headers, with the declared whole size and SHA-256 checked before any acknowledgement. Each authorized download-session POST issues its own exact session/chunk/digest proof; GET creates no operation nonce, challenge or read receipt. Service preparation of the proof remains inaccessible to the reviewer JWT. The reviewer's replay-safe acknowledgement rechecks current authority and is distinct from the explicit human read and documentary attestation.

Byte receipt alone does not enable the human read confirmation. PNG and JPG must decode successfully in a native image. PDFs use local pinned PDF.js 6.3.289 in a dedicated worker, rendering only to canvas. There is no annotation HTML, active link, scripting manager or remote document URL, and document-selected asset names cannot leave the exact packaged local filename/size inventory. Every full PDF page must successfully render before the separate human checkbox appears. Previous/next page and 1–3-times page size controls retain the entire page in a scrollable view. Each loading, asset-read or page-render step is bounded to 20 seconds; documents over 200 pages or a page canvas above 16 million pixels are refused as a whole, with no read confirmation. Errors, cancellation and decision completion terminate the worker and clear the document view. These display bounds do not change the registered 20-million-byte upload limit or the PNG/JPG/PDF type support.

The real loopback renderer check proves exact nonblank pages and inert planted links/actions without app or database access. The two full application journeys are authored with their correct complete/processing route titles and remain unexecuted until full CI passes. No G5.4 acceptance row is changed. Release of export, binding, correction, claimant deletion and recovery/keyless notice transfer remains closed pending implementation and verification.

## Release receipt (2026-09-06)

Exact reviewed head `98ee24bd938b0a9475b529c1cea544008a7170a0` passed full CI
`34018132773`: 2,202 unit tests, 1,044 database assertions in 30 suites,
30 independent-session lock checks and 213 browser cases, with no browser
skips or retries. All six migrations were applied and verified on Inherit.
All 45 changed functions match the tested local bodies, arguments, security
mode, search path and role privileges. File and published-report fingerprints
are unchanged. Production `dpl_23r8rERkNjnPmUeaF9GZAzWgngc6` is READY at
the exact merge, with both domains assigned.

Signed-out production browser checks on both domains confirm the entry page,
fragment clearing, disabled invalid-link action, private response headers,
cookie-free HEAD, and opaque 404s for invalid refusal and missing rights
sessions. The real acceptance/refusal/mail/Storage journey is proved by the
synthetic production-build CI cases, not by sending real production mail.
See `docs/hosted-rollout-2026-09-06.md` for migration versions and boundaries.

The sections below preserve the earlier, dated implementation checkpoints;
their not-released/pending statements are superseded by this receipt.

## Earlier PR71 release review

Draft PR71 is open. Its first clean CI run, `34017689226`, passed typecheck,
lint, build, units and the content gates, then failed the secret gate on the
non-secret source identifier `testKey`. The exact fixture reference is now
documented in ADR 0006; its path and unchanged local-config declaration are
validated. Literal replacements, another path or another declaration remain
failures. Credential detection and the history baseline are unchanged.

The review also found that the proxy could return 423 for accountless refusal
when the browser happened to be signed into an unrelated account under deletion
notice. The refusal API now bypasses account refresh/restriction checks and
still enforces its rights cookie and sealed form at the handler. A real browser
case proves ordinary APIs still return 423 while refusal succeeds and remains
retryable after cleanup. Terminal notice mail now rechecks authority after an
awaited Auth address lookup, immediately before submission.

All six production-build browser cases pass in 25.9 seconds with no skips or
retries. Focused source-reference, proxy and terminal-mail units pass; typecheck,
scoped lint and the full repository/history secret gate pass.

Read-only hosted transport review on the Inherit project
(`zuvloczwgrayonqabnss`) found: Storage object RLS enabled, no
`legal-evidence` bucket, no evidence-upload issuing database function, and only
the authenticated genome-staging INSERT policy. Source inspection likewise
finds no application evidence-upload issuer. Therefore an outstanding issued
legal-evidence upload URL is not a current production release blocker. This
does not implement evidence upload or waive its future transport requirements.
No hosted schema, permission, object, user, credential or mail was changed.

The hosted migration ledger ends at `20260906003053`; PR71 adds six ordered
invitation/evidence migrations. They require verified application before
production promotion. Clean CI and the final authority review remain pending.

## Latest: shared evidence and late-write protection

Cleanup now checks every direct reviewed-evidence foreign-key path: live cohort
basis, claim documents, claim objections, correction decisions and appeals.
A cohort naming only the legal review also blocks deletion. An independent
review target or a second reviewed row sharing the same object blocks it too.
This preserves shared evidence pending its independent disposition; it does
not pretend that a blocked shared package has completed the refusal purge.

Thirteen evidence/reference tables take the invitation lock in a BEFORE
STATEMENT trigger, before row locks, then check new attachments per row.
Cancelled sessions cannot reopen, move to another target, receive late
fragments/documents/copies/working data/assignments, or gain independent
evidence references. Frozen object identities cannot be reused. The cleanup
executor can still release a reviewed original while retaining its minimal
review receipt.

The Storage worker rechecks its exact claim, lease, manifest ordinals and
evidence exclusivity before each batch, and still verifies actual object
absence before acknowledging deletion. No Storage schema, permission or
metadata-deletion behavior changed.

Verification: 31 new database assertions exercise pre-existing shared
references through actual refusal and cleanup, late writes, exact batch
authorization, API privileges and the complete direct-reference table list.
All 30 independent-session lock checks pass, including the thirteen statement
triggers. Eleven worker units cover authorization failure/false results before
Storage, batch limits and retries. The five production-build browser tests
pass again in 25.2 seconds with no skips or retries, including real Storage
deletion and preservation of another draft. Typecheck, scoped lint and local
security advisors pass.

Remaining review must distinguish relational write fencing from provider
transport: this does not revoke an already-issued Storage upload URL or prove
physical network dispatch atomic with a database transaction. The evidence
upload issuer and transport lifecycle still need release review. Full clean
migration/CI and hosted verification remain required before merge.

## Latest: connected public refusal (local, not released)

The co-parent recipient now has a working **Decline invitation** action without
an account, a signature, a reason or a jurisdiction choice. A person signed into
a different account can decline without seeing the draft's private review.
The server accepts only a closed, bounded JSON operation with a same-origin
request, the rights cookie and its session-bound form nonce.

The action uses the existing atomic refusal, canonical notice and physical
cleanup workers. A hash-only receipt survives draft/session cleanup until the
original session deadline (never longer than 24 hours after consumption).
Retrying the same operation and reloading the receipt work after cleanup.
Both receipt columns must be present together; retention independently removes
expired receipts. This is not an extension of genetic-data retention.

The shared transition lock now precedes authority access in ten existing
writers, including invitation issuance, activation, acceptance, finalization,
expiry and ordinary mail claims. Stored contact aliases are checked for refusal
bars. The ordinary mail worker checks its exact claim immediately before
submission and does not write a failure over an accepted provider request when
the database receipt is lost.

Verification:

- Five production-build browser cases pass (30.9 seconds, no skips/retries):
  original acceptance, signed-out refusal, wrong-account refusal, malformed
  fragments and actual Storage cleanup. Refusal cases run the production mail
  and retention routes, inspect notice delivery and retry after the draft is
  physically purged. Only Resend is replaced with the loopback test provider.
- The signed-out screen was visually inspected at 390px in dark mode; the
  other-account screen was inspected at desktop width in light mode. Neither
  has horizontal overflow. This is not complete accessibility coverage.
- 22 public-form/API units plus six mail-route units pass. The mail units
  cover denied/unavailable authority, check-before-send ordering, successful
  delivery, provider failure and lost acceptance receipts.
- `pnpm test:invitation-locks` passes 16 checks using independent PostgreSQL
  backends. It is wired into CI after pgTAP. Each probe runs as service_role,
  waits on the exact lock, and is cancelled inside an uncommitted transaction.
  No extension, database privilege change, fixture purge or reset is needed.
- The first dblink test approach could not authenticate under local trust
  rules. It was removed, not enabled by granting privileged dblink access.
- Typecheck, scoped warning-as-error lint and the full readability gate pass.
  Ten ordinary words used in the refusal UI were explicitly registered;
  no readability threshold, scoring rule or jargon exclusion changed.
- The final focused database run passes **358 assertions in nine suites**,
  including cohort runtime, adult invitation, exact binding, public refusal,
  kind-aware cleanup, canonical notices and storage guards. Local security
  advisors report no warning/error findings.
- At implementation commit `4468dd8`, the complete clean-checkout unit suite
  passes **2,194 tests in 139 files** (22.44 seconds). This includes production
  email rendering/capture; it is not a complete clean migration or browser CI run.

The combined database run found assertions that counted unrelated terminal
notices left by earlier synthetic browser runs. The tests now bind counts and
date changes to their own invitation fixtures and account separately for
already-due expiry work. No shared rows were removed to make the suite pass.
An additional older `embryo_authority.sql` run fails in setup: its broad fixture
deletion hits a relationship still referenced by a directional grant. It was
not edited or bypassed. This is not a full clean-database test receipt.

Still required before release: wider shared/live evidence protection and write
fencing, review of all changed authority paths, clean migration/full CI and
hosted verification. Full G5.4 additionally needs active-key rotation and
retirement behavior, account/network quotas, other rights purposes and the
complete route/state matrix. (The adult URL-token migration was listed here
until 2026-09-21 and is done: D-081 closed on 2026-09-13, and the invitation
mail now carries the token as a URL fragment rather than in the path.) The SQL checkpoint
before a network call does not prove atomic provider delivery against a
concurrent refusal. A receipt currently covers this holder's explicit refusal,
not every independently terminalized invitation.

Next concrete safety fix: the cleanup claimant currently rejects shared
objects reached through another evidence-ingest session, but reviewed evidence
also has direct references from cohort/claim/correction/appeal tables. Those
references must be checked before issuing any Storage delete, alongside
protection against evidence writes after the draft has been cancelled.

The earlier sections below are chronological checkpoints, not claims that the
latest refusal UI is still missing.

## Connected locally

- `/withdraw/request` is a small generic document, not a target lookup. Its
  first inline script reads each arriving fragment once into bounded memory
  and immediately clears the URL before deferred work. It also handles a
  second fragment navigation in the same tab. There is no application bundle,
  external request, local/session storage, telemetry or credential-bearing DOM.
- GET issues only the ten-minute HttpOnly candidate cookie and its bound form.
  HEAD issues no cookie. The proxy does not read an account on this entry path.
  A nonce CSP, no-referrer and private/no-store headers apply.
- The real activation POST now requires both Origin and Fetch Metadata, JSON,
  the candidate cookie and its sealed form before calling the existing
  one-time token/session RPC. Every rejection is the opaque 404.
- `/withdraw/session` resolves a supported, active, unexpired purpose before
  target access. Anonymous holders see only a safe sign-in return link; a
  wrong or unverified account sees no draft or signature. Current invitation,
  slot, principal, draft and account eligibility are checked before review.
- The correct account sees the uploader's signed name for this exact draft,
  both current full legal artifacts, their versions/hashes, seven unchecked
  statements, an explicit country choice and a shared typed-name signature.
  The operation and artifact tokens bind the server-derived account/session,
  rights session, draft and exact document versions. The existing acceptance
  RPC consumes the operation, records both signatures and ends the session.
- Acceptance does not finalize the cohort, enable ingest/analysis, or grant
  the inviter access to the recipient's genome. Real-jurisdiction acceptance
  remains off under the existing policy; rights review itself remains readable.

## Verification and discoveries

- 68 focused unit tests across four files pass: candidate/operation envelopes,
  actual entry/activation handlers, fragment lifetime and review authorization.
- Typecheck and scoped warning-as-error lint pass.
- At implementation commit `235a1aa`, the complete unit suite passes all
  **2,139 tests in 136 files** from a clean checkout (21.43 seconds).
- The production-build browser test uses real local Auth, PostgreSQL RPCs and
  the mail worker, with only Resend replaced by the existing loopback mock.
  Its fixture reserves a draft and the uploader's prerequisite signature by
  RPC; it does **not** claim the still-missing uploader UI works.
- The emailed link, scanner GET/HEAD, explicit activation, wrong-account denial,
  correct-account review, actual acceptance, replay denial and database receipts
  passed locally. Malformed and same-tab fragment navigation also passed.
- The final two-case production-browser run passed in 15.7 seconds with no
  retries/skips, including the actual sign-in return link and inline typed-name
  correction. A full-page screenshot of the synthetic review was inspected;
  the desktop layout has no horizontal overflow. This is not a dark/mobile
  or complete accessibility acceptance claim.
- Browser testing found and fixed same-document fragment handling. It also
  caught an incorrect principal assumption: the uploader's account principal
  and their draft genetic-parent principal differ. The signed name is now
  resolved by the exact draft and its server-derived owner account.
- An initial test assumed one 25-message worker batch would reach its message.
  Older synthetic mail occupied the shared local queue; the test now exercises
  bounded normal worker batches without changing mail eligibility or selectors.
- A linked dependency folder was unsuitable for Turbopack's filesystem root.
  The link was moved recoverably outside the checkout and this worktree now
  has its own frozen-lockfile dependencies. No dependency versions changed.

The Next.js/Supabase guidance informed server-only authority checks, explicit
cookie issuance, serializable form data and production-build verification.
The brief's pre-render fragment-removal rule requires a plain synchronous
interstitial, not a deferred/hydrated script. The normal site shell remains
on the review page; interstitial typography/theme parity still needs review.

## Required before release / acceptance

### Exact invitation binding (local follow-up)

The activation and acceptance RPCs now use one private authority resolver.
It follows the original token hash, its candidate and the exact invitation;
checks token and invitation revisions, pending slot/principal, current contact
authority, draft lifetime and existing refusal bars; and locks the matched
authority rows for the mutation. Review also follows the exact token chain,
instead of substituting an invitation with the same principal/draft pair.

The new database regression suite passes all 48 assertions. Running those
same assertions against the previous functions inside a rolled-back transaction
produces 28 failures, including acceptance of a replacement invitation for the
same parent and draft. The existing 141-assertion cohort suite passes as well.
The review unit suite passes 30 cases, including eight new token-chain cases;
typecheck, scoped lint and local security advisors pass.

At implementation commit `4c1e606`, all **2,147 unit tests in 136 files**
pass from the clean checkout (24.10 seconds). Both targeted production-build
browser cases pass in 23.0 seconds without skips or retries, including the
actual local mail/activation/sign-in/review/acceptance journey. Only the mail
provider is replaced by the loopback fixture. No hosted action was taken.

This does not yet establish the cross-version contact lock, concurrent refusal
insertion/provider-submit ordering, or complete refusal transaction. Those must
be integrated with issuance, mail and cleanup before release. No refusal UI is
enabled by this change.

The shared development database is not a clean CI database: a full database
run fails on leftover synthetic-row totals and missing ingest functions.
Its older turnaround function was brought to the already-committed
`20260905202657_job_timing_privacy.sql` definition to run the cohort suite.
No shared reset or fixture-data cleanup was performed. The new migration
was applied locally as SQL without adding migration-history entries; local
history already trails several main-branch migrations. A clean full migration
and database run remains required for release.

This is not a completed rights workflow and must not ship as one:

### Refusal transaction (private local implementation)

`20260906051253_invitation_refusal_transaction.sql` now implements a private
co-parent refusal transaction. It consumes the operation nonce, resolves
stored contact-key aliases, preserves an existing bar's original deadline,
and dispatches each matching pending invitation by its stored kind. Co-parent
and unconfirmed adult drafts are cancelled and get narrow purge work; an
optional donor loses attribution while its embryo draft, real parent slot,
count and original deadline are preserved. Collateral cancellation of another
parent does not create a bar for that parent's address.

Old tokens, sessions, reminder rows and queued/claimed invitation mail are
invalidated. The original invited contact is shredded after copying the
minimal notice recipient to a separate private intent. That intent has an
unchangeable maximum 30-day deadline and is classified in the purge register;
the inviter intent stores only the server-derived account and authority
revision. Neither notice contains a genetic result or another person's address.
Draft-bound legal evidence object IDs enter the existing purge manifest.

The two new refusal database suites cover transaction rollback on notice
failure, accountless invocation, exact cancellation and evidence scope,
replay, key aliases, cross-account adult cancellation and donor preservation.
Their 59 assertions pass, together with the 48 exact-binding and 141 existing
cohort assertions: **248 passing database assertions across four suites**.
The third-party fixture creates both real pending parent slots and proves
that cancelling the other parent's invitation does not bar that address.
A retired inviter also cannot prevent a recipient's refusal. Local security
advisors report no warning/error findings for the current database.
At implementation commit `4972215`, the complete unit suite also passes:
**2,147 tests in 136 files** from the clean checkout (21.80 seconds).
No application/browser code changed in this transaction checkpoint; the
previous browser receipt belongs to `4c1e606`, not a new refusal UI run.
The donor fixture seeds the declared pending-draft shape; it does not pretend
the still-missing donor invitation UI or issuance path exists.

**The refusal operation is still not callable by API roles or connected to a
UI.** The following local checkpoint connects mail and actual draft cleanup.

### Canonical notices and physical cleanup (local follow-up)

`20260906053451_invitation_terminal_mail.sql` now creates the canonical
`mail_outbox` row in the refusal transaction itself. The private record is
its independent recipient envelope, not a second outbox. A canonical-outbox
failure rolls back refusal. Terminal notices have no draft/principal/contact
FKs and carry only one registered notice kind. The original invitation's mail
invalidation and ordinary mail claimer exclude these terminal rows.

The mail worker checks the exact canonical envelope, deadline and recipient
authority before reading the encrypted address or looking up the current
verified owner. It uses canonical provider attempts/delivery receipts and the
original idempotency key, releases recipient material on accepted submission,
and never overwrites an uncertain accepted receipt with a failure ACK. A first
submission older than the provider's 24-hour deduplication window is not
automatically resent. The independent retention job deletes expired envelope,
outbox and delivery copies at the original 30-day deadline.

`20260906055142_refused_invitation_draft_cleanup.sql` connects the registered
refusal phase to a storage-aware worker. Normal draft expiry now excludes
refusals instead of cancelling their purge. The worker claims one due manifest
with a five-minute lease and freezes exact Storage addresses for draft-bound
fragments, documents, review copies and linked reviewed originals. It uses the
Storage API, not SQL metadata deletion. Storage completion requires the object
and frozen address to be absent. Wrong ordinals, stale leases and changed draft
revisions cannot complete cleanup.

After storage is gone, the exact draft evidence, invitation credentials,
ordinary invitation mail, contacts, signatures and draft principals are
removed. An unconfirmed adult placeholder is physically removed. Account
principals, unrelated subjects/cohorts/genomes and optional-donor drafts are
not selected; independent terminal notices survive. Shared evidence is rejected.
The current adult reservation has no upload; a future quarantined upload graph
still requires its exact upload-revision purge implementation, not an
account-wide fallback.

Verification so far:

- Six related database suites pass **309 assertions**, including actual
  kind-aware refusal followed by cleanup of two co-parent drafts and the adult
  placeholder while preserving the optional donor draft.
- The additional storage-guard suite passes **12 assertions**, covering all
  four evidence-object forms, premature completion, invalid batches, expired
  worker leases, exact-address retry and draft-revision changes.
- **21 targeted unit tests** cover both new workers and the retention route.
  Typecheck and scoped cleanup lint pass.
- The production-build retention-route test passes in **11.7 seconds** without
  skips or retries. It uploads real synthetic evidence to local Storage,
  invokes `/api/jobs/retention`, verifies physical deletion and completed
  manifests, and proves another draft/evidence object remains accessible.
  This test seeds the cancelled-draft/queued-phase boundary; it does not claim
  the still-missing refusal UI works.
- That test first found a missing older `expire_embryo_terminal_mail_v1`
  function in the shared development database. The already-committed,
  self-contained terminal-mail definitions (lines 45–144 of
  `20260905203457_embryo_ingest_unwind_runtime.sql`) were applied locally,
  with no reset/history changes. The test was rerun without weakening its
  zero-failure assertion. Full clean migration/CI verification is still due.

At implementation commit `ffad5e4`, the full clean-checkout unit suite passes
**2,167 tests in 138 files** (21.26 seconds), including the actual production
email renderer/Chromium capture fixtures. The final combined targeted database
run passes **321 assertions in seven suites**. Local security advisors report
no warning/error findings. Typecheck, scoped warning-as-error lint, the full
readability gate and `git diff --check` pass. The browser receipt above covers
the production route and real local storage, not the public refusal journey.

All invitation writers still need the shared transition lock and provider
submission ordering proof. Evidence upload/write fencing and shared/live
authority cases need wider coverage before public refusal is enabled. No
production action or real genome deletion was taken.

1. Implement accountless refusal with its registered atomic invalidation,
   global contact refusal bar, exact draft/evidence cleanup and minimal notices.
   The email already promises this action; no pretend refusal control is added.
2. Complete the cross-version contact lock and current-authority/refusal-bar
   rechecks across issuance, activation, mutation and provider submission;
   cover concurrency in addition to the local exact-binding regression suite.
3. Finish the review's participant/basis information for every invitation class,
   broader browser states, both themes, narrow viewports and accessibility.
4. Complete the other registered rights purposes (including future-person
   access), retention and purge flows. (The adult URL-token migration listed
   here closed as D-081 on 2026-09-13.)
5. Full branch CI, independent review and hosted release verification remain.

No hosted schema, real file, credential, account consent or email was changed
for this checkpoint. Synthetic local invitations/signatures were created and
mail was delivered only to the loopback test provider. The shared DB was not reset.
