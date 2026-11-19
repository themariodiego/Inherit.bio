import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { originalDeletionTarget, prepareFileCleanup } from "@/lib/genome/prepared-source/cleanup-integration";

type Admin = ReturnType<typeof createAdminClient>;

/** How many prepared files one request finishes; the rest wait for the backstop. */
export const SUBJECT_FILE_DRAIN_LIMIT = 16;
/** The share of the route's 60 seconds this drain may use. */
export const SUBJECT_FILE_DRAIN_BUDGET_MS = 40_000;

export type SubjectFileDrain = Readonly<{ finished: number; deferred: number }>;

/**
 * After `delete_subject_v1` has emptied a self record, each of its files is
 * already prepared: unreadable, with its exact Storage target recorded. This
 * finishes them the way `api.file-delete` does, one at a time: the same
 * owner-path prepare (which returns the recorded target and drains any
 * prepared artifacts), the Storage remove, then the finish, which deletes
 * the file row and its variants only once Storage no longer lists the
 * object. Nothing here decides what is deleted: the database already did.
 *
 * Any file this request does not finish (an error, a timeout, a pending
 * prepared cleanup, or more files than the limit) keeps its deletion record
 * and is finished by the seven-day backstop (source.revocation-7d), so a
 * failure here never changes the accepted answer.
 */
export async function drainSubjectFileDeletions(
  admin: Admin,
  owner: Readonly<{ accountId: string; sessionId: string }>,
  fileIds: readonly string[],
  external?: AbortSignal,
): Promise<SubjectFileDrain> {
  const signal = external
    ? AbortSignal.any([external, AbortSignal.timeout(SUBJECT_FILE_DRAIN_BUDGET_MS)])
    : AbortSignal.timeout(SUBJECT_FILE_DRAIN_BUDGET_MS);
  let finished = 0;
  for (const fileId of fileIds.slice(0, SUBJECT_FILE_DRAIN_LIMIT)) {
    if (signal.aborted) break;
    const args = { p_account_id: owner.accountId, p_session_id: owner.sessionId, p_file_id: fileId };
    try {
      const prepared = await prepareFileCleanup(admin, args, signal);
      if (prepared.error || !prepared.complete) continue;
      const target = originalDeletionTarget.safeParse(prepared.original);
      if (!target.success) continue;
      const { data: removed, error } = await admin.storage.from(target.data.bucket).remove([target.data.name]);
      // An empty list is Storage's idempotent answer when an earlier attempt
      // already removed the object.
      if (error || !Array.isArray(removed)) continue;
      const done = await admin.rpc("finish_genome_file_deletion_v1", { ...args, p_token: target.data.token });
      if (!done.error) finished += 1;
    } catch {
      // Left to the backstop.
    }
  }
  return Object.freeze({ finished, deferred: fileIds.length - finished });
}
