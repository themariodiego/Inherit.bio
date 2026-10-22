import "server-only";
import { z } from "zod";
import type { EmbryoFragmentRpc } from "./fragment-storage";
import { completeEmbryoUnwind, drainEmbryoUnwindStorage } from "./unwind-storage";

const page = z.array(z.object({ unwindId: z.uuid(), purpose: z.enum(["abandoned", "published", "source"]),
  state: z.enum(["storage_pending", "storage_confirmed"]) }).strict()).max(100)
  .refine(rows => new Set(rows.map(row => row.unwindId)).size === rows.length);

/** Only SQL's current account-deletion claim can select this bounded page.
 * Unresolved disposal stops before the account's Storage completion or Auth
 * deletion. Provider evidence is handled by the existing exact object doors. */
export async function drainAccountEmbryoCleanup(input: {
  rpc: EmbryoFragmentRpc; deletionId: string; claimToken: string; signal: AbortSignal;
}): Promise<boolean> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90_000)]);
  const read = async () => {
    signal.throwIfAborted();
    const { data, error } = await input.rpc("account_embryo_unwinds_v1", {
      p_deletion_id: input.deletionId, p_claim_token_hash: input.claimToken,
    }).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error("embryo_cleanup_unavailable");
    return page.parse(data);
  };
  const selected = await read();
  if (selected.length === 0) return true;
  // One exact unwind and at most 25 provider objects per account invocation.
  // Later claims resume the same durable plan and the same original deadline.
  const work = selected[0];
  if (work.state === "storage_pending") {
    const drained = await drainEmbryoUnwindStorage({ rpc: input.rpc, unwindId: work.unwindId, signal });
    if (drained.failed || drained.status !== "storage_confirmed") return false;
  }
  const completed = await completeEmbryoUnwind({ rpc: input.rpc, unwindId: work.unwindId, signal });
  if (completed.status !== "complete") return false;
  return (await read()).length === 0;
}
