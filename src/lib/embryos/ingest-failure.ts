import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IngestAuthorizationArgs } from "./ingest-http";

type UnwindRpc = (
  name: "prepare_embryo_ingest_unwind_v1",
  args: { p_cohort_id: string; p_ingest_revision: number },
) => PromiseLike<{ error: unknown }>;

/**
 * The one registered event a failed dispatch may emit
 * (`observabilityCodeRegistries`, owner decision 5A of 28 September): a
 * template id and two registered codes, and nothing copied from the request,
 * the attempt or the error.
 */
export const UNWIND_DISPATCH_BLOCKED = "feature.blocked embryo.ingest-unwind-dispatch unwind-dispatch-unavailable";

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
 * existing fixed deadline. The failure is recorded only as the registered
 * `feature.blocked` event.
 */
export async function dispatchIngestAttemptFailure(
  authority: { cohortId: string; ingestRevision: number },
  rpc: UnwindRpc = (name, args) => createAdminClient().rpc(name, args),
): Promise<void> {
  try {
    const { error } = await rpc("prepare_embryo_ingest_unwind_v1", {
      p_cohort_id: authority.cohortId,
      p_ingest_revision: authority.ingestRevision,
    });
    if (error) console.error(UNWIND_DISPATCH_BLOCKED);
  } catch {
    console.error(UNWIND_DISPATCH_BLOCKED);
  }
}

/** The terminal branches a route decides in memory; the database decides every other one. */
export type RouteFailureCode = "format" | "header" | "chunk" | "limit" | "abort";

const failed = z.object({
  status: z.literal("failure_pending"),
  cohortId: z.uuid(),
  ingestRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

type FailRpc = (
  name: "fail_embryo_ingest_attempt_v1",
  args: IngestAuthorizationArgs & { p_cohort_id: string; p_ingest_revision: number; p_code: RouteFailureCode },
) => PromiseLike<{ data: unknown; error: unknown }>;

/**
 * Record a terminal branch the route found in memory, then dispatch the
 * unwind. The door re-locks the exact credential-bound session, cohort and
 * ingest revision before marking anything, so it cannot touch another
 * attempt.
 *
 * True only when the attempt is now failure-pending. A caller must not give a
 * terminal answer on false: the attempt is still live, and a retry of the
 * same request will reach the same branch and record it.
 */
export async function failIngestAttempt(
  credentials: IngestAuthorizationArgs,
  authority: { cohortId: string; ingestRevision: number },
  code: RouteFailureCode,
  rpc: FailRpc = async (name, args) => createAdminClient().rpc(name, args),
  dispatch: typeof dispatchIngestAttemptFailure = dispatchIngestAttemptFailure,
): Promise<boolean> {
  try {
    const { data, error } = await rpc("fail_embryo_ingest_attempt_v1", {
      ...credentials,
      p_cohort_id: authority.cohortId,
      p_ingest_revision: authority.ingestRevision,
      p_code: code,
    });
    const result = failed.safeParse(data);
    if (error || !result.success) return false;
    await dispatch(result.data);
    return true;
  } catch {
    return false;
  }
}
