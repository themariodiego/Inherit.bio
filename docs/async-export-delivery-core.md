# Asynchronous export delivery: core and remaining integration

This is an intermediate implementation. It does not replace `GET /api/export`,
publish a worker, create a download session, apply a database migration or close
G5.6. No hosted Storage write or large archive transfer has been run for it.

## Internal storage clarification

The authorized implementation keeps one complete ZIP download and the existing
client chunk contract. Internally, it stores the ZIP byte stream as separate,
whole private Supabase objects of at most **4,000,000 bytes**. Each physical
object aligns with one bounded delivery chunk and has its own SHA-256 digest.
The last object can be shorter. This is not a multipart upload protocol and does
not change the original-genome backend, access scopes or retention deadline.

`largeExportDeliveryContract.archiveRepresentation`, its worker binding and
`storage.export-v1` now explicitly name this internal representation. G5.6 in
the brief records the same clarification. The wire shape, maximum chunk size,
origin binding, full data scope and 24-hour deletion rule remain required.
Database and product integration are still incomplete. The implementation must
not impose a silent 5 GB total-export cap or omit members that do not fit one
object.

## Implemented core

`src/lib/exports/archive-segments.ts` creates a fresh attempt ID and streams
already-authorized archive bytes through one owned object buffer. It admits no
previous attempt state and does not resume, list or adopt existing objects.

Mandatory server-injected hooks perform these steps in order:

1. Check current authority against the exact receipt supplied by the authorized
   database job, then durably claim the new attempt. Every check, including the
   first, must match that SHA-256 receipt. Rechecks follow source reads, writes,
   metadata operations and EOF. A changed receipt fails even after regrant; the
   writer cannot silently adopt a changed scope while a job was queued.
2. Reserve each exact key and descriptor before the first object write. A timed
   out reservation may have committed, so the attempt remains cleanup work.
3. Write once, check the returned identity and local digest, check authority,
   then durably acknowledge the exact object. No retry, upsert or adoption occurs.
4. Append ordered pages of at most 128 descriptors. The canonical manifest hash
   is SHA-256 over UTF-8 JSON arrays followed by one newline each, in order:
   `[ordinal, offset, sizeBytes, sha256, objectKey, objectId]`.
5. After nonempty stream EOF, all ACKs/pages and a final authority check, return
   a `bytes-complete` summary. This is neither a ready export nor proof that a
   producer emitted every authorized ZIP member and its ZIP64 end records.

The namespace is `exports/{principalHash}/{exportId}/{attemptId}-{ordinal}.part`.
The bucket and all identifiers are server owned. Ordinals start at zero; offsets
equal ordinal times 4,000,000. A shared closed validator enforces exact shapes,
UUIDs, digest syntax, namespace, offsets and safe integer extents. Byte and
manifest hashes are incremental. No bitwise or unsigned-32-bit counters are
used. Memory holds one object buffer, one bounded producer chunk and one page;
the producer must use a bounded queue and chunks no larger than one object.

`archive-segment-storage.ts` uses the installed Supabase SDK with a strict
single-POST fetch adapter. It admits only the exact reserved object, a raw byte
body, `upsert: false`, and the expected successful response identity. Redirects,
unexpected status/URL/schema, empty or oversized response chunks, malformed
JSON and uncertain transport results fail. ACK bodies are limited to 8 KiB.
Credentials are injected server configuration, never ambient client input.

`archive-segment-reader.ts` verifies one DB-selected whole object through an
injected read adapter. Its first and subsequent authority checks must match the
receipt recorded on the authorized completed export. It freezes and validates
the selected identity, checks authority before and after acquiring the body and
after EOF, then checks exact length and SHA-256 before returning an owned buffer.
It never releases a partially verified response. The entire read is bounded by
the earlier of the server deadline and 30 seconds. Late bodies are cancelled
without awaiting a stuck provider or cancellation hook.

This reader is not a Storage GET transport, HTTP route or database authorization
implementation. The future adapter must prove exact provider object identity,
refuse redirects and partial/range responses, and enforce the fixed origin. An
injected object's metadata alone is not independent evidence of those properties.

Each operation has a 30-second bound inside a fixed server-owned overall lease
deadline. Cancellation stops subsequent core operations and does not wait for a
non-cooperative stream, fetch or cancel promise. `cleanupRequired` stays true
after an attempt claim could have committed, including through typed errors.
Errors contain a fixed code, not source filenames, tokens or provider bodies.

## Required database and worker integration

The hooks are contracts, not deployed authorization or persistence. Before any
route can use this core, implement the following complete path:

- Store a discriminated origin for the authenticated or independent rights
  session permitted by the exact registered export route. A reviewer session
  alone grants no export route. Bind the exact session, account/subject/contributor set,
  grants, signatures, lifecycle, claim/request and source publication revisions.
  A rights-origin export must not borrow an uploader's session or capabilities.
- Claim attempts with INSERT-only identity and lease semantics. Reserve every
  ordinal/key before the object write. Database constraints must enforce unique ordinals,
  keys and provider object IDs across pages and attempts. Acknowledgements and
  page inserts must re-evaluate the same full graph and refuse stale workers.
- Build the complete ordered authorized member list through the current
  source selectors. Preserve captured reports and correction notices. Recheck
  authority before every selection/read; the core's stream checks alone cannot
  determine what a ZIP producer read or whether it omitted a source.
- Run a separate bounded worker workload, with real claim/dispatch and resource
  budgets. Use a streaming ZIP64 producer, member counts and complete EOF/error
  propagation. Do not buffer the archive, truncate to a provider-object ceiling
  or interfere with preparation workers. Worker deployment remains unimplemented.
- Publish ready atomically only after verifying all reserved objects are ACKed,
  all manifest pages/counts/extents/hashes match, ZIP generation completed, and
  the full live graph is unchanged. A receipt string from a caller is never
  authority. The database must compute/check its own current graph.
- Expire and purge every reserved key, including failed and unacknowledged
  writes, under the existing 24-hour rule and account/subject deletion graph.
  Exact-key Storage API acknowledgement is required; deleting metadata is not
  erasure. No broad prefix deletion, original deletion or implicit mail dispatch.

**Unresolved write-fencing prerequisite:** a service-role object write and before/after
checks do not prove that Storage rejects a late revoked write. A started object write or
metadata call may still commit after its caller aborts. Durable lease fencing,
the provider's late-write boundary and reconciliation of all uncertain keys
must be implemented and proved before cleanup can be called complete. The core
does not erase an uncertain reservation or claim physical/provider-media erasure.

## Required request and download integration

Keep the register's separate same-origin POST operations for create and
open-ready. Each consumes a fresh operation-specific, session-bound one-time
nonce atomically. Render/mint them through an authorized explicit action; GET
polls must not create or rotate jobs, cookies, sessions or credentials. Never
add nonce fields to the existing poll response merely to simplify the client.

Every bounded chunk must resolve server-owned manifest metadata through the
exact current originating session and full authorization graph. Verify the
whole object's length, SHA-256 and recorded provider identity before releasing
bytes, and recheck authority after the read. Do not accept caller ranges,
offsets, keys or transferable signed URLs. No chunk may exceed 4,000,000 bytes.
The client must stream the unchanged ZIP download without accumulating it as
one in-memory Blob; supported-browser delivery and cancellation remain work.

Preserve independent accountless rights, contributor partitions, current consent
signatures and rights-entry mail links, opaque refusals, replay bounds and jurisdiction bypass for rights exports.
An invitation-refusal test is not proof of held-data export or deletion.

## Verification scope

The core tests use the real SDK with injected transport, real SHA-256 on small
streams crossing the physical-object boundary, and failure/cancellation hooks.
They prove no read-ahead during a pending write, reservation-before-write,
receipt drift refusal, exact byte/digest/identity checks, bounded pages, typed
error cleanup responsibility and no ACK/retry after uncertainty.

The reader tests use injected objects, including an exact 4,000,000-byte object.
They cover pinned authority, caller mutation, wrong identities, short/excess or
corrupt bodies, empty chunks, stalled operations and late cancellation. They do
not perform a hosted read or establish provider-side immutability.

A separate metadata accounting test uses 1,075 virtual descriptors with a total
of 4,296,000,017 bytes. It proves arithmetic/order/paging beyond 2^32. It does not
hash or transfer 4 GiB, generate a ZIP64 archive or prove large hosted capacity.

The ZIP64 producer (`archive-zip64.ts`) was checked on 25 September with a
real 604-member, 9.66 MB archive it wrote itself: Info-ZIP, Python `zipfile`,
libarchive (seeking and non-seeking) and 7-Zip 23.01 each read every member
byte for byte. That archive is below 4 GiB, and macOS Archive Utility and
Windows Explorer were not tried.

Still required: concurrency tests beyond the rollback-only pgTAP suite, full own and independent
rights journeys, source changes and revocation during generation/download,
duplicate/expired nonces, late-write cleanup and deletion, reader coverage on
the desktop platforms above, and an actual large mixed-member archive with no
missing content. No existing
test, timeout, route ratchet, acceptance verdict or safety bound is relaxed.
