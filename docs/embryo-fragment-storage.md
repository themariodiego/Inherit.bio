# Embryo fragment storage — interface for the chunk route and the worker

Written 29 September 2026. Test-local only: no route writes through this yet,
no gateway is deployed, and `EMBRYO_INGEST_AVAILABLE` stays false.

On 28 September the owner chose to prove embryo upload cleanup rather than
assume it (`docs/protocol/decisions.md`). So sanitized embryo fragments go to a
private R2 bucket behind a signed gateway, with create-only writes and
permanent empty markers, as ADR 0025 does for prepared objects. This file is
the contract the embryo chunk route and the `split_cohort_vcf` worker build on.

## Where a fragment goes

- `private.embryo_ingest_object_config` selects the backend. It starts empty,
  and while it is empty `reserve_embryo_ingest_chunk_v1` refuses any fragment
  (`55000 embryo_object_backend_unavailable`).
- Each write intent records its backend when the fragment is reserved.
  Changing the configuration later never moves an issued intent.
- `r2`: key `embryo/<fragment object id>` in an `inherit-embryo-*` bucket. The
  key carries no account or cohort id.
- `supabase`: the unit-1 path in bucket `genomes`. It exists for database tests
  and as a fenced namespace. On Supabase Storage an uncertain write can never be
  proved absent, so production must select `r2`. The TypeScript writer below
  refuses Supabase targets.
- The Supabase name every fragment reserves, `<account>/<cohort>/<upload>/<id>.vcf`,
  stays fenced by `guard_embryo_ingest_object`. For an R2 fragment that name can
  never gain a metadata row.

## Chunk route: the order of calls

All database calls use the service-role client. The route has already run
`authorize_embryo_ingest_request_v1` and sanitized the chunk in memory.

1. `reserve_embryo_ingest_chunk_v1(session, sequence, sha256, bytes, records,
   maxLine, fragments)`. Unchanged. `fragments` carries each ordinal's `bytes`,
   `lines` and `sha256` of the exact sanitized bytes that will be written.
2. `embryo_ingest_write_targets_v1(session, sequence)`. Answers
   `{status: "reserved" | "stored", targets: [{receipt, state, stored}]}`, or a
   bare `{status}` of `denied`, `failure_pending` or `published`. Parse it with
   `parseEmbryoWriteTargets`. Reading targets renews an expired open window
   (at most three windows, clamped to the session deadline). An expired third
   window fails the attempt with `retry-exhaustion`.
3. For every target whose `state` is `open`: `writeEmbryoFragment({ rpc,
   target: receipt, bytes, signal })`. Skip `landed` targets. An `uncertain`
   target cannot occur while the session is writable.
4. `commit_embryo_ingest_chunk_v1(session, sequence, sha256)`. It refuses with
   `55000 embryo_chunk_objects_unlanded` until every fragment of the chunk has
   landed.

If `writeEmbryoFragment` throws, the intent stays open. Read the targets again
and retry with the new receipt. A `conflict` means the key holds something other
than these bytes, so do not retry it. A receipt from an earlier window can
never land, because renewal changes `writeExpiresAt`.

## TypeScript: `src/lib/embryos/fragment-storage.ts`

```ts
export const EMBRYO_FRAGMENT_MAX_BYTES = 4_004_096;

/** The exact receipt SQL issued. Present it back unchanged. */
type EmbryoWriteTarget = {
  version: "embryo-ingest-write-target-v1";
  sessionId: string; sequence: number; ordinal: number;
  backend: "r2" | "supabase"; bucket: string; objectKey: string;
  byteCount: number; sha256: string; writeExpiresAt: string;
};
/** A landed R2 fragment. */
type EmbryoStoredFragment = { receipt: EmbryoWriteTarget & { backend: "r2" }; providerVersion: string; etag: string };
/** `admin.rpc.bind(admin)` from the service-role client satisfies this. */
type EmbryoFragmentRpc = (name: string, args: Record<string, unknown>) =>
  { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };

embryoFragmentStorageConfigured(): boolean;   // routes read neither variable themselves
parseEmbryoWriteTargets(data: unknown): EmbryoWriteTargets;
writeEmbryoFragment(input: { rpc; target; bytes: Uint8Array; signal: AbortSignal }): Promise<EmbryoStoredFragment>;
readEmbryoFragment(input: { stored: EmbryoStoredFragment; signal: AbortSignal }): Promise<Uint8Array>;
tombstoneEmbryoFragment(input: { locator; expiresAt: string; signal }): Promise<EmbryoFragmentTombstone>; // cleanup only
class EmbryoFragmentStorageError { code: "invalid_request" | "unavailable" | "conflict" | "integrity_mismatch" | "aborted" }
```

`writeEmbryoFragment` checks the bytes against the receipt's size and hash
before any network call. Then it:

1. mints a 30-second capability, never later than the receipt's window;
2. PUTs the fragment create-only (R2 verifies the SHA-256);
3. reads that exact version back to EOF and hashes it;
4. calls `ack_embryo_ingest_r2_write_v1` with the receipt, the provider
   version, the ETag, the observed hash and the observed size.

It resolves only if SQL returns exactly `{receipt, providerVersion, etag}`. When
the same bytes are already at the key, as after a lost PUT response, the
gateway reports the existing version and the write resumes from step 3.

`readEmbryoFragment` is for the worker. It reads one landed fragment at its
exact version and checks size and hash to EOF. It checks no authority: the
worker must first establish in SQL that it may read the fragment, from a read
door built with the worker. The landed identity is the `stored` field of a
target, or the ACK's answer.

Configuration: `INHERIT_EMBRYO_R2_ORIGIN` (the gateway's `https://` origin) and
`INHERIT_EMBRYO_R2_BUCKET` (must equal the receipt's bucket). Routes ask
`embryoFragmentStorageConfigured()` instead of reading either variable. True
means both are well formed. It does not mean the gateway answers, or that SQL
has selected the R2 backend. Capabilities are
signed with the existing upload signer (`INHERIT_UPLOAD_SIGNING_JWK`), under
audience `inherit-embryo-fragment-v1`, by `mintEmbryoFragmentCapability` in
`src/lib/uploads/storage-upload-token.ts`.

## The landing ACK

`ack_embryo_ingest_r2_write_v1(p_session_id, p_sequence, p_ordinal,
p_expected, p_provider_version, p_etag, p_observed_sha256,
p_observed_byte_count)`, for service_role only.

- It admits a landing only while the session is `open`, unexpired, unfenced and
  passes `private.embryo_ingest_binding_failure_v1`.
- The intent must be `open` and inside its window, and its chunk still
  `reserved`. The key must not be in a deletion inventory.
- `p_expected` must equal the current receipt exactly, and the observed hash
  and size must equal the reserved ones.
- An exact replay of a committed ACK returns the same answer. A replay naming
  another version or ETag is refused.
- Refusals: `22023 invalid_request` for malformed arguments, otherwise
  `42501 embryo_object_unavailable`.

The ACK shares its admission check, `private.lock_embryo_ingest_landing_v1`,
with the Supabase metadata guard. Both take the session FOR SHARE, then the
intent FOR UPDATE, so the write fence's concurrency argument holds for both.
After the fence no ACK can land. The ACK records what the transport observed;
it is not independent proof from the provider.

## Cleanup after an unwind

Added on 29 September (`20260929101000_embryo_ingest_unwind_storage.sql`,
`src/lib/embryos/unwind-storage.ts`). No route or scheduler calls it yet.

`prepare_embryo_ingest_unwind_v1` inventories each fragment where its intent
says it lives: the R2 bucket and key, or the Supabase name. It inventories an
upload-staging object under its recorded bucket, which fixes D-130. Then:

1. `claim_embryo_ingest_object_disposals_v1(unwind, claimTokenHash)` settles
   the drain first. Before `fence_at` it answers `draining` and claims nothing.
   After that it claims up to 25 objects, each with a receipt
   (`embryo-ingest-object-disposal-v1`) that expires after 60 seconds:
   - every R2 key, landed or uncertain, for an empty marker;
   - a landed Supabase object, for deletion of its exact id and version, only
     while that metadata row is live.
2. For each receipt, `drainEmbryoUnwindStorage` either has the gateway write
   the marker and read it back to EOF, or deletes the exact Supabase object
   through the Storage API and checks the single row it returns.
3. `finish_embryo_ingest_object_disposal_v1(unwind, ordinal, token, receipt,
   evidence)` records one disposal only with exact evidence:
   - R2: the empty marker at that key, as a version other than the landed
     payload.
   - Supabase: the deleted row's exact id and version, and no metadata row
     left under the id or the name.
4. `confirm_embryo_ingest_unwind_storage_v1(unwind)` moves the unwind to
   `storage_confirmed` only when nothing is unresolved. Otherwise it reports
   what is. A trigger enforces the same rule for any writer.
5. `complete_embryo_ingest_unwind_v1(unwind)` (`completeEmbryoUnwind`, added
   30 September in `20260930130000_embryo_ingest_terminal_purge.sql`) runs
   only after that. For an abandoned attempt it is the terminal graph purge.
   For a published attempt it deletes the fragment, write intent and
   handle-map rows. Before `storage_confirmed` it answers with the unwind's
   state and changes nothing.

Publication plans its own cleanup: a `purpose = 'published'` unwind whose
inventory lists every fragment object, and never a published source. Its
objects go through steps 1 to 5 like any other.
`embryo_ingest_unwind_work_v1(limit)` (`listEmbryoUnwindWork`) lists the
unwinds still waiting on storage or on completion.

Canonical parts (added 30 September,
`20260930140000_embryo_canonical_part_disposal.sql`) use the same receipts:
an R2 marker at the part's exact `embryo/<uuid>` key. A part is claimed once
it landed or its write window closed, and never while a canonical source
binds it. A `purpose = 'source'` unwind, made by the internal source-deletion
planner, lists only the parts of the sources it deleted.

What stays unresolved, and keeps the unwind at `storage_pending`:

- an uncertain Supabase write, because no evidence can prove it absent;
- a landed Supabase object whose metadata vanished outside this path;
- a claim that lapsed after the provider acted but before `finish`;
- any inventory row with no exact contract yet: upload-staging, canonical or
  legacy source rows.

A marker is permanent: a late create-only write can never restore the
payload. It proves the current payload is gone and the key is fenced. It does
not prove key absence or physical erasure. The gateway has no listing; it
checks the marker by reading the exact key back to EOF. R2 keeps no earlier
versions to list.

## Gateway

`workers/embryo-fragments/worker.mjs`, with its README, lists what the owner and
lead must do before any embryo upload: create the buckets, add the Wrangler
configuration and deploy checks, deploy, set the two variables and select the
backend. None of it is done.
