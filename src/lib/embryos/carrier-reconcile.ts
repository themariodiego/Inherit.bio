import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { allowedConditionsRegistry, type AllowedConditionsFile } from "./allowed-conditions";
import { adminEmbryoCarrierRpc, EmbryoCarrierWorkerError, type EmbryoCarrierRpc } from "./carrier-worker";

const page = z.object({ version: z.literal("embryo-carrier-reconcile-v1"),
  checked: z.number().int().min(0).max(4), queued: z.number().int().min(0).max(4),
  nextCursor: z.uuid().nullable(),
}).strict().refine(value => value.queued <= value.checked
  && (value.nextCursor !== null) === (value.checked === 4));
export type EmbryoCarrierReconciliation = z.infer<typeof page>
  | { status: "held"; reason: "no_registered_conditions" };

/** Recover intake from durable current cohort/source/grant rows. No request
 * must be replayed after a crash. A process cursor advances through bounded
 * pages; a restart begins another complete pass. Full admission and enqueue
 * identities remain database-owned, with no genotype read by this operation. */
export async function reconcileNextEmbryoCarriers(options: { signal?: AbortSignal;
  afterCohortId?: string | null; rpc?: EmbryoCarrierRpc; registry?: AllowedConditionsFile;
} = {}): Promise<EmbryoCarrierReconciliation> {
  const active = () => {
    if (!isTestJurisdictionEnabled()) throw new EmbryoCarrierWorkerError("worker_disabled");
    if (options.signal?.aborted) throw new EmbryoCarrierWorkerError("aborted");
  };
  active();
  if ((options.registry ?? allowedConditionsRegistry()).conditions.length === 0)
    return { status: "held", reason: "no_registered_conditions" };
  const after = z.uuid().nullable().safeParse(options.afterCohortId ?? null);
  if (!after.success) throw new EmbryoCarrierWorkerError("invalid_response");
  const signal = options.signal ?? new AbortController().signal;
  const value = await (options.rpc ?? adminEmbryoCarrierRpc())("embryo_carrier_worker_v1", {
    p_operation: "reconcile", p_job_id: null, p_attempt: null, p_claim_token_hash: randomBytes(32).toString("hex"),
    p_payload: { afterCohortId: after.data }, p_test_jurisdiction: true,
  }, signal);
  active();
  const result = page.safeParse(value);
  if (!result.success || (result.data.nextCursor !== null && after.data !== null
    && result.data.nextCursor <= after.data)) throw new EmbryoCarrierWorkerError("invalid_response");
  return result.data;
}
