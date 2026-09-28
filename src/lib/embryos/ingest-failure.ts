import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type UnwindRpc = (
  name: "prepare_embryo_ingest_unwind_v1",
  args: { p_cohort_id: string; p_ingest_revision: number },
) => PromiseLike<{ error: unknown }>;

/**
 * Dispatch `policyResolvers.embryo-ingest-session-v1.attemptFailure` for an
 * attempt the database has already marked failure-pending.
 *
 * The one idempotency key is the cohort plus its ingest revision. This asks
 * `prepare_embryo_ingest_unwind_v1` to lock that exact attempt and freeze its
 * unwind manifest; it never deletes the session, its fixed-deadline due
 * target, a fragment or the handle map. Everything after the manifest (the
 * Storage deletion acknowledgement and the terminal purge) belongs to ADR
 * 0020's safeguards, which run against this same key.
 *
 * Dispatch cannot fail the request that caused it. The failure is already
 * committed, and the attempt stays failure-pending whatever happens here, so
 * a dispatch that errors is retried by the retention worker at the session's
 * existing fixed deadline. Nothing is logged: no registered observability
 * event covers it, and an ad hoc line could carry an identifier.
 */
export async function dispatchIngestAttemptFailure(
  authority: { cohortId: string; ingestRevision: number },
  rpc: UnwindRpc = (name, args) => createAdminClient().rpc(name, args),
): Promise<void> {
  try {
    await rpc("prepare_embryo_ingest_unwind_v1", {
      p_cohort_id: authority.cohortId,
      p_ingest_revision: authority.ingestRevision,
    });
  } catch {
    // Deliberately empty: see above.
  }
}
