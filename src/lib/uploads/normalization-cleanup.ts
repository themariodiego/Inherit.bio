import "server-only";
import type { createAdminClient } from "../supabase/admin";

/** Reaps at most five database-selected expired preparation runs. It never
 * reads or removes source objects, published genetic rows, reports or grants. */
export async function drainOwnNormalizationCleanup(admin: ReturnType<typeof createAdminClient>) {
  const rpc = admin.rpc.bind(admin) as unknown as (name: "reap_expired_own_normalizations_v1") =>
    PromiseLike<{ data: unknown; error: unknown }>;
  try {
    const result = await rpc("reap_expired_own_normalizations_v1");
    if (result.error || typeof result.data !== "number" || !Number.isInteger(result.data)
      || result.data < 0 || result.data > 5) return { processed: 0, failed: 1 };
    return { processed: result.data, failed: 0 };
  } catch { return { processed: 0, failed: 1 }; }
}
