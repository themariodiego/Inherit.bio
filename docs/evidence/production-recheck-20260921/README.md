# Production, rechecked from outside · 21 September 2026

The standing checkpoint says production was verified on 15 September by six
public browser checks, and to recheck the live state rather than infer it from
a merge. This folder is that recheck, taken on 21 September at about 17:05 UTC
against `https://www.inherit.bio`. Everything here is **anonymous and
read-only**: unauthenticated HTTP requests to public paths and to guarded ones
that are expected to refuse. No account was used, no write was attempted, and
nothing in the Inherit project (`zuvloczwgrayonqabnss`) was changed.

This recheck is not a browser suite and does not stand in for one. It cannot
see rendering, focus order, contrast or anything that needs a DOM. What it can
do is confirm, on the deployed origin, promises the repository otherwise proves
only in CI.

## What is serving

| Path | Status | Bytes |
| --- | --- | --- |
| `/` | 200 | 45,459 |
| `/about` | 200 | 53,520 |
| `/privacy` | 200 | 78,861 |
| `/terms` | 200 | 67,747 |
| `/providers` | 200 | 230,893 |
| `/.well-known/inherit-upload-jwks.json` | 200 | 208 |

## The upload signer's public key is public, and only public

PR #136 shipped the JWKS endpoint. On production it serves **one** key:
`kty=EC`, `crv=P-256`, `alg=ES256`, `use=sig`. Checked explicitly for private
material — none of `d`, `p`, `q`, `dp`, `dq`, `qi` is present on the key. A
signing key published with its private half would be the worst possible
outcome of that change, so it is checked by name rather than assumed from the
byte count.

## G1.7's promise holds on the deployed origin

G1.7's evidence records `assertNoThirdParty` proving, over all 62 kept pages in
both themes, that no unexpected origin is contacted and that none of
`window.fbq`, `window.gtag` or `window.dataLayer` is defined. That proof runs
in CI, against a locally built application. It has never been taken against
what `www.inherit.bio` actually serves.

Taken now, over the five public pages above, against **all 27** tracker host
fragments `TRACKER_HOST_FRAGMENTS` carries in `e2e/helpers.ts` rather than a
few chosen by hand — the vendor names are not restated in this document,
because the no-comparator name gate is right to refuse one that spells them
out and the shared constant is the one place they belong:

- **Zero external script hosts.** Not one `script` element carries a `src` to
  any origin but this one, on any of the five.
- **Zero** occurrences of the three globals the brief names, `fbq`, `gtag` and
  `dataLayer`.
- **Zero** of the 27 fragments inside any `src` attribute on any page.

**Two prose matches, and they are the promise rather than a breach.** A
case-insensitive scan of the whole served HTML — a blunter instrument than the
real test, which watches request origins and window globals — hits one vendor
name twice on `/privacy`. Both are inside the policy's own sentence saying
there are no third-party trackers of any kind, which names the vendors in
order to be unambiguous about it. Neither is in a `src`, a link or a script.
Counted and explained rather than reported as zero, because a later scan will
find them again and should not read them as a regression.

This does not close G1.7. That row is held by the (route, state) ratchet, not
by origin coverage, and five pages are not 62. What it adds is that the
promise is true of the deployment and not only of the build.

## Guarded surfaces refuse, and refuse in the right order

| Request | Answer | Why that is right |
| --- | --- | --- |
| `POST /api/embryo-cohorts` | `401 Unauthorized`, 12 bytes | The sensitive account context is read first, so an anonymous caller learns nothing about jurisdictions, cohorts or capability. |
| `GET /api/export` | `401 Unauthorized`, 12 bytes | Same shape. |
| `POST /api/account/delete` | `400 {"error":"invalid_request"}` | **Not** an ordering fault. `isSameOrigin` is the first line of the handler, and the request carried no `Origin` header, so the cross-origin guard fired before anything was parsed or authenticated. Rejecting a cross-origin request to the deletion route before touching it is the correct order. |
| `GET /api/embryo-ingest/{uuid}/complete` | `404` | The route declares no `GET`. |

The 400 is recorded with its reason because the three answers differ and a
later reading could take the odd one out for a leak or a missing auth check.
It is neither.

## The public Embryo page is fail-closed, as its profile requires

`/embryo-analysis` carries the `public-embryo-analysis` state profile, whose
`jurisdictionUnavailable` clause requires a 200 with the fail-closed capability
copy and the future-person rights link, and zero user result, cookie or subject
fetch. It serves 200 with title `Embryo Analysis · Inherit`, and its text
carries "not available", "review", "future person" and "rights". That is the
refusal the profile describes, served to an anonymous reader.

## What this does not establish

No verdict moves. The matrix is **38 YES / 27 NO** before and after. In
particular this says nothing about any authenticated journey, about rendering
or accessibility, about the two migrations production is behind by (recorded
separately as D-132), or about G1.7, which stays NO on the route/state ratchet.
