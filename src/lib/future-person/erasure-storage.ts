import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { EMBRYO_FRAGMENT_MAX_BYTES, EMBRYO_R2_BUCKET, EMBRYO_R2_KEY, tombstoneEmbryoFragment,
  type EmbryoFragmentRpc } from "@/lib/embryos/fragment-storage";

const receipt = z.object({ version: z.literal("future-person-source-disposal-v1"), manifestId: z.uuid(),
  ordinal: z.number().int().min(1).max(50), bucket: z.string().regex(EMBRYO_R2_BUCKET),
  objectKey: z.string().regex(EMBRYO_R2_KEY), byteCount: z.number().int().min(1).max(EMBRYO_FRAGMENT_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u), claimExpiresAt: z.iso.datetime({ offset: true }) }).strict();
const claim = z.object({ status: z.literal("claimed"), manifestId: z.uuid(), objects: z.array(receipt).max(25) }).strict()
  .refine(value => new Set(value.objects.map(row => row.ordinal)).size === value.objects.length
    && new Set(value.objects.map(row => `${row.bucket}/${row.objectKey}`)).size === value.objects.length
    && value.objects.every(row => row.manifestId === value.manifestId));

/** Dispose only SQL's sealed claimed-subject inventory. Empty markers fence
 * late writes permanently. A missing/malformed/expired answer is no proof;
 * no retry or deadline renewal happens here. This does not claim full subject
 * deletion: canonical custody and provenance remain until the graph executor
 * has separately proved complete cleanup. */
export async function drainClaimantSource(input: { rpc: EmbryoFragmentRpc; manifestId: string; signal: AbortSignal }) {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(25_000)]);
  const token = createHash("sha256").update(randomBytes(32)).digest("hex");
  const call = async (operation: "claim" | "acknowledge" | "proof", extra: Record<string, unknown> = {}) => {
    signal.throwIfAborted();
    const { data, error } = await input.rpc("future_person_deletion_parts_v1", {
      p_operation: operation, p_manifest: input.manifestId, p_claim_token_hash: token, ...extra,
    }).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error("claimant_cleanup_unavailable");
    return data;
  };
  const selected = claim.parse(await call("claim"));
  if (selected.manifestId !== input.manifestId || selected.objects.some(row => Date.parse(row.claimExpiresAt) <= Date.now())) {
    throw new Error("claimant_cleanup_unavailable");
  }
  let disposed = 0, failed = 0;
  for (const row of selected.objects) {
    try {
      if (Date.parse(row.claimExpiresAt) <= Date.now()) throw new Error("claimant_cleanup_unavailable");
      const marker = await tombstoneEmbryoFragment({ locator: row, expiresAt: row.claimExpiresAt, signal });
      z.object({ status: z.literal("tombstone_acknowledged"), manifestId: z.literal(input.manifestId),
        ordinal: z.literal(row.ordinal) }).strict().parse(await call("acknowledge", {
        p_expected: row, p_evidence: { ...marker, bucket: row.bucket, objectKey: row.objectKey },
      }));
      disposed++;
    } catch { failed++; if (signal.aborted) break; }
  }
  const result = z.object({ status: z.enum(["source_pending", "source_tombstoned"]) }).strict().parse(await call("proof"));
  if (failed && result.status === "source_tombstoned") throw new Error("claimant_cleanup_unavailable");
  return { status: result.status, disposed, failed };
}
