# Archive persistence: an intermediate database slice

This migration is authored but has not run locally or on a provider. It does
not activate a route, worker, scheduler, Storage upload or browser download.
G5.6 remains incomplete. The existing synchronous export route is unchanged.

The new RPCs extend `generated_exports` and reuse `own_export_source_v1` for
actual Auth, originating session, profile, own subject and source checks.
Account discovery examines the whole registered partition set. A nonself
subject, unsupported bound subject, cohort (including an evidenced parent),
pair or foreign directional grant refuses the whole request. A file that the
current selector cannot read also refuses the request; it is not left out.
Independent rights and reviewer origins explicitly refuse until their real
projection and authority path exist. The original account foreign key remains;
an uploader account is never substituted for an independent claimant.

The reachable path captures own adult metadata and source identities, stores a
queued job, and accepts fresh attempts under the current SQL-derived receipt.
The receipt binds the originating session and account revisions, exact subject
bindings, file source snapshots, grants, signatures, artifacts, consent clocks
and captured analysis rows. It is not an archive member manifest. Complete
account history, every permitted joint partition and the final ZIP member set
still need their real producer and final publication proof.

`export_archive_request_v1` supports capture, create, check and open-ready.
Create consumes the exact verified operation nonce in the same transaction as
the job and stores only the export cookie hash. The server must first verify
the signed token and the separate session-bound CSRF header; SQL rechecks its
scope, current receipt and five-minute lifetime. Check requires that exact
cookie and creates nothing. Open-ready also needs its own fresh nonce and a
separate download cookie hash. Its transaction exists, but the publication
trigger deliberately prevents any segmented export from becoming ready now.
A byte-complete summary must never be presented as a ready archive.

Only one live export for the same principal, concrete target and route can be
created. The profile lock serializes the check, including existing legacy
exports. Failed jobs do not silently restart. A new explicit create operation
needs a fresh nonce and cookie; old attempts and reserved keys remain separate.
An expired writing attempt must be stopped and reconciled. No new attempt
adopts its bytes. The five-minute attempt lease can be renewed while the same
receipt remains current; it never extends the job's original 24-hour deadline.

The core's initial authority hook uses read-only preflight before beginAttempt;
preflight cannot adopt an existing attempt. Subsequent authority hooks can renew
the same live lease and compare the same receipt. Discovery supplies the
database-owned principal hash and fixed deadline for the core's initial options.
The writer RPC reserves exact ordered keys before any object write, checks
actual Storage object ID, bucket, key and size at ACK, and stores pages of at
most 128 exact acknowledged descriptors. Object IDs and keys are unique across
attempts. The whole-stream and canonical manifest hashes remain trusted
producer observations; SQL does not claim to have hashed provider bytes.
Bounded dispatcher discovery returns at most 16 IDs, and grants no content
access. No dispatcher is installed by this change.

The migration creates only the registered private `exports` bucket, with a
4,000,000-byte whole-object limit and an octet-stream MIME type. An incompatible
existing bucket causes migration failure; it is not adopted or altered. No
client Storage policy is added. The surviving upload-only client policy names
`genomes`, and the old authenticated Storage policies were removed by earlier
migrations. The service adapter still writes only an exact reserved key.

Cleanup keeps every reserved key, including an unacknowledged write or a key
whose delete was already acknowledged. A late response can therefore never
hide the key from later reconciliation. A delete ACK alone never marks cleanup
complete. No RPC can yet claim the provider's late-write fence or physical
absence. That missing provider boundary, active retention dispatch, final
completion and account deletion for archives with reserved keys remain required
integration work before deployment.

The existing account purge can remove an empty queued or begun job under exact
job/attempt locks. Any reserved key refuses metadata deletion atomically,
including a key with a delete ACK. For an empty job, nonce records lose every
identity/envelope field and retain only the digest and original short expiry,
so deleting a queue cannot revive the token. A future bounded retention pass
must remove those expired digest-only tombstones. Legacy export deletion is
unchanged.

The new pgTAP file authors authority, nonce, cookie, reservation, manifest,
publication-hold and purge regressions. Its Storage rows are synthetic metadata
inside a rollback transaction. Those cases have not been executed locally and
are not evidence of provider upload, physical deletion, complete archive
membership, ZIP64 delivery or independent-rights support.
