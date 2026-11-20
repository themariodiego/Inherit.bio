# Register amendments, 19 November 2026: the whole-route referrer rule for pages

Made under "Register amendments that only describe decided behaviour"
(`docs/protocol/decisions.md`, 19 November 2026). It writes down how the
owner's decision "G8.5: the strictest referrer setting applies to the whole
route" is carried out for pages and for the endpoints outside `/api/`. No
other register text changed.

## 1. `sensitiveResponseHeaderBindings.wholeRouteReferrerRuleOutsideApi` (new key, beside `wholeRouteReferrerRule`)

**Old:** no such key. `wholeRouteReferrerRule`, unchanged, says the rule for
endpoints under `/api/` only.

**New:**

> registered-2026-11-19-G8.5-the-strictest-referrer-setting-applies-to-the-whole-route, for-pages-and-for-endpoints-outside-/api/ (under-Register-amendments-that-only-describe-decided-behaviour): a-page-or-an-endpoint-outside-/api/-that-a-profile-above-with-Referrer-Policy-no-referrer-binds-or-to-which-responseContractBindings.routes-binds-a-response-contract-whose-headers-name-no-referrer-sends-Referrer-Policy-no-referrer-on-every-answer-including-its-not-found-error-and-redirect-answers-and-the-proxy's-own-redirects-rewrite-and-refusals-and-not-only-on-the-answers-that-profile-or-contract-describes-because-the-proxy-sets-the-policy-before-the-page-chooses-its-answer; its-other-headers-are-still-the-ones-its-profiles-and-contracts-name; authenticated-page-signin-redirect-v1-is-the-proxy's-own-answer-so-every-redirect-to-auth.sign-in-carries-no-referrer-exactly-and-it-does-not-change-the-Referrer-Policy-of-the-page's-other-answers (D-138-d)

**In plain words.** A page, or one of the three endpoints outside `/api/`, gets
`Referrer-Policy: no-referrer` on every answer when the register names that
policy for any of its answers. "Names" means one of two things, the same two
the `/api/` rule uses:
- a header profile with `no-referrer` binds the route; or
- a response contract bound to the route in `responseContractBindings.routes`
  names it in its `headers`.

"Every answer" covers the page itself, its not-found, error and redirect
answers, and the proxy's own redirects, rewrite and refusals. The other
headers stay the ones the route's profiles and contracts name.

The sign-in redirect is different. The proxy builds that answer itself, so it
can give it `no-referrer` exactly. Every redirect to sign-in carries it, and
the page's other answers keep their own policy.

**The routes it covers today (15).** The code and the register-driven test in
`src/proxy.test.ts` both give this set:
- the seven pages with a bound contract that names `no-referrer`:
  `embryos.index`, `embryos.compare`, `embryos.detail`, `copilot.scope`,
  `genome.reports`, `family.index`, `family.portrait`;
- the five pages a `no-referrer` profile binds: `rights.withdraw` (which also
  has bound contracts), `auth.sign-in`, `auth.sign-up`, `auth.forgot-password`,
  `auth.reset-password`;
- the three endpoints outside `/api/`: `auth.callback` (profile and contract),
  `auth.sign-out` (contract) and `rights.withdraw-request` (profile and
  contract).

**Why this only describes decided behaviour.** The decision's own sentence
covers every route ("Where the register names no-referrer for any answer of a
route, every answer of that route gets it, and the register is amended to say
so"). The sign-in redirect clause states what its contract,
`authenticated-page-signin-redirect-v1`, already says (`headers:
private-no-store-no-referrer`). The decision's premise is that the system can
set the policy only per route. That premise does not apply to the one answer
the proxy builds itself, so that answer takes the contract exactly.

**Not covered, and not claimed (for the owner).** `resource-not-found-page-v1`
also names `no-referrer`. The register binds it to 20 more pages another way:
through `resourceAuthorizationBindings.failureContractBySurface.page` (and
`responseContractBindings.resourceAuthorizationBindings.page`), not through
`responseContractBindings.routes`. Those pages are `app.overview`,
`embryos.request-data`, `embryos.upload`, `family.health-picture`,
`family.invite`, `family.permissions`, `family.person`, `files.index`,
`files.upload`, `genome.ancestry`, `genome.browser`, `genome.carrier`,
`genome.data`, `genome.report`, `genome.subject`, `settings.consents`,
`settings.copilot`, `settings.data`, `settings.index` and `settings.people`.
The new rule, like the `/api/` rule, does not read that binding. So these
pages, and their not-found answers too, keep `same-origin`. `src/proxy.test.ts`
pins this list as OPEN.

## No other change

- `sign-out-v1`, `auth-callback-v1`, the `authCallback`, `authOrRecovery` and
  `tokenPageOrEndpoint` profiles, `family.index` and
  `pageAuthContract.publicOrAuthenticated` are unchanged. The code now does
  what they already said.
- `family.index`'s `notApplicableStates.consent-required` and its binding to
  `portrait-grant-denial-v1` (`responseContractBindings.routes`) contradict
  each other. That is noted in the report and not changed. The binding is
  what puts `/family` in the set.
- The register is hand-formatted. The edit added one line after line 9279 and
  a comma to the end of that line, and nothing was re-serialised.
  `json.load` reads the file.
