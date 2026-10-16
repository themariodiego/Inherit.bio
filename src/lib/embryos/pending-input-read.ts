import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { EmbryoReadError } from "./cohorts";
import { parsePendingEmbryoInput, pendingEmbryoScopeSchema, type PendingEmbryoScope } from "./pending-input";

type Rpc = (name: "read_pending_embryo_input_v1", args: {
  p_account: string; p_cohort: string; p_embryo: string;
}) => PromiseLike<{ data: unknown; error: unknown }>;

/** Server-only, after authorized cohort selection and the full co-parent
 * capability decision. Atomic native metadata adds no upload/result authority.
 * RPC errors, null, malformed and foreign values are explicit read failures. */
export async function readPendingEmbryoInput(client: SupabaseClient<Database>, scope: PendingEmbryoScope) {
  const expected = pendingEmbryoScopeSchema.safeParse(scope);
  const unavailable = () => new EmbryoReadError("embryo_ingest_sessions", "pending input unavailable");
  if (!expected.success) throw unavailable();
  try {
    const rpc = client.rpc.bind(client) as unknown as Rpc;
    const result = await rpc("read_pending_embryo_input_v1", {
      p_account: expected.data.accountId, p_cohort: expected.data.cohortId, p_embryo: expected.data.embryoId,
    });
    const parsed = result.error === null ? parsePendingEmbryoInput(result.data, expected.data) : null;
    if (!parsed) throw unavailable();
    return parsed;
  } catch { throw unavailable(); }
}
