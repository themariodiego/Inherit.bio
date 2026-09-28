import "server-only";

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { mintEmbryoFragmentCapability } from "@/lib/uploads/storage-upload-token";

/**
 * Embryo fragment storage: the interface the chunk route writes through and
 * the `split_cohort_vcf` worker reads through (docs/embryo-fragment-storage.md).
 *
 * SQL decides where a fragment goes and whether it may land; this module only
 * moves bytes and reports what the provider returned. Every write targets the
 * exact receipt `embryo_ingest_write_targets_v1` issued. The object is written
 * create-only through the fragment gateway, read back at its exact version to
 * EOF and hashed, and only then acknowledged with `ack_embryo_ingest_r2_write_v1`.
 * A lost response, an expired window or a refused ACK leaves the intent open;
 * the drain classifies it and cleanup fences its key. Nothing here renews a
 * window, retries on its own or decides that a write did not happen.
 */

/** The largest fragment `reserve_embryo_ingest_chunk_v1` can reserve: a chunk
 * of 4,000,000 bytes plus one 4,096-byte header allowance. */
export const EMBRYO_FRAGMENT_MAX_BYTES = 4_004_096;
export const EMBRYO_R2_BUCKET = /^inherit-embryo-[a-z0-9-]{1,40}$/;
export const EMBRYO_R2_KEY = /^embryo\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPABASE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){3}\.(vcf|tsv)$/;

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const providerId = z.string().regex(/^[0-9a-f]{32}$/);
const common = {
  version: z.literal("embryo-ingest-write-target-v1"), sessionId: uuid,
  sequence: z.number().int().min(0).max(49), ordinal: z.number().int().min(0).max(63),
  byteCount: z.number().int().min(1).max(EMBRYO_FRAGMENT_MAX_BYTES), sha256: hash,
  writeExpiresAt: z.iso.datetime({ offset: true }),
};
export const embryoR2WriteTargetSchema = z.object({ ...common, backend: z.literal("r2"),
  bucket: z.string().regex(EMBRYO_R2_BUCKET), objectKey: z.string().regex(EMBRYO_R2_KEY) }).strict();
/** Tests and the fenced Supabase namespace only. This module writes no
 * Supabase target: an uncertain Supabase write can never be proved absent. */
export const embryoSupabaseWriteTargetSchema = z.object({ ...common, backend: z.literal("supabase"),
  bucket: z.literal("genomes"), objectKey: z.string().regex(SUPABASE_KEY) }).strict();
/** The exact receipt SQL issued. Present it back unchanged. */
export const embryoWriteTargetSchema = z.discriminatedUnion("backend", [
  embryoR2WriteTargetSchema, embryoSupabaseWriteTargetSchema,
]);
export type EmbryoWriteTarget = z.infer<typeof embryoWriteTargetSchema>;
export type EmbryoR2WriteTarget = z.infer<typeof embryoR2WriteTargetSchema>;

/** A landed R2 fragment: its receipt and the provider version it is bound to. */
export const embryoStoredFragmentSchema = z.object({
  receipt: embryoR2WriteTargetSchema, providerVersion: providerId, etag: providerId,
}).strict();
export type EmbryoStoredFragment = z.infer<typeof embryoStoredFragmentSchema>;

const targetState = z.object({
  receipt: embryoWriteTargetSchema,
  state: z.enum(["open", "landed", "uncertain"]),
  stored: z.union([z.null(), z.object({ providerVersion: providerId, etag: providerId }).strict(),
    z.object({ storageObjectId: uuid, storageVersion: uuid }).strict()]),
}).strict().refine(value => (value.state === "landed") === (value.stored !== null)
  && (value.stored === null || ("providerVersion" in value.stored) === (value.receipt.backend === "r2")));
/** `embryo_ingest_write_targets_v1`. A refusal names no target. */
export const embryoWriteTargetsSchema = z.union([
  z.object({ status: z.enum(["reserved", "stored"]), targets: z.array(targetState).max(64) }).strict(),
  z.object({ status: z.enum(["denied", "failure_pending", "published"]) }).strict(),
]);
export type EmbryoWriteTargets = z.infer<typeof embryoWriteTargetsSchema>;

type RpcResult = { data: unknown; error: unknown };
/** `admin.rpc.bind(admin)` from the service-role client satisfies this. */
export type EmbryoFragmentRpc = (name: string, args: Record<string, unknown>) => {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>;
};

export type EmbryoFragmentStorageCode = "invalid_request" | "unavailable" | "conflict" | "integrity_mismatch" | "aborted";
export class EmbryoFragmentStorageError extends Error {
  constructor(readonly code: EmbryoFragmentStorageCode) { super(`embryo_fragment_${code}`); this.name = "EmbryoFragmentStorageError"; }
}
const fail = (code: EmbryoFragmentStorageCode): never => { throw new EmbryoFragmentStorageError(code); };

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The gateway origin for a receipt's bucket. The bucket must be exactly the
 * one this deployment is configured for; anything else is unavailable. */
function gatewayOrigin(bucket: string): string {
  try {
    const url = new URL(process.env.INHERIT_EMBRYO_R2_ORIGIN ?? "");
    if (url.protocol === "https:" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash
      && EMBRYO_R2_BUCKET.test(bucket) && bucket === process.env.INHERIT_EMBRYO_R2_BUCKET) return url.origin;
  } catch { /* unavailable below */ }
  return fail("unavailable");
}

async function gatewayRequest(target: EmbryoR2WriteTarget, operation: "put" | "get" | "tombstone",
  init: { signal: AbortSignal; expiresAt: string; bytes?: Uint8Array; stored?: EmbryoStoredFragment }): Promise<Response> {
  const origin = gatewayOrigin(target.bucket);
  const token = mintEmbryoFragmentCapability({ operation, bucket: target.bucket, objectKey: target.objectKey,
    byteCount: target.byteCount, sha256: target.sha256, expiresAt: init.expiresAt,
    ...(init.stored ? { providerVersion: init.stored.providerVersion, etag: init.stored.etag } : {}) });
  return fetch(`${origin}/fragment`, { method: operation === "get" ? "GET" : "PUT", signal: init.signal,
    cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity",
      ...(operation === "put" ? { "Content-Type": "application/octet-stream", "Content-Length": String(target.byteCount) } : {}) },
    ...(operation === "put" ? { body: Uint8Array.from(init.bytes!) as BodyInit } : {}) });
}

async function boundedBody(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) return fail("integrity_mismatch");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) fail("aborted");
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) fail("integrity_mismatch");
      chunks.push(next.value);
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}
const boundedJson = async (response: Response, signal: AbortSignal) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBody(response, 4096, signal))) as unknown;

async function readExact(stored: EmbryoStoredFragment, signal: AbortSignal, expiresAt: string): Promise<Uint8Array> {
  const response = await gatewayRequest(stored.receipt, "get", { signal, expiresAt, stored });
  if (response.status !== 200 || response.headers.has("content-range")
    || response.headers.get("x-inherit-object-version") !== stored.providerVersion
    || response.headers.get("content-length") !== String(stored.receipt.byteCount)
    || ![null, "identity"].includes(response.headers.get("content-encoding"))) {
    void response.body?.cancel().catch(() => {});
    return fail(response.status === 404 || response.status === 409 ? "integrity_mismatch" : "unavailable");
  }
  const bytes = await boundedBody(response, stored.receipt.byteCount, signal);
  if (bytes.byteLength !== stored.receipt.byteCount || sha(bytes) !== stored.receipt.sha256) fail("integrity_mismatch");
  return bytes;
}

const putResponse = z.object({ providerVersion: providerId, etag: providerId,
  byteCount: z.number().int().min(1).max(EMBRYO_FRAGMENT_MAX_BYTES), created: z.boolean() }).strict();

/**
 * Write one reserved fragment and land it. `bytes` must be exactly the
 * sanitized fragment the reservation described. Resolves with the stored
 * identity only after SQL accepted the ACK. On any error the intent stays
 * open: read the targets again, which renew an expired window while the
 * session is still writable, and retry with the new receipt. A `conflict`
 * means something other than these bytes holds the key; do not retry.
 */
export async function writeEmbryoFragment(input: {
  rpc: EmbryoFragmentRpc; target: EmbryoWriteTarget; bytes: Uint8Array; signal: AbortSignal;
}): Promise<EmbryoStoredFragment> {
  let target: EmbryoR2WriteTarget, bytes: Uint8Array;
  try {
    target = embryoR2WriteTargetSchema.parse(input.target);
    bytes = Uint8Array.from(input.bytes);
    if (bytes.byteLength !== target.byteCount || sha(bytes) !== target.sha256) throw new Error();
  } catch { return fail("invalid_request"); }
  const remaining = Date.parse(target.writeExpiresAt) - Date.now();
  if (!(remaining > 0)) fail("unavailable");
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.min(remaining, 30_000))]);
  try {
    const put = await gatewayRequest(target, "put", { signal, expiresAt: target.writeExpiresAt, bytes });
    if (put.status !== 200) {
      void put.body?.cancel().catch(() => {});
      fail(put.status === 409 ? "conflict" : "unavailable");
    }
    const uploaded = putResponse.parse(await boundedJson(put, signal));
    if (uploaded.byteCount !== target.byteCount) fail("integrity_mismatch");
    const stored: EmbryoStoredFragment = { receipt: target, providerVersion: uploaded.providerVersion, etag: uploaded.etag };
    const observed = await readExact(stored, signal, target.writeExpiresAt);
    const { data, error } = await input.rpc("ack_embryo_ingest_r2_write_v1", {
      p_session_id: target.sessionId, p_sequence: target.sequence, p_ordinal: target.ordinal, p_expected: target,
      p_provider_version: stored.providerVersion, p_etag: stored.etag,
      p_observed_sha256: sha(observed), p_observed_byte_count: observed.byteLength,
    }).abortSignal(signal);
    if (error) fail("unavailable");
    const acknowledged = embryoStoredFragmentSchema.safeParse(data);
    if (!acknowledged.success || !isDeepStrictEqual(acknowledged.data, stored)) fail("integrity_mismatch");
    return stored;
  } catch (error) {
    if (error instanceof EmbryoFragmentStorageError) throw error;
    if (signal.aborted) fail("aborted");
    return fail("unavailable");
  }
}

/**
 * Read one landed fragment in full at its exact provider version, verifying
 * size and SHA-256 to EOF. The caller must first have established, in SQL,
 * that it may read this fragment now; this function checks no authority.
 */
export async function readEmbryoFragment(input: { stored: EmbryoStoredFragment; signal: AbortSignal }): Promise<Uint8Array> {
  let stored: EmbryoStoredFragment;
  try { stored = embryoStoredFragmentSchema.parse(input.stored); } catch { return fail("invalid_request"); }
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]);
  try {
    return await readExact(stored, signal, new Date(Date.now() + 30_000).toISOString());
  } catch (error) {
    if (error instanceof EmbryoFragmentStorageError) throw error;
    if (signal.aborted) fail("aborted");
    return fail("unavailable");
  }
}

/** Parse the targets door's answer, refusing anything outside its contract. */
export function parseEmbryoWriteTargets(data: unknown): EmbryoWriteTargets {
  const parsed = embryoWriteTargetsSchema.safeParse(data);
  return parsed.success ? parsed.data : fail("integrity_mismatch");
}
