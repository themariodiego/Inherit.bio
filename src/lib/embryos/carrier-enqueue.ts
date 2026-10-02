import "server-only";
import { z } from "zod";
import { allowedConditionsRegistry } from "./allowed-conditions";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { createAdminClient } from "../supabase/admin";

/** Called after an actual purpose-grant or whole-source publication commits.
 * The database resolves all principals, sources and reviewed assertions again.
 * A grant remains valid when another required principal has not granted yet;
 * this separate capture refuses until the complete cohort is admitted. */
export async function enqueueCurrentEmbryoCarrier(cohortId: string, signal?: AbortSignal): Promise<void> {
  if (!isTestJurisdictionEnabled() || allowedConditionsRegistry().conditions.length === 0) return;
  if (!z.uuid().safeParse(cohortId).success || signal?.aborted) return;
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: object) => {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  };
  // This request does not compute or reveal a result. Queue binding and replay
  // are entirely server-owned. Refusal leaves the committed grant/source valid.
  try {
    const result = await rpc("enqueue_embryo_carrier_v1", { p_cohort_id: cohortId, p_test_jurisdiction: true })
      .abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000));
    if (result.error !== null) return;
    const queued = z.object({ status: z.literal("queued"), jobId: z.uuid() }).strict();
    const held = z.object({ status: z.literal("held"), reason: z.literal("no_registered_conditions") }).strict();
    if (!queued.safeParse(result.data).success && !held.safeParse(result.data).success) return;
  } catch {
    // A failed queue capture must not misreport a committed grant or published
    // source as failed. A later repeated grant/publication can retry admission.
    return;
  }
}
