# Register amendments, 22 November 2026 (G8.5, code to register)

One key changed in `docs/route-register.json`, edited as text on its one line (line 9284); nothing re-serialised, no other byte changed (`git diff --stat`: 1 line). The file still parses.

## Changed: `sensitiveResponseHeaderBindings.wholeRouteReferrerRuleOutsideApi`

Owner decision of 22 November 2026, "Twenty signed-in pages keep `same-origin`; the not-found contract's header binds its own answer" (`docs/protocol/decisions.md`). The clause is appended and marked `registered-2026-11-22-G8.5`; the text before it is unchanged.

**Old text:**

```
registered-2026-11-19-G8.5-the-strictest-referrer-setting-applies-to-the-whole-route, for-pages-and-for-endpoints-outside-/api/ (under-Register-amendments-that-only-describe-decided-behaviour): a-page-or-an-endpoint-outside-/api/-that-a-profile-above-with-Referrer-Policy-no-referrer-binds-or-to-which-responseContractBindings.routes-binds-a-response-contract-whose-headers-name-no-referrer-sends-Referrer-Policy-no-referrer-on-every-answer-including-its-not-found-error-and-redirect-answers-and-the-proxy's-own-redirects-rewrite-and-refusals-and-not-only-on-the-answers-that-profile-or-contract-describes-because-the-proxy-sets-the-policy-before-the-page-chooses-its-answer; its-other-headers-are-still-the-ones-its-profiles-and-contracts-name; authenticated-page-signin-redirect-v1-is-the-proxy's-own-answer-so-every-redirect-to-auth.sign-in-carries-no-referrer-exactly-and-it-does-not-change-the-Referrer-Policy-of-the-page's-other-answers (D-138-d)
```

**New text** (the old text, then):

```
; registered-2026-11-22-G8.5 (owner decision: twenty signed-in pages keep same-origin; the not-found contract's header binds its own answer): a-response-contract-bound-to-a-page-through-resourceAuthorizationBindings (failureContractBySurface.page, mirrored-in-responseContractBindings.resourceAuthorizationBindings.page: resource-not-found-page-v1) sets-its-headers-on-the-answer-it-describes, the-page's-not-found-answer, only, and-not-on-every-answer-of-the-page; this-rule-does-not-read-that-binding, so-a-page-it-binds-whose-other-statements-name-no-referrer-for-no-answer keeps-on-its-other-answers-the-Referrer-Policy-those-statements-give-them (same-origin-for-an-authenticated-page)
```

## Not amended (and why)

- `policy.sameOriginRequired` on `api.subject-upload-issue` and `api.file-delete`: unchanged. The owner's decision "Change requests are refused without the browser's same-origin marker, before the account is read" says "The register is not amended"; the code now does what both values say.
- `resourceAuthorizationBindings.failureContractBySurface.page`, `responseContractBindings.resourceAuthorizationBindings.page` and `responseContracts.resource-not-found-page-v1` (`headers: private-no-store-no-referrer`): unchanged. The decision changes only which answers the rule reaches.
- The four former plain-text 401s (`api.export` legacy GET, `api.file-download`, `api.file-process`, `api.account-delete`): nothing to amend; the code now answers `authenticated-api-v1.unauthenticated`, which the register already bound.

## For the register agent (not done here; the owner's call)

- The amended rule says the contract "sets its headers on the answer it describes". The not-found answer of the twenty pages carries the proxy's HTTP `Referrer-Policy: same-origin` and sets `no-referrer` for its own document with `<meta name="referrer" content="no-referrer">` (see `conf-defect-note.md`, item 1). If the register should say which of the two it means for a page answer chosen after the proxy has run, that is a further amendment the owner has not been asked for.
- `api.subject-upload-issue`'s handler refuses a missing `Origin` (with an unregistered body `{"error":"forbidden"}`), which is stricter than `sameOriginRequired`; unchanged here (see `conf-defect-note.md`, item 3).
