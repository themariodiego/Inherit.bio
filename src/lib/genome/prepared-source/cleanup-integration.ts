import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { createAdminClient } from "../../supabase/admin";
import { assertPreparedMetadataBounds } from "./canonical-manifest";
import { drainOwnPreparedCleanup } from "./cleanup";

type Admin = ReturnType<typeof createAdminClient>;
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> & {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
};
function boundedRpc(admin: Admin, external?: AbortSignal) {
  const signal = external ? AbortSignal.any([external, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  return async (name: string, args?: Record<string, unknown>) => {
    signal.throwIfAborted(); const operation = rpc(name, args);
    if (typeof operation.abortSignal !== "function") throw new Error("prepared_cleanup_unavailable");
    const result = await operation.abortSignal(signal); signal.throwIfAborted();
    assertPreparedMetadataBounds(result.data, 16384); return result;
  };
}
export const originalDeletionTarget = z.object({ token: z.uuid(), bucket: z.literal("genomes"), name: z.string().min(1) }).strict();
const filePlan = z.object({ version: z.literal("own-prepared-file-cleanup-v1"), original: originalDeletionTarget,
  cleanupId: z.uuid().nullable(), preparedComplete: z.boolean() }).strict().refine(p => p.preparedComplete === (p.cleanupId === null));
const accountPlan = z.object({ version: z.literal("own-prepared-account-cleanup-v1"),
  cleanupIds: z.array(z.uuid()).max(16), preparedComplete: z.boolean() }).strict().refine(p => new Set(p.cleanupIds).size === p.cleanupIds.length
  && p.preparedComplete === (p.cleanupIds.length === 0));

/** Cleanup remains enabled even when new prepared ingestion is disabled. */
export async function prepareFileCleanup(admin: Admin, args: Record<string, string>, signal?: AbortSignal) {
  const rpc = boundedRpc(admin, signal);
  const result = await rpc("prepare_own_prepared_file_cleanup_v1", args);
  if (result.error) return { error: result.error, original: null, complete: false };
  let plan = filePlan.parse(result.data);
  if (!plan.preparedComplete) {
    if (!plan.cleanupId) throw new Error("file_delete_failed");
    const cleanup = await drainOwnPreparedCleanup(admin, { cleanupId: plan.cleanupId, signal });
    if (!cleanup.completed) return { error: null, original: plan.original, complete: false };
    // A previous immutable scratch selection may have completed first. The
    // database must confirm that the full file graph is now retired.
    const current = await rpc("prepare_own_prepared_file_cleanup_v1", args);
    if (current.error) return { error: current.error, original: null, complete: false };
    const confirmed = filePlan.parse(current.data);
    if (!isDeepStrictEqual(confirmed.original, plan.original)) throw new Error("file_delete_failed");
    plan = confirmed;
  }
  return { error: null, original: plan.original, complete: plan.preparedComplete };
}

export async function prepareAccountCleanup(admin: Admin, deletionId: string, token: string, signal: AbortSignal) {
  const rpc = boundedRpc(admin, signal);
  const args = { p_deletion_id: deletionId, p_claim_token_hash: token };
  async function read() {
    const result = await rpc("prepare_account_prepared_cleanup_v1", args);
    if (result.error) throw new Error("prepared_cleanup_unavailable");
    return accountPlan.parse(result.data);
  }
  const plan = await read();
  if (plan.preparedComplete) return true;
  // One page per account keeps the existing 300-second retention invocation
  // bounded; subsequent scheduled runs resume exact durable progress.
  if (!plan.cleanupIds.length) throw new Error("prepared_cleanup_unavailable");
  const drained = await drainOwnPreparedCleanup(admin, { cleanupId: plan.cleanupIds[0], signal });
  if (!drained.completed) return false;
  return (await read()).preparedComplete;
}

export async function drainPreparedScratch(admin: Admin, signal: AbortSignal) {
  const rpc = boundedRpc(admin, signal);
  const selected = await rpc("prepare_due_prepared_scratch_v1");
  if (selected.error || typeof selected.data !== "number" || !Number.isInteger(selected.data) || selected.data < 0 || selected.data > 5) return { processed: 0, failed: 1 };
  const result = await drainOwnPreparedCleanup(admin, { signal });
  return { processed: result.processed, failed: Number(result.failed || result.unresolved) };
}
