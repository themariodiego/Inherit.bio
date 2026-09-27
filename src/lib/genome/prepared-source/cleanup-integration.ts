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

/** The owner path prepares under the owner's Auth session; the retention
 * backstop prepares the same stranded record under a claim token. Both SQL
 * procedures return the same plan and select the same prepared cleanup. */
export type FileCleanupProcedure = "prepare_own_prepared_file_cleanup_v1" | "prepare_own_prepared_file_cleanup_claimed_v1";

/** Cleanup remains enabled even when new prepared ingestion is disabled. */
export async function prepareFileCleanup(admin: Admin, args: Record<string, string>, signal?: AbortSignal,
  procedure: FileCleanupProcedure = "prepare_own_prepared_file_cleanup_v1") {
  const rpc = boundedRpc(admin, signal);
  const result = await rpc(procedure, args);
  if (result.error) return { error: result.error, original: null, complete: false };
  let plan = filePlan.parse(result.data);
  if (!plan.preparedComplete) {
    if (!plan.cleanupId) throw new Error("file_delete_failed");
    const cleanup = await drainOwnPreparedCleanup(admin, { cleanupId: plan.cleanupId, signal });
    if (!cleanup.completed) return { error: null, original: plan.original, complete: false };
    // A previous immutable scratch selection may have completed first. The
    // database must confirm that the full file graph is now retired.
    const current = await rpc(procedure, args);
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

export type PreparedScratchStop = "idle" | "bounded" | "no_progress" | "failed" | "unresolved" | "cancelled";
export type PreparedScratchDrain = { processed: number; failed: number; stop: PreparedScratchStop };

/** Serial pages under a new 150-second aggregate orchestration envelope. Each
 * page retains its 16-entry/25-second limit and fresh 30-second SQL claim. No
 * failed or uncertain page is retried here. SQL selects current durable work;
 * neither a page completion nor this drain means every provider object is gone.
 * A null claim means only that no cleanup is currently eligible for this worker.
 */
export async function drainPreparedScratch(admin: Admin, signal: AbortSignal): Promise<PreparedScratchDrain> {
  const deadline = new AbortController(), current = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), 150_000); timer.unref();
  let processed = 0;
  const stopped = (): PreparedScratchStop | undefined => signal.aborted ? "cancelled" : deadline.signal.aborted ? "bounded" : undefined;
  const result = (stop: PreparedScratchStop, failed = 0): PreparedScratchDrain => ({ processed, failed, stop });
  try {
    if (stopped()) return result(stopped()!);
    const selected = await boundedRpc(admin, current)("prepare_due_prepared_scratch_v1");
    if (selected.error || typeof selected.data !== "number" || !Number.isInteger(selected.data) || selected.data < 0 || selected.data > 5) return result("failed", 1);
    // 256 bounded pages cover at most one full 4,096-artifact job per drain.
    // More jobs, slow I/O or competing claims remain for later invocations.
    for (let page = 0; page < 256; page++) {
      if (stopped()) return result(stopped()!);
      const drained = await drainOwnPreparedCleanup(admin, { signal: current });
      processed += drained.processed;
      if (stopped()) return result(stopped()!, Number(drained.failed));
      if (drained.failed) return result("failed", 1);
      if (drained.unresolved) return result("unresolved", 1);
      if (drained.processed === 0) return result(drained.pending || drained.completed ? "no_progress" : "idle");
    }
    return result("bounded");
  } catch {
    return result(stopped() ?? "failed", 1);
  } finally { clearTimeout(timer); deadline.abort(); }
}
