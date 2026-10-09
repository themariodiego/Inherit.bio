# Export late-write boundary: decision proposal

This is a review proposal. It changes no registered contract, backend,
retention rule, production setting or availability flag.

The current export contract selects `storage.export-v1`, bucket `exports` and
`{principal_hash}/{export_id}/{attempt_id}-{ordinal}.part`
(`docs/route-register.json:21379`). Its logical archive is one complete ZIP64,
with create-only private whole objects of at most 4,000,000 bytes, exact ordered
manifest membership and a fixed 24-hour artifact deadline. Its cleanup clause
requires every reserved key, including uncertain writes, to remain inventoried
until late-write fencing and exact provider disposal are proved
(`docs/route-register.json:3127`). `docs/retention.md:48` says to delete the
private archive object and delivery row. The Charter promises every own report
and source for free and complete deletion within 30 days
(`docs/inherit-v2-brief.md:1764`, rights 1 and 3).

The existing owner A decision is expressly about embryo upload objects:
“Embryo upload cleanup must be proved, not assumed” and “Accepting the fence
alone, or a different notice for such cohorts, was declined.”
(`docs/protocol/decisions.md:4266`). It moves those objects to R2 with
create-only writes and placeholders at uncertain keys after the fence.
That decision is not treated as blanket export authorization here.

The existing repository documents the same unresolved export prerequisite:
`docs/async-export-delivery-core.md:113` explains that a submitted object write
may finish after cancellation and that a service-role metadata fence does not
prove physical absence. `docs/embryo-fragment-storage.md:21` keeps uncertain
Supabase writes unresolved. The actual export cleanup RPC preserves every
reserved key and cannot currently acknowledge provider-fenced absence;
`private.guard_segmented_export_publication_v1` keeps all segmented READY
results closed (`supabase/migrations/20260923123240_export_archive_persistence.sql:529`).

Current [Supabase uploader source](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts)
explicitly completes its metadata transaction after an upload body has finished,
even after request abort. Failed metadata completion schedules `ObjectAdminDelete`;
that is not a conclusive response proving the payload disappeared. These are
upstream facts, not proof about an exact deployed image. The [documented deletion API](https://supabase.com/docs/guides/storage/management/delete-objects)
is required for actual provider deletion; SQL metadata removal alone is not
an object deletion proof. Existing metadata and client timeout tests cannot
clear this missing provider boundary.

A bounded R2 alternative would reuse the existing upload signing JWK and its
public-key gateway verification, with a distinct `inherit-export-segment-v1`
audience. It needs a new private `inherit-export-*` bucket and export gateway
origin; those configuration values are not secrets. Cloudflare provisioning
and deployment use the operator's existing credentials. No new owner signing
secret, caller Storage key or browser provider token is introduced. The
application remains TEST-LOCAL and availability OFF until full verification;
production deployment stays a separate guarded action.

The SQL segment reservation would retain its logical ordinal/offset/key and
also allocate a distinct random provider object UUID before any write. R2's
physical key would be only `export/<opaque-storage-UUID>`: no principal,
subject, export, attempt, filename or genetic digest. The private durable row
owns the exact mapping, provider version, ETag, byte size and SHA-256. The
client still downloads the same logical ZIP and at most 4,000,000 plaintext
bytes per chunk through the same revocable application endpoint. Every write
is conditional create-only, each ACK follows an exact version read to EOF,
and every content/delivery step rechecks the unchanged originating session,
claimant/source receipt and attempt.

After cancellation or fixed expiry, SQL would close every write window before
cleanup. Cleanup atomically replaces every exact reserved physical key, whether
ACKed or uncertain, with a permanent zero-byte marker and verifies its current
version and empty hash. A late conditional write cannot overwrite that marker.
All archive bytes, identity-bearing mapping, delivery rows, member descriptors
and temporary signing capabilities are removed under the existing deadline;
only the unrelated opaque marker remains. This is the existing R2
`payload-tombstoned` disposition: it proves no current payload and no future
create-only restoration. It does not claim key absence or physical-media
forensics. The permanent marker is a storage fencing artifact, and its
retention must be registered explicitly if this alternative is approved.

Approval would therefore require a narrow backend/namespace/disposition
extension to `largeExportDeliveryContract.archiveRepresentation`,
`storage.export-v1`, the internal worker/provider fields and the artifact
retention entry. It would preserve the logical ZIP, member completeness,
server-only selection, chunk and nonce contracts, 24-hour bound, original
storage backends and the account publication hold. No R2 implementation or
contract edit proceeds from this proposal alone. Continuing independent work
covers complete known figure/report projection and strict whole-object read
transport; uncertain Supabase disposal and public READY remain closed.
