# Embryo preview service setup — source proposal, 2 October 2026

This is TEST-LOCAL source preparation for the owner's existing-services choice.
The owner handles their remaining setup on 5 October. No deployment, environment
change, database operation, credential creation or email delivery follows from
this document or its offline guard. Production jurisdiction and embryo admission
remain held; the global deployment switch and workflow are unchanged.

## Existing access and exact preview scope

The existing Vercel project is `inherit`, project
`prj_K7bVowhjFr0uIapXraH41hthJkgy`, team `mariodiego`. Its preview Supabase origin
is `https://iofjhrtcyawjjhuxbgfd.supabase.co`; the fragment capability issuer is
that exact origin plus `/auth/v1`, as the existing upload signer constructs it.
The prepared gateway remains
`https://inherit-prepared-artifacts-preview.mariodiego-dev.workers.dev`.
No prepared bucket or Worker configuration changes.

The lead created only `inherit-embryo-preview` in the existing Cloudflare account
`165b6ad801f990d009e90b64b39f87dd`, with source-config update disabled. The retained
settings reads report Standard, WEUR, zero objects and disabled `r2.dev` access.
The CORS API answered code 10059, "configuration does not exist". The only
reported lifecycle action aborts incomplete multipart uploads after seven days;
it does not expire stored objects or markers. The independent settings receipt
at 18:58:02 UTC confirms no custom domains, CORS configuration or object-expiry
rules, SHA-256
`a2b594c228744738a9fe4e03a0172ae95eab05f30d2539e5581c457de46b5501`.
Bucket existence and these settings do not prove a hosted object acknowledgement.

`workers/embryo-fragments/wrangler.json` proposes precisely one explicit preview
Worker, `inherit-embryo-fragments-preview`, with `FRAGMENTS` bound to that bucket.
The top-level default has no bucket binding, no routes, no issuer, no public
keys and `workers_dev: false`. The preview repeats its own variables and binding;
Wrangler does not inherit those keys between environments. Explicit bucket names
avoid automatic resource provisioning. Observability and preview URLs are off.
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

Only public P-256 key `4d1d178c-3f0c-41d0-902f-788c83fdef3d` is admitted in this
preview source. It derives exactly from the separately retained authenticated
Vercel JWKS read at 18:54:02 UTC on 2 October, response SHA-256
`983b9d46559a2e7947cd466bcece738e70406884c82e639a7640ddc9c5a3f90f`.
Ordinary unauthenticated access returns 302; that refusal is retained.
Use the established authenticated connector to obtain the public document.
Do not follow its sign-in redirect, use Supabase Auth keys in its place, infer a
private key, copy a credential into source, or learn an issuer from traffic.

## Review and later setup sequence

1. Review this exact source and its complete preservation receipt. Run the
   offline `scripts/embryo-preview-source-guard.ts` with target `preview` and the
   independently verified public JWKS file. It compares the complete public
   identity set and closed config; it does not prove fetch provenance, freshness,
   deployment or storage behavior. Re-fetch and compare the current signer
   immediately before any later deploy or rotation.
2. Recheck the independently observed bucket settings before actual proof: no
   public custom domain, object-expiry lifecycle or CORS rule, and a permanently
   retained marker policy. Use the
   existing account and pinned Wrangler 4.134.0. A production bucket, default
   target, additional binding, signer, cron, service or deployment automation is
   outside this preview proposal.
3. After separate source/setup review, deploy only the explicit preview target
   if the lead authorizes that execution. Verify the actual deployment origin
   equals `https://inherit-embryo-fragments-preview.mariodiego-dev.workers.dev`.
   Then propose only the preview app's `INHERIT_EMBRYO_R2_ORIGIN` and
   `INHERIT_EMBRYO_R2_BUCKET=inherit-embryo-preview`; their current values are not
   changed here. No additional private signing material is needed in the gateway.
4. Inventory the preview database before any backend selection. Its branch is
   marked `MIGRATIONS_FAILED`; manual replay was recorded through
   `own_journey_preview_20260923_phase_b`. That is not a current full-schema
   qualification. Do not reset it, replay migrations or update its backend from
   this plan. Review exact deployed functions against qualified source first.
5. Run the actual synthetic own-flow checks through current application/SQL
   authority, with scanner host and worker keys and the isolated email callback.
   Their contracts and all existing browser assertions stay unchanged. The owner
   has not waived the full journey, scientific review or production obligations.

## Actual storage evidence still required

The unchanged gateway accepts only signed fragment/relocation operations and has
no listing, delete, CORS or token endpoint. Reads compare the current object's
version, ETag and size. A create-only write is checksum checked. An empty marker
is read to EOF and fences a late create-only write; relocation also requires the
empty ETag. These are source semantics, not hosted evidence.

Retain actual signed PUT receipts, complete independent GET bytes/hash/size,
lost-response same-byte replay, wrong-version/ETag refusals, and an empty-marker
receipt/readback followed by a refused late write. Verify the actual provider
version meets the existing 32-hex contract; the documentation describes an
opaque upload identifier rather than promising that spelling. A disagreement
is a source compatibility issue, never permission to fake a receipt.

Independent inventory needs a reviewed provider data-plane reader. Complete
pages using the provider's `truncated`/cursor contract, not a guessed page size.
Do not add public listing authority to this gateway or treat bucket statistics,
an in-memory binding, one zero-byte read or SQL ACK as independent inventory.
The provider API supplies current-object version metadata; this plan claims no
historical-version recovery or physical-media erasure. Empty markers remain.
[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

The current reads identify no additional missing owner credential or new
service choice for this source phase. The settled 5 October setup commitment,
CFTR-first review order and report-source reviewer choice stay recorded in the
decision ledger. The lead must review source and finish actual service proof.
The owner still performs their actual source/condition reviews. If a later
provider check reveals a specific account control unavailable through existing
access, record that exact step then. Do not invent a setup question now. These
steps are not a production release date or a completed review.
