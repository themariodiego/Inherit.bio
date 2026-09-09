import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { createAdminClient } from "../../supabase/admin";
import { assertPreparedMetadataBounds } from "./canonical-manifest";
import { tombstonePreparedR2 } from "./r2-transport";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const key = z.string().regex(/^prepared\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const common = { objectKey: key, byteCount: z.number().int().min(1).max(8388608), sha256: hash };
export const preparedCleanupLocatorSchema = z.discriminatedUnion("provider", [
  z.object({ ...common, provider: z.literal("r2"), bucket: z.string().regex(/^inherit-prepared-[a-z0-9-]{1,40}$/),
    providerVersion: z.string().regex(/^[0-9a-f]{32}$/).nullable(), etag: z.string().regex(/^[0-9a-f]{32}$/).nullable() }).strict(),
  z.object({ ...common, provider: z.literal("supabase"), bucket: z.literal("genomes"),
    storageObjectId: uuid.nullable(), storageVersion: uuid.nullable() }).strict(),
]);
const entrySchema = z.object({ artifactId: uuid, sequence: z.number().int().min(0).max(4095), locator: preparedCleanupLocatorSchema }).strict();
const claimSchema = z.object({ version: z.literal("own-prepared-cleanup-claim-v1"), cleanupId: uuid,
  mode: z.enum(["file", "account", "published-scratch", "unpublished-scratch"]),
  claimExpiresAt: z.iso.datetime({ offset: true }), cleanupDeadline: z.iso.datetime({ offset: true }),
  writeFenceAt: z.iso.datetime({ offset: true }), entries: z.array(entrySchema).max(16),
}).strict().refine(c => new Set(c.entries.map(e => e.artifactId)).size === c.entries.length
  && new Set(c.entries.map(e => e.sequence)).size === c.entries.length
  && new Set(c.entries.map(e => `${e.locator.provider}:${e.locator.bucket}:${e.locator.objectKey}`)).size === c.entries.length
  && c.entries.every((e, i) => i === 0 || e.sequence > c.entries[i - 1].sequence));
const evidenceSchema = z.object({ disposition: z.literal("payload-tombstoned"),
  providerVersion: z.string().regex(/^[0-9a-f]{32}$/), etag: z.literal("d41d8cd98f00b204e9800998ecf8427e"),
  byteCount: z.literal(0), sha256: z.literal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
}).strict();
type RpcResult = { data: unknown; error: unknown };
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult> & {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>;
};
export type PreparedCleanupResult = { processed: number; completed: boolean; pending: boolean; failed: boolean; unresolved: boolean };

/** One bounded SQL-selected page. No browser keys, global provider listings,
 * genetic reads, or inferred success from missing metadata. R2 fences remain
 * permanently; completion means payload-tombstoned, never all keys absent.
 * Supabase physical-version cleanup has no approved application capability and
 * remains unresolved. A later invocation resumes durable per-entry progress. */
export async function drainOwnPreparedCleanup(admin: ReturnType<typeof createAdminClient>,
  options: { cleanupId?: string; signal?: AbortSignal } = {}): Promise<PreparedCleanupResult> {
  if (options.cleanupId !== undefined) uuid.parse(options.cleanupId);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000);
  const token = createHash("sha256").update(randomBytes(32)).digest("hex");
  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  let claim: z.infer<typeof claimSchema> | undefined;
  let processed = 0;
  const active = () => { if (signal.aborted) throw new Error("cleanup_aborted"); };
  async function call(name: string, args: Record<string, unknown>) {
    active();
    const operation = rpc(name, args);
    if (typeof operation.abortSignal !== "function") throw new Error("cleanup_unavailable");
    const response = await operation.abortSignal(signal);
    active(); if (response.error) throw new Error("cleanup_unavailable"); return response.data;
  }
  const args = () => ({ p_cleanup_id: claim!.cleanupId, p_claim_token_hash: token });
  try {
    const raw = await call("claim_own_prepared_cleanup_v1", { p_claim_token_hash: token, p_cleanup_id: options.cleanupId ?? null });
    if (raw === null) return { processed: 0, completed: false, pending: Boolean(options.cleanupId), failed: false, unresolved: false };
    // Bounded RPC receipt before schema cloning; no all-file metadata is retained.
    assertPreparedMetadataBounds(raw, 65536);
    claim = claimSchema.parse(raw);
    if (options.cleanupId && claim.cleanupId !== options.cleanupId) throw new Error("cleanup_unavailable");
    if (Date.parse(claim.claimExpiresAt) <= Date.now()) throw new Error("cleanup_unavailable");
    for (const entry of claim.entries) {
      const current = entrySchema.parse(await call("check_own_prepared_cleanup_entry_v1", { ...args(), p_artifact_id: entry.artifactId }));
      if (!isDeepStrictEqual(current, entry)) throw new Error("cleanup_unavailable");
      if (entry.locator.provider === "supabase") {
        await call("release_own_prepared_cleanup_v1", args());
        return { processed, completed: false, pending: true, failed: false, unresolved: true };
      }
      const evidence = evidenceSchema.parse(await tombstonePreparedR2(entry.locator, claim.claimExpiresAt, signal));
      active();
      const acknowledged = await call("ack_own_prepared_cleanup_entry_v1", { ...args(), p_artifact_id: entry.artifactId,
        p_expected: entry, p_evidence: evidence });
      if (acknowledged !== true) throw new Error("cleanup_unavailable");
      processed++;
    }
    const finished = await call("finish_own_prepared_cleanup_v1", args());
    if (typeof finished !== "boolean") throw new Error("cleanup_unavailable");
    if (!finished) await call("release_own_prepared_cleanup_v1", args());
    return { processed, completed: finished, pending: !finished, failed: false, unresolved: false };
  } catch {
    // A lost ACK can have committed. Never repeat the provider operation here.
    // Expired/aborted claims become eligible naturally; cleanup clocks persist.
    if (claim && !signal.aborted) { try { await call("release_own_prepared_cleanup_v1", args()); } catch { /* finite claim expires */ } }
    return { processed, completed: false, pending: true, failed: true, unresolved: false };
  }
}
