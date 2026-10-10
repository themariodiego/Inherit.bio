# Shared minimum provenance at the last consumer

Migration20261001036000 closes a specific235/245 source-cleanup gap. It creates
no store or public action. The158-store registry,228-table export plan,
original7-day source and30-day completion clocks stay unchanged. The public
claimant deletion action and unsupported bound-account graph remain closed.

A new claimant plan includes one closed `claimed-provenance-pair-v1` candidate
inside its existing immutable phase. The candidate contains only the existing
nine ingest and eight completed-job receipt fields. It is sealed before the
existing phase fingerprint is computed. Missing or changed legacy envelopes
refuse; the migration does not backfill them. Terminal minimization retains
only a closed disposition code and destroys the candidate identifiers.

Both actual native paths take the same transaction advisory lock per exact
session/job pair. Parent capture visits pairs in deterministic session/job
order; parent cleanup captures its array under the current due plan before
runtime removal. Claimant capture/check/finalization uses its own sealed pair.
Collection rechecks every source, member and part that uses either ID. Claimed
bound/unbound survivors require their exact current immutable custody tuple.
Current parent sources require the live publication and owner tuple; orphan
parts are recognized only during the exact current typed parent source unwind.
Unknown, crossed or unsupported orphan tuples refuse the transaction.

A surviving consumer keeps both receipt rows byte-identical. Live runtime also
keeps the pair. Removal is limited to the actual executing claimant manifest
or completed due account/cohort plan, after the original native document,
archive, part, ingest and provider guards. Only then, with no actual surviving
consumer or runtime, is the job receipt removed followed by its ingest receipt.
Receipt reads are never erasure authority. Every new helper, table and column
remains denied to all API roles, including service; original immutable-update
and surviving-part direct-delete guards are unchanged.

The additive rollback SQL scenarios use the actual upload/publication,
attested review/release, native deletion and exact acknowledgement producers.
One keeps the surviving parent source through claimant finalization then
collects after parent disposal. The other preserves a claimed source through
parent runtime disposal then collects at final claimant disposal. Existing235
and245 assertion files remain byte-identical. SQL acknowledgements are protocol
metadata fixtures, never physical-provider evidence or hosted acceptance.

The independent-session runner is invoked separately by the root on the
reserved owned synthetic stack after preparing a real committed fixture with
both native authorities and all required exact protocol ACKs. It accepts one
closed JSON receipt: version, projectId, exact sourceCommit, accountDeletionId,
claimantManifestId and the synthetic claimTokenHash. It requires the exact
native catalog/body/ABI/config/ACL pins, real current manifest/plan authority,
and no claimant documents. It executes each actual native finisher uncommitted,
requires the opposite finisher to wait on the exact pair, cancels that backend,
and rolls back. Every public/private row fingerprint must then be unchanged.
It supplies no candidate, grants, setup rows or provider acknowledgements.
A separate `scripts/fixtures/claimed-provenance-legacy-prefix035.sql` rehearsal
requires the genuine pre036 prefix and ordinary pgTAP harness. It creates an
old plan through the actual old producer, applies036 inside the same rollback
transaction, and requires refusal plus byte-identical old phase/manifest. It
never disables the immutable trigger or manufactures a legacy envelope.

Run `node scripts/claimed-provenance-pair-locks.mjs <fixture-receipt-path>` only
from the exact reviewed runtime source copy whose existing config identifies
`inherit-integrator-20260930`. The source checkout's normal project cannot run
it. This runner and the new SQL require actual root rehearsal. No execution or
G5.6 acceptance credit follows from authoring. A positive fresh bound claimant
erasure, real provider drains, and a complete current browser journey remain
separate requirements. No general receipt collector or new retention period
is introduced.
