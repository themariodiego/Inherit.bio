# Original-file storage: decision after the resumable proof

The approved plan keeps originals in Supabase and adds bounded TUS transfer.
The [empty-upload proof](resumable-upload-contract.md) found a public offset-read
bypass. The provider's exact incomplete-upload cleanup is also unproven. A
gateway that hides a URL cannot enforce authorization at the still-public
known-URL endpoint. These findings require a revised design before activation.

## Recommended: qualify a private R2 backend for new resumable originals

Keep existing files and their readers in Supabase. Introduce a separate,
explicit transport/provider version for new uploads, with a private,
EU-restricted preview bucket and a Cloudflare Worker as the only byte endpoint.
No provider credentials, public bucket, presigned write URL or provider upload
handle would reach the browser. The prepared-artifact bucket would remain
separate. This proposal does not migrate existing originals or activate production.

The initial work is a bounded synthetic qualification, followed by repository
integration only if its provider contract passes. It must establish:

1. Current account, originating session, subject, consent and jurisdiction
   authority on creation, offset reads, each chunk and finalization.
2. Durable tracking of every attempt and provider operation, including a
   creation or completion whose response is lost. No new attempt may silently
   replace an uncertain one.
3. Exact reconciliation and deletion of multipart uploads, parts and completed
   objects after revocation or expiry, including writes already in flight.
   Cleanup must prevent later payload reappearance and finish within the
   existing two-hour staging deadline. The preview retention dispatcher must
   be proven active before file bytes are sent.
4. Integration with whole-file hash, format and decoded-size validation,
   preparation reads, file/account deletion, original retirement and export.
   R2 metadata must not be presented as a Supabase `storage.objects` record.

R2 exposes [multipart inventory and abort operations](https://developers.cloudflare.com/r2/api/s3/api/)
for its own backend. That makes it a candidate for a directly testable cleanup
contract. It does **not** establish the in-flight guarantee. Its documented
[consistency model](https://developers.cloudflare.com/r2/reference/consistency/)
allows the last concurrent operation to finish to determine the outcome;
deleting and immediately seeing an empty key is insufficient while an earlier
completion is outstanding. The qualification must resolve that race, including
coordinator crashes, or stop without activation.

All current limits remain: the thirty-minute upload lease, two-hour staging
purge, configured file/account/concurrency limits, one-hour preparation bound,
4,096 artifacts and 1 GiB of prepared artifacts. No cross-attempt preparation
resumption is included. Successful transfer is not proof that 2 GiB VCF or
8 GiB gVCF can be prepared; each needs a later complete measured journey.

## Expense boundary

Allocate **at most USD 8 of the existing USD 50 cap** to this first qualification,
including gateway, coordinator, storage, operations and retained resources.
Reconcile existing usage and conservative reservations before any paid action;
stop before the cap. This is a proposed sub-budget, not a spending receipt.
Use the existing plans and small synthetic inputs; no large capacity run or
plan purchase is included in the first qualification.

Current published [R2 Standard pricing](https://developers.cloudflare.com/r2/pricing/)
is USD 0.015 per GB-month, USD 4.50 per million Class A operations and USD 0.36
per million Class B operations, with free egress. Included allowances and
rounding affect the actual invoice; multiplying a handful of requests by the
unit rate is not a guaranteed bill. [Worker request/CPU](https://developers.cloudflare.com/workers/platform/pricing/)
and [Durable Object request/duration/storage](https://developers.cloudflare.com/durable-objects/platform/pricing/)
costs, database traffic and logging are additional. The reservation must cover
those together rather than assuming any unqueried charge is zero.

## Alternative: keep Supabase originals and obtain a provider repair

Keep the approved backend and wait for a supported, verifiable way to enforce
authority on all direct TUS operations, plus exact cleanup after permission
expires. The required cleanup covers hidden partial tails and completed but
unpublished objects, without relying on a 24-hour URL or lifecycle timeout.
Source revision and database migration names alone are insufficient evidence.
No support message has been sent on the owner's behalf.

A Supabase S3 gateway could avoid the TUS HEAD route, but its public multipart
ledger is not proven to capture every physical upload after a lost creation
response. It still needs a provider cleanup contract and is not an established
shortcut around this decision.

The owner decision is whether to authorize the R2 qualification or retain
Supabase while obtaining those provider capabilities. A backend switch and
multipart implementation need this decision because the approved proposal
explicitly chose Supabase TUS. Read-only investigation, the proof harness and
hardening existing direct-upload grants can continue independently.
