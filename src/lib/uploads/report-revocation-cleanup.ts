import "server-only";
import { z } from "zod";
import type { createAdminClient } from "../supabase/admin";

const receipt = z.object({ outcome: z.enum(["complete", "superseded", "blocked", "retry"]),
  deletedRows: z.number().int().nonnegative().safe() }).strict();

/** Five database-selected atomic steps; supersession is never purge success.
 * This worker cannot name a job, account, object or genetic row. */
export async function drainOwnReportRevocations(admin: ReturnType<typeof createAdminClient>) {
  const rpc = admin.rpc.bind(admin) as unknown as (name: "run_own_report_purge_v1") =>
    PromiseLike<{ data: unknown; error: unknown }>;
  let processed = 0, failed = 0;
  for (let step = 0; step < 5; step++) {
    try {
      const result = await rpc("run_own_report_purge_v1");
      if (result.error) { failed++; break; }
      if (result.data === null) break;
      const parsed = receipt.safeParse(result.data);
      if (!parsed.success || (parsed.data.outcome !== "complete" && parsed.data.deletedRows !== 0)) {
        failed++; break;
      }
      if (parsed.data.outcome === "complete") processed++;
      else if (parsed.data.outcome !== "superseded") failed++;
    } catch { failed++; break; }
  }
  return { processed, failed };
}
