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

## Cleanup (next change)

The drain is unchanged: after `fence_at` every intent is `landed` or
`uncertain`. On R2, every key of an unwound session will get an empty marker
after `fence_at`, read back and verified before `storage_confirmed`. The marker
is permanent: a late create-only write can never restore the payload. It proves
the current payload is gone and the key is fenced, not physical erasure. The
gateway has no listing. It checks the marker by reading the exact key back to
EOF. On Supabase, a landed object needs an exact-version deletion ACK, and an
uncertain one keeps its unwind at `storage_pending`.

## Gateway

`workers/embryo-fragments/worker.mjs`, with its README, lists what the owner and
lead must do before any embryo upload: create the buckets, add the Wrangler
configuration and deploy checks, deploy, set the two variables and select the
backend. None of it is done.
