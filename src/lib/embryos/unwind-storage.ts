import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { preparedStorageConfig } from "@/lib/genome/prepared-source/storage-common";
import {
  EMBRYO_FRAGMENT_MAX_BYTES, EMBRYO_R2_BUCKET, EMBRYO_R2_KEY, tombstoneEmbryoFragment, type EmbryoFragmentRpc,
} from "./fragment-storage";

/**
 * One bounded pass of an unwound embryo upload's storage disposal
 * (20260929101000). SQL chooses the objects; this moves them and reports
 * exactly what the provider answered. Nothing is inferred: a missing object,
 * an empty or mismatched response, or a lost acknowledgement leaves the object
 * unresolved and the unwind `storage_pending`. Not wired to any route or
 * scheduler yet.
 */

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const common = {
  version: z.literal("embryo-ingest-object-disposal-v1"), unwindId: uuid,
  ordinal: z.number().int().positive(), byteCount: z.number().int().min(1).max(EMBRYO_FRAGMENT_MAX_BYTES),
  sha256: hash, claimExpiresAt: z.iso.datetime({ offset: true }),
};
const r2Receipt = z.object({ ...common, backend: z.literal("r2"), operation: z.literal("tombstone"),
  bucket: z.string().regex(EMBRYO_R2_BUCKET), objectKey: z.string().regex(EMBRYO_R2_KEY) }).strict();
const supabaseReceipt = z.object({ ...common, backend: z.literal("supabase"), operation: z.literal("delete"),
  bucket: z.literal("genomes"), objectKey: z.string().min(1).max(1024),
  storageObjectId: uuid, storageVersion: uuid }).strict();
/** One object SQL claimed for disposal. Present it back unchanged. */
export const embryoDisposalReceiptSchema = z.discriminatedUnion("backend", [r2Receipt, supabaseReceipt]);
export type EmbryoDisposalReceipt = z.infer<typeof embryoDisposalReceiptSchema>;
const claimSchema = z.union([
  z.object({ status: z.literal("claimed"), unwindId: uuid, objects: z.array(embryoDisposalReceiptSchema).min(1).max(25) }).strict(),
  // Any other answer claims nothing; a malformed "claimed" answer matches neither.
  z.object({ status: z.string().regex(/^[a-z_]{1,40}$/).refine(status => status !== "claimed") }).passthrough(),
]);

export type EmbryoUnwindStorageResult = {
  /** The claim's answer when nothing was claimed, else the confirmation's. */
  status: string;
  disposed: number;
  failed: number;
};

async function call(rpc: EmbryoFragmentRpc, name: string, args: Record<string, unknown>, signal: AbortSignal) {
  const { data, error } = await rpc(name, args).abortSignal(signal);
  if (error) throw new Error("unavailable");
  return data;
}

/** The Storage API's own DELETE result for one exact object id and version. */
async function deleteSupabaseObject(receipt: z.infer<typeof supabaseReceipt>, signal: AbortSignal) {
  const { origin, key } = preparedStorageConfig();
  const response = await fetch(`${origin}/storage/v1/object/genomes`, { method: "DELETE", signal,
    cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json", "Accept-Encoding": "identity" },
    body: JSON.stringify({ prefixes: [receipt.objectKey] }) });
  const text = response.status === 200 ? await response.text() : "";
  if (response.status !== 200 || text.length > 16_384) throw new Error("unavailable");
  const rows = z.array(z.object({ id: uuid, name: z.string(), bucket_id: z.literal("genomes"), version: uuid,
    metadata: z.object({ size: z.number().int().positive() }).passthrough() }).passthrough()).length(1).parse(JSON.parse(text));
  const row = rows[0];
  if (row.id !== receipt.storageObjectId || row.name !== receipt.objectKey || row.version !== receipt.storageVersion
    || row.metadata.size !== receipt.byteCount) throw new Error("integrity_mismatch");
  return { version: "embryo-ingest-object-delete-evidence-v1", provider: "supabase", disposition: "object-deleted",
    objectId: receipt.storageObjectId, bucket: "genomes", objectKey: receipt.objectKey,
    storageVersion: receipt.storageVersion, byteCount: receipt.byteCount };
}

async function evidenceFor(receipt: EmbryoDisposalReceipt, signal: AbortSignal) {
  if (receipt.backend === "supabase") return deleteSupabaseObject(receipt, signal);
  const marker = await tombstoneEmbryoFragment({ locator: receipt, expiresAt: receipt.claimExpiresAt, signal });
  return { version: "embryo-ingest-object-tombstone-evidence-v1", provider: "r2", disposition: marker.disposition,
    bucket: receipt.bucket, objectKey: receipt.objectKey, providerVersion: marker.providerVersion,
    etag: marker.etag, byteCount: marker.byteCount, sha256: marker.sha256 };
}

/**
 * Claim up to 25 objects of one unwind, dispose of each exactly, record each
 * disposal, then ask SQL to confirm. Returns counts only; it logs nothing and
 * never throws for a single object. Call again later for what stays pending.
 */
export async function drainEmbryoUnwindStorage(input: {
  rpc: EmbryoFragmentRpc; unwindId: string; signal: AbortSignal;
}): Promise<EmbryoUnwindStorageResult> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(25_000)]);
  const token = createHash("sha256").update(randomBytes(32)).digest("hex");
  const claim = claimSchema.parse(await call(input.rpc, "claim_embryo_ingest_object_disposals_v1",
    { p_unwind_id: input.unwindId, p_claim_token_hash: token }, signal));
  if (claim.status !== "claimed" || !("objects" in claim) || claim.unwindId !== input.unwindId) {
    return { status: claim.status, disposed: 0, failed: 0 };
  }
  let disposed = 0, failed = 0;
  for (const receipt of claim.objects as EmbryoDisposalReceipt[]) {
    try {
      if (receipt.unwindId !== input.unwindId || Date.parse(receipt.claimExpiresAt) <= Date.now()) throw new Error();
      const evidence = await evidenceFor(receipt, signal);
      const finished = z.object({ status: z.literal("disposed"), unwindId: z.literal(input.unwindId),
        ordinal: z.literal(receipt.ordinal), state: z.enum(["deleted", "tombstoned"]) }).strict()
        .parse(await call(input.rpc, "finish_embryo_ingest_object_disposal_v1", { p_unwind_id: input.unwindId,
          p_ordinal: receipt.ordinal, p_claim_token_hash: token, p_expected: receipt, p_evidence: evidence }, signal));
      if (finished.state !== (receipt.backend === "r2" ? "tombstoned" : "deleted")) throw new Error();
      disposed++;
    } catch {
      failed++;
      if (signal.aborted) break;
    }
  }
  const confirmation = z.object({ status: z.string() }).passthrough().parse(
    await call(input.rpc, "confirm_embryo_ingest_unwind_storage_v1", { p_unwind_id: input.unwindId }, signal));
  return { status: confirmation.status, disposed, failed };
}

const workSchema = z.array(z.object({ unwindId: uuid, purpose: z.enum(["abandoned", "published"]),
  state: z.enum(["storage_pending", "storage_confirmed"]) }).strict()).max(100);
export type EmbryoUnwindWork = z.infer<typeof workSchema>[number];

/** Unwinds still waiting on storage or on completion, oldest deadline first. */
export async function listEmbryoUnwindWork(input: {
  rpc: EmbryoFragmentRpc; limit?: number; signal: AbortSignal;
}): Promise<EmbryoUnwindWork[]> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 100);
  return workSchema.parse(await call(input.rpc, "embryo_ingest_unwind_work_v1", { p_limit: limit }, input.signal));
}

const completionSchema = z.object({
  status: z.enum(["complete", "planned", "storage_pending"]),
}).passthrough();

/**
 * The step after `storage_confirmed` (20260930130000): an abandoned attempt's
 * terminal graph purge, or a published attempt's fragment-row cleanup. SQL
 * decides which from the unwind and refuses both before storage is
 * confirmed. Anything but `complete` means drain storage and call again.
 */
export async function completeEmbryoUnwind(input: {
  rpc: EmbryoFragmentRpc; unwindId: string; signal: AbortSignal;
}): Promise<{ status: "complete" | "planned" | "storage_pending" }> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(25_000)]);
  const result = completionSchema.parse(await call(input.rpc, "complete_embryo_ingest_unwind_v1",
    { p_unwind_id: input.unwindId }, signal));
  return { status: result.status };
}
