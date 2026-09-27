# Resumable upload contract · 22 September 2026

The owner approved the [bounded transfer proposal](large-file-upload-proposal.md).
Its first provider check found a real authorization gap. The app's upload grant
can create an empty resumable upload, but the public project key can read its
offset and declared size when given its upload URL. Resumable transfers must
therefore remain unactivated while the authority and cleanup path is completed.

## Measured on the isolated preview

At 16:39 UTC, the unchanged preview app issued a thirty-minute, create-only
upload grant for 512 declared bytes. The probe used its existing synthetic
account and submitted an empty TUS creation request to the direct Storage host.
It sent **zero source bytes**. No file was finalized and no preparation started.

| Request | Observed response |
| --- | --- |
| Create with the dedicated upload grant, empty body | 201 |
| Read offset with that grant | 200, offset 0, declared length 512 |
| Read offset without a bearer | 400 |
| Read offset with the public anonymous bearer | 200, offset 0, declared length 512 |
| Terminate with the still-live upload grant | 204 |
| Read offset after termination | 404 |

The public bearer does not represent the account, originating session, subject
or consent. The successful read therefore fails the proposal's authority rule.
This is disclosure of upload metadata to a caller who knows the provider URL;
it is not evidence that this caller can read DNA or write a chunk. Missing JWT
authentication was rejected in this probe.

The [timestamped receipt](evidence/hosted-proof-20260919/journeys/resumable-empty-authority-20260922.json)
contains statuses and fixed fields, without credentials or the provider upload
URL. The deployed Storage application revision was not exposed by the responses.
Its database migration names do not identify that revision.

At 16:40:23 UTC, read-only SQL found no completed object or finalized file for
this attempt. The ordinary upload row remained `issued`, with its existing
staging-purge deadline at 18:39:14 UTC. TUS termination does not itself remove
that app row. No metadata deletion, expiry change or cleanup job was forced.
The termination response and later 404 are protocol acknowledgements; they
do not prove the absence of every physical backend fragment.

A later read-only check at 21:08:30 UTC still found that row `issued` and its
retention phase `pending`, past the recorded 18:39:14 deadline. No completed
object or finalized file existed. This is a missed app retention-phase deadline
for an empty probe; it does not establish residual DNA or identify why the
deployed scheduler had not advanced that phase. No cleanup was forced.

## Gate before sending file bytes

The provider source review must cover the exact deployed backend and library
versions. In particular, an incomplete upload, a partial final chunk, a
completed backend object awaiting its database commit, and a rejected completion
are different physical states. An empty `storage.objects` result or an offset
equal to the declared length cannot prove either publication or deletion.

The current app cleanup calls object removal for its two exact staging/final
names. It does not inventory or abort provider multipart uploads. Its staging
contract is **created_at plus two hours**, with cleanup eligible after the
existing upload lease expires. The provider's documented upload-URL lifetime of
up to 24 hours is not a substitute for that retention deadline.

Before any file-byte proof, obtain an authenticated, exact-attempt inventory
and deletion acknowledgement covering the provider upload, temporary metadata,
partial chunks and every completed version. Prove cleanup after cancellation,
lease expiry, consent/session revocation, conflicting writers and a completion
race. The cleanup authority must survive loss of upload authority while being
incapable of granting a new upload. A cleanup error must retain its manifest and
remain a failure; do not acknowledge success from an empty database listing.

The source review found concrete reasons to test these boundaries. These are
findings at pinned upstream revisions, **not a claim about the preview's
unknown runtime version**:

- [Storage's TUS lifecycle](https://github.com/supabase/storage/blob/0e7910fc85e974d494230015eee7cfa9d9b4d38d/src/http/routes/tus/lifecycle.ts#L106)
  skips the per-object permission probe on HEAD. DELETE uses the same INSERT
  permission probe as writes. The current app guard cannot simply replace a
  revoked grant with a service bearer: its completion path requires an exact
  stored size and live authority. A separate cleanup capability is needed.
- [The pinned S3 adapter's removal method](https://github.com/tus/tus-node-server/blob/57b1be9bcb01c035bdc30aa1658db36197a409cb/packages/s3-store/src/index.ts#L700)
  aborts the multipart upload and deletes its object and `.info` metadata, but
  omits the `.part` tail written for a short incomplete chunk. Its expiry scan
  enumerates multipart uploads. Once the upload has been aborted, that scan
  may no longer find the separate tail. No such tail was sent in this probe.
- [The provider's public S3 listing](https://github.com/supabase/storage/blob/0e7910fc85e974d494230015eee7cfa9d9b4d38d/src/storage/protocols/s3/s3-handler.ts#L385)
  reads its S3 protocol database ledger. The TUS adapter creates multipart
  uploads directly in the backend. Empty ledger rows therefore do not prove
  an empty TUS backend, and public S3 abort has not been established as its
  physical cleanup API.
- [The TUS PATCH handler](https://github.com/tus/tus-node-server/blob/affc5ead329422caec9567fb9e9f6bdff47fd611/packages/server/src/handlers/PatchHandler.ts#L100)
  releases its lock before the completion hook. Physical completion and app
  publication remain separate events. Cleanup must handle a completed object
  whose database admission fails; a failed request alone is not deletion.

## Provider boundary and required gateway contract

A gateway alone cannot repair the measured upstream behavior. If a provider
URL becomes known, the public endpoint still accepts an anonymous offset read.
The current browser-visible direct-storage grant can also create TUS uploads
outside a gateway, as this probe demonstrated. Keeping its original client
unchanged therefore requires a provider-enforced transport restriction; hiding
new URLs does not close that older entry point.

Before activation, the provider must enforce current authority on known-URL
offset reads and bind or deny direct TUS creation/continuation for legacy
grants. The available source exposes operation-specific policy helpers that
may restrict permission probes; that capability still needs deployment
verification and does not add an authorization check to the HEAD path. A
provider repair or a separately approved storage architecture is required if
these boundaries cannot be enforced.

The gateway requirements below apply only with that provider boundary proven.
They describe implementation work, not an activated endpoint or a size promise.

1. Negotiate an explicit new transport version in issuance and its closed
   receipt. Keep the existing direct-storage version and its measured request
   ceiling for older clients. The gateway never sends a provider upload URL or
   provider bearer to the browser, its logs or an error body.
2. Bind a durable, opaque attempt handle to the exact account, originating
   session, subject, current consent, authority revisions, staging name,
   declared size/hash and original lease expiry. Check current authority on
   creation, offset reads, every chunk and completion. The handle is an
   identifier, never authorization. A public project key or ordinary login
   bearer alone cannot create raw storage objects.
3. Keep provider credentials server-side and scoped to that exact staging
   object. Accept only bounded, serial chunks at the verified offset, with no
   overwrite, alternate object path or cross-attempt adoption. Reject redirects
   and untrusted provider locations. Persist the provider identity and cleanup
   reservation before accepting bytes; resolve an uncertain creation without
   silently creating an untracked second upload.
4. Use six-MiB chunks where required by the verified provider version, bounded
   retries inside the same thirty-minute lease, explicit cancellation and no
   persistent browser credential store. Track admitted writers until they
   finish or are drained. Revocation must prevent new work; a writer that was
   already admitted cannot be assumed gone because its metadata lease expired.
5. Complete through the existing whole-file format, stored/decoded-size and
   hash validation. A full offset is not a finalization receipt. Preserve all
   account, concurrency, preparation-time and artifact limits. No report or
   capacity claim follows from storage completion alone.
6. Use a distinct, manifest-bound cleanup authority after revocation/expiry.
   It must cover unfinished uploads, partial tails and completed versions,
   including a writer that finishes while cleanup runs. Record physical
   acknowledgements and meet the unchanged two-hour staging deadline before
   enabling this transport. The owner retains production activation and
   preview teardown.

## Cost and verification boundary

The empty probe reserved USD 1 under the owner's USD 50 incremental cap. A
separate USD 40 reserve covered prior work, retained resources and billing
uncertainty. Those are planning reserves, not charges or an exact remaining
balance. No plan was bought and no container or preparation was launched.

A gateway would add request handling, current-authority checks and durable
attempt/cleanup records. At six MiB per chunk, a complete 2 GiB source needs at
least 342 chunk requests, and an 8 GiB source needs at least 1,366, before
creation, offset checks, retries, finalization and cleanup. These counts follow
from byte division, not a benchmark. Hosting, database traffic and egress must
be priced for the chosen gateway before activation and reserved within the same
cap. No larger paid transfer or inference run is authorized by this receipt.

The remaining proof matrix is: interrupted transfer/continuation, exact path
and length rejection, wrong account/session/subject, ordinary-login refusal,
consent revocation, real expiry, concurrent writers, cancellation, finalization
integrity and physical cleanup in every terminal state. These cases are still
unmeasured. Successful fixtures or source inspection cannot mark them passed.
