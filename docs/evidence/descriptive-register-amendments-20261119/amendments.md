# The list of amendments: the brief and the route register, 19 November 2026

Made under the owner's decisions of 19 November 2026 in `docs/protocol/decisions.md`: "The brief's storage sentences are replaced" (for the brief) and "Register amendments that only describe decided behaviour" (for the register), which covers the three behaviours decided that day ("A brief failure of the sign-in service is not treated as signed out", "G8.5: the strictest referrer setting applies to the whole route", "G8.5: sign-out keeps an open rights session") and the rate limit the database already enforces on the Path A invitation. None of them changes what a person can do or see; each writes down what the product already does.

Two places in the brief and twelve in the register changed. Register places are JSON pointers into `docs/route-register.json`. Every new register key says which decision it comes from.

## The brief (`docs/inherit-v2-brief.md`)

Both changes are in the **Storage.** paragraph (line 2150). Nothing else in the brief changed. They are the texts of `docs/protocol/brief-corrections-proposed.md` items 22.1 and 22.2, word for word. Item 22.3 (the sentences about signed download links) is not applied.

**B1. Where files are stored (22.1).** Old:

> New object paths are `{account_id}/{subject_id}/{upload_id}/{filename}` for subject files and `{account_id}/{cohort_id}/{upload_id}/{filename}` for cohort files;

New:

> A subject file is stored under one server-generated UUID at the top of the `genomes` bucket, for its upload copy and its final copy, and the database rows, not the object name, link it to its account, person and upload; prepared (derived) files are stored as `prepared/{uuid}`; cohort files use `{account_id}/{cohort_id}/{upload_id}/{filename}`;

**B2. Who can read stored files (22.2).** Old:

> the legacy `{user_id}/{uuid}/{name}` layout keeps working under existing policies. Two additional read policies grant `select` on `bucket_id = 'genomes'` when segment 2 parses as a uuid and `subject_can(...,'variants')` or `cohort_can(...,'embryo_scores')` is true.

New:

> objects in the legacy `{user_id}/{uuid}/{name}` layout are still read and deleted through their database rows, and nothing new is written there. No Storage policy lets a signed-in person read `genomes`; every read goes through the server after a database check of the file's rows and permissions.

The brief's SHA-256 moves from `d1d98666febfacc5ae7214e533cb51dd8ef23bd99c5cfa7f1e663d4951557fa4` to `021616b28bdc44c4981ffb330ff418b888829e50046932e8a6d08f0bdc91caf2` (R1).

## The route register (`docs/route-register.json`)

**R1. `/briefSha256`**, the brief's pinned hash, which `pnpm gate:routes` checks. Old `d1d98666febfacc5ae7214e533cb51dd8ef23bd99c5cfa7f1e663d4951557fa4`, new `021616b28bdc44c4981ffb330ff418b888829e50046932e8a6d08f0bdc91caf2`.

### A brief failure of the sign-in service (R2 to R10)

What the owner decided: when the sign-in service fails for a moment, the server asks once more after a short pause; if it fails again, a page shows the existing "This page did not load" page at the address the person asked for, and a request from the app gets a short "unavailable" answer, instead of the sign-in page. The register said only what happens to a person who has no session; these amendments add the other case.

**R2. `/pageAuthContract/authServiceUnavailable`**, new. The page case beside the existing `authenticatedSignedOut` (which stays bound only to a real "no session" answer): no redirect, the existing error page at the requested address, status 500, no account data read, no sign-in cookie removed.

```json
{
  "registeredBy": "owner-decision-2026-11-19-a-brief-failure-of-the-sign-in-service-is-not-treated-as-signed-out",
  "appliesTo": "every-page-contractDefaults-binds-to-authenticatedSignedOut-and-the-two-reviewer-pages-reviews.future-person-claim-and-reviews.appeal; a-public-or-authenticated-page-renders-its-public-branch-as-publicOrAuthenticated.failure-says",
  "unavailableCases": "the-auth-service-did-not-answer-who-the-user-is: an-AuthRetryableFetchError (no-answer-because-of-a-network-failure-reset-timeout-or-abort-a-500-to-504-or-520-to-530-or-an-unreadable-success) or-an-AuthApiError-with-status-429-or-any-other-5xx; the-server-asks-once-more-after-250-ms-and-only-a-second-such-answer-is-this-case; a-second-answer-of-no-session-is-authenticatedSignedOut-and-a-confirmed-user-proceeds (src/lib/supabase/auth-check.ts)",
  "disposition": "no-redirect; the-existing-error-surface-renders-at-the-requested-URL: the-error-boundary's-This-page-did-not-load-whose-Try-again-asks-the-server-for-that-URL-again",
  "status": 500,
  "accountData": "none-is-read: no-profile-account-subject-record-jurisdiction-or-CSRF-token-is-read-before-the-error-and-no-access-is-granted-without-a-successful-check",
  "cookies": "no-auth-cookie-is-removed; tokens-a-refresh-rotated-before-the-failed-read-are-kept",
  "mechanism": "the-proxy-rewrites-a-protected-page-to-the-internal-page-src/app/session-check-unavailable/page.tsx-with-a-marker-request-header-only-that-rewrite-carries-and-that-page-throws; the-app-layout-the-page-level-session-checks-and-resolvers-and-the-reviewer-pages'-account-read-each-throw-the-same-error; a-direct-visit-to-the-internal-page-reads-no-session-cookie-or-row-and-is-the-ordinary-not-found-page",
  "headers": "the-sensitive-response-headers-every-other-answer-of-the-requested-page-carries"
}
```

**R3. `/contractDefaults/all:endpoint-whose-request-reaches-the-proxy's-session-check`**, new. Binds R4 once, to every endpoint it applies to, instead of repeating it on eight auth contracts.

```json
{
  "all:endpoint-whose-request-reaches-the-proxy's-session-check": "authContracts.session-check-unavailable-api-v1"
}
```

**R4. `/authContracts/session-check-unavailable-api-v1`**, new. The answer an app request gets in the same case: 503 `{"error":"unavailable"}`, from the proxy, before the route runs. It applies to the 77 endpoints under `/api/` whose requests reach the proxy's sign-in check, whatever their own sign-in mode; the 19 listed are passed before any session is read. Only a request that carries a sign-in cookie can get it.

```json
{
  "registeredBy": "owner-decision-2026-11-19-a-brief-failure-of-the-sign-in-service-is-not-treated-as-signed-out",
  "appliesTo": "every-registered-endpoint-under-/api/-whose-request-reaches-the-proxy's-session-check-whatever-its-auth-mode; the-proxy-passes-the-exceptRouteIds-before-it-reads-any-session-and-no-endpoint-outside-/api/-receives-it",
  "exceptRouteIds": [
    "auth.sign-up-submit",
    "auth.forgot-password-submit",
    "auth.reset-password-submit",
    "api.subject-access-request",
    "api.rights-activate",
    "api.withdraw",
    "api.third-party-subject-export",
    "api.future-person-claim",
    "api.future-person-claim-document-session",
    "api.future-person-claim-complete",
    "api.future-person-claim-objection",
    "api.future-person-export",
    "api.future-person-claimant-bind",
    "api.future-person-recovery-key",
    "api.future-person-correction",
    "api.future-person-analysis-stop",
    "api.future-person-own-correction-statement",
    "api.evidence-chunk",
    "api.evidence-complete"
  ],
  "when": "the-request-carries-a-Supabase-session-cookie-and-the-auth-service-did-not-answer-who-the-user-is-twice-250-ms-apart-as-pageAuthContract.authServiceUnavailable.unavailableCases-says; without-a-session-cookie-the-auth-client-answers-no-session-without-asking-the-service-so-a-signed-out-or-machine-request-without-one-never-receives-it; a-second-answer-of-no-session-or-of-a-user-is-answered-as-before",
  "unavailable": {
    "status": 503,
    "contentType": "application/json",
    "body": {
      "error": {
        "const": "unavailable"
      }
    },
    "unknownFieldsRecursively": "forbidden"
  },
  "effects": "the-proxy-answers-before-the-route-handler-runs-and-reads-no-profile-account-or-other-row; no-auth-cookie-is-removed-and-tokens-a-refresh-rotated-before-the-failed-read-are-kept",
  "headers": "sensitiveResponseHeaders.authenticatedUserData-with-the-Referrer-Policy-every-other-answer-of-the-route-carries",
  "redirectsForbidden": true
}
```

**R5 to R10. `/stateProfiles/<profile>/notApplicable/error`**, six reasons reworded. Each said that no request can drive the page into a fault. A failed sign-in check now can, without any request causing it, so each reason now says so, names the unit tests that prove it, and says why no browser test can (nothing can make the sign-in service fail on demand). `error` stays not applicable for the browser-proof count, as it already is for every page the error boundaries cover; nothing else in the profiles changed.

**R5. `/stateProfiles/product-result/notApplicable/error`.** Old:

> An unknown subject, person, pair, embryo or scope is answered with notFound(), so no request can drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12) — and there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

New:

> An unknown subject, person, pair, embryo or scope is answered with notFound(), so bad input cannot drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12). Since 19 November 2026 a fault that no request causes reaches these pages: when the auth service fails to answer the sign-in check twice, an authenticated page renders the existing error surface at the requested address instead of the sign-in or not-found page, while family.index renders its public branch as before (pageAuthContract.authServiceUnavailable; owner decision 2026-11-19, D-142). It is proven by unit tests (src/proxy.test.ts, src/app/(app)/layout.test.ts, src/lib/family/subject-route-auth-check.test.ts, src/app/(app)/embryos/context.test.ts, src/lib/supabase/auth-check.test.ts, src/lib/supabase/auth-check-sites.test.ts and src/app/boundaries.test.ts); no browser proof can be written, because nothing can make the auth service fail on demand, so here too there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

**R6. `/stateProfiles/own-product-result/notApplicable/error`.** Old:

> An unknown subject, person, pair, embryo or scope is answered with notFound(), so no request can drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12) — and there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

New:

> An unknown subject, person, pair, embryo or scope is answered with notFound(), so bad input cannot drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12). Since 19 November 2026 a fault that no request causes reaches these pages: when the auth service fails to answer the sign-in check twice, the proxy or the app layout renders the existing error surface at the requested address instead of the sign-in page (pageAuthContract.authServiceUnavailable; owner decision 2026-11-19, D-142). It is proven by unit tests (src/proxy.test.ts, src/app/(app)/layout.test.ts, src/lib/supabase/auth-check.test.ts and src/app/boundaries.test.ts); no browser proof can be written, because nothing can make the auth service fail on demand, so here too there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

**R7. `/stateProfiles/restricted-flow/notApplicable/error`.** Old:

> An unknown person, embryo or invitation is answered with notFound(), so no request can drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12) — and there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

New:

> An unknown person, embryo or invitation is answered with notFound(), so bad input cannot drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12). Since 19 November 2026 a fault that no request causes reaches these pages: when the auth service fails to answer the sign-in check twice, the page renders the existing error surface at the requested address instead of the sign-in or not-found page (pageAuthContract.authServiceUnavailable; owner decision 2026-11-19, D-142). It is proven by unit tests (src/proxy.test.ts, src/app/(app)/layout.test.ts, src/lib/page-account-context.test.ts, src/app/(app)/embryos/context.test.ts, src/lib/supabase/auth-check.test.ts, src/lib/supabase/auth-check-sites.test.ts and src/app/boundaries.test.ts); no browser proof can be written, because nothing can make the auth service fail on demand, so here too there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

**R8. `/stateProfiles/account-management/notApplicable/error`.** Old:

> These settings pages parse no parameter and no request can drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12) — and there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

New:

> These settings pages parse no parameter, so bad input cannot drive them into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12). Since 19 November 2026 a fault that no request causes reaches them: when the auth service fails to answer the sign-in check twice, the proxy or the app layout renders the existing error surface at the requested address instead of the sign-in page (pageAuthContract.authServiceUnavailable; owner decision 2026-11-19, D-142). It is proven by unit tests (src/proxy.test.ts, src/app/(app)/layout.test.ts, src/lib/supabase/auth-check.test.ts and src/app/boundaries.test.ts); no browser proof can be written, because nothing can make the auth service fail on demand, so here too there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

**R9. `/stateProfiles/settings-unbuilt-render/notApplicable/error`.** Old:

> These settings pages parse no parameter and no request can drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12) — and there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

New:

> These settings pages parse no parameter, so bad input cannot drive them into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12). Since 19 November 2026 a fault that no request causes reaches them: when the auth service fails to answer the sign-in check twice, the proxy or the app layout renders the existing error surface at the requested address instead of the sign-in page (pageAuthContract.authServiceUnavailable; owner decision 2026-11-19, D-142). It is proven by unit tests (src/proxy.test.ts, src/app/(app)/layout.test.ts, src/lib/supabase/auth-check.test.ts and src/app/boundaries.test.ts); no browser proof can be written, because nothing can make the auth service fail on demand, so here too there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

**R10. `/stateProfiles/auth-flow/notApplicable/error`.** Old:

> A failed sign-in, sign-up or reset renders its message inside the form, so no request can drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12) — and there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

New:

> A failed sign-in, sign-up or reset renders its message inside the form, so bad input cannot drive it into a fault — bad input answers notFound() and the product carries no fault, injection or simulate seam (re-measured 2026-09-12). Since 19 November 2026 a fault that no request causes reaches the two reviewer pages on this profile: when the auth service fails to answer the sign-in check twice, the page's account read throws and the root error surface renders at the requested address instead of the not-found page (pageAuthContract.authServiceUnavailable; owner decision 2026-11-19, D-142). It is proven by unit tests (src/lib/page-account-context.test.ts, src/lib/supabase/auth-check-sites.test.ts, src/lib/supabase/auth-check.test.ts and src/app/boundaries.test.ts); no browser proof can be written, because nothing can make the auth service fail on demand, so here too there is no browser proof to require. The four error boundaries and their unit coverage stand. Owner decision 2026-09-12.

### The strictest referrer setting on the whole route (R11)

What the owner decided: where the register names "send no referrer" for any answer of a route, every answer of that route gets it. The code has done this since 19 November on 24 endpoints. The register said it only for the answers those contracts describe.

**R11. `/sensitiveResponseHeaderBindings/wholeRouteReferrerRule`**, new, beside `antiFramingRule`. One rule, not 24 route edits:

```json
{
  "wholeRouteReferrerRule": "registered-2026-11-19-G8.5-the-strictest-referrer-setting-applies-to-the-whole-route: an-endpoint-under-/api/-that-a-profile-above-with-Referrer-Policy-no-referrer-binds-or-to-which-responseContractBindings.routes-binds-a-response-contract-whose-headers-name-no-referrer-sends-Referrer-Policy-no-referrer-on-every-answer-including-its-errors-and-the-proxy's-own-refusals-and-not-only-on-the-answers-that-profile-or-contract-describes; its-other-headers-are-still-the-ones-its-profiles-and-contracts-name (D-138-b-and-c)"
}
```

It is written for endpoints under `/api/`, which is where the code does it and `src/proxy.test.ts` checks it. Seven pages (`embryos.index`, `embryos.compare`, `embryos.detail`, `copilot.scope`, `genome.reports`, `family.index`, `family.portrait`) and the sign-out endpoint also have a bound answer that names no referrer while no profile binds them, and every signed-in page's sign-in redirect names it too. The rule does not claim them, because the product does not send it on their other answers; whether it should is a separate question.

### The Path A invitation's rate limit (R12)

**R12. `/securityRateLimitContract/bindings/routes`**: `api.subject-drafts` added after `api.invitations`. The Path A invitation counts against the same invitation-attempt limit as `api.invitations` (10 an hour and 30 a day per account, 30 an hour per network), which the database already enforces (`private.consume_invitation_attempt_quota_v1`). Only the Path A body uses it; the list has no place to say so, and the route's own `policy.pathAOneStepInvitation` already names the attempt quota.

Old list (excerpt): `"api.subjects", "api.invitations", "api.rights-activate"`. New: `"api.subjects", "api.invitations", "api.subject-drafts", "api.rights-activate"`.

## Checked and not changed

- **Sign-out keeps the rights session.** `/responseContracts/sign-out-v1/sessionEffect` and `auth.sign-out`'s `policy.transaction` already say the rights cookie is not cleared at sign-out (amended on the same day), and the code keeps it (`src/app/auth/sign-out/response.ts`). Nothing to change.
- **The internal error page `/session-check-unavailable`** has no route entry. It stays recorded in `docs/route-divergence.json`, with the reason: a route entry would need either a browser proof of its error state, which cannot be written, or a page with no state, which the page-density census refuses. R2 describes what it is.
