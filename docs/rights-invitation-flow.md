# Rights invitation flow — implementation checkpoint

Branch: `codex/rights-invitation-flow`. **Not released.**
Full-plan acceptance remains **18/65**. G5.4 is still NO.

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
4. Complete the adult URL-token migration and the other registered rights
   purposes (including future-person access), retention and purge flows.
5. Full branch CI, independent review and hosted release verification remain.

No hosted schema, real file, credential, account consent or email was changed
for this checkpoint. Synthetic local invitations/signatures were created and
mail was delivered only to the loopback test provider. The shared DB was not reset.
