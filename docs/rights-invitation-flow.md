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

- 68 focused unit tests across four files cover: candidate/operation envelopes,
  actual entry/activation handlers, fragment lifetime and review authorization.
- Typecheck and scoped warning-as-error lint pass.
- The production-build browser test uses real local Auth, PostgreSQL RPCs and
  the mail worker, with only Resend replaced by the existing loopback mock.
  Its fixture reserves a draft and the uploader's prerequisite signature by
  RPC; it does **not** claim the still-missing uploader UI works.
- The emailed link, scanner GET/HEAD, explicit activation, wrong-account denial,
  correct-account review, actual acceptance, replay denial and database receipts
  passed locally. Malformed and same-tab fragment navigation also passed.
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

This is not a completed rights workflow and must not ship as one:

1. Implement accountless refusal with its registered atomic invalidation,
   global contact refusal bar, exact draft/evidence cleanup and minimal notices.
   The email already promises this action; no pretend refusal control is added.
2. Complete activation/mutation current-authority and refusal-bar rechecks,
   including the exact invitation binding rather than relying only on a
   principal/draft pair; cover races and revision changes in database tests.
3. Finish the review's participant/basis information for every invitation class,
   broader browser states, both themes, narrow viewports and accessibility.
4. Complete the adult URL-token migration and the other registered rights
   purposes (including future-person access), retention and purge flows.
5. Full branch CI, independent review and hosted release verification remain.

No hosted schema, real file, credential, account consent or email was changed
for this checkpoint. Synthetic local invitations/signatures were created and
mail was delivered only to the loopback test provider. The shared DB was not reset.
