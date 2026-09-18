import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { createAdminClient } from "../supabase/admin";
import { originalDeletionTarget, prepareFileCleanup } from "../genome/prepared-source/cleanup-integration";

const claimSchema = z.object({
  version: z.literal("genome-file-deletion-claim-v1"),
  fileId: z.uuid(),
  bucket: z.literal("genomes"),
  name: z.string().min(1).max(1_024),
  claimExpiresAt: z.iso.datetime({ offset: true }),
}).strict();

/** Seven-day backstop for `source.revocation-7d` (D-126). A self file deletion
 * whose Storage removal or database finish did not complete leaves its record
 * behind with the file already unreadable; the owner path retries only when
 * the owner clicks again. This database-selected page redoes the same prepared
 * cleanup, the same Storage removal of the record's own bucket and name, and
 * the same finish under a claim token instead of the owner's session. No
 * caller-supplied target, no identifier leaves this function, and a lost
 * acknowledgement is left for the next run rather than repeated. */
export async function drainStrandedFileDeletions(admin: ReturnType<typeof createAdminClient>, signal: AbortSignal) {
  let processed = 0, failed = 0;
  for (let index = 0; index < 3; index++) {
    const token = createHash("sha256").update(randomBytes(32)).digest("hex");
    const claim = await admin.rpc("claim_due_genome_file_deletion_v1", { p_claim_token_hash: token });
    if (claim.error) { failed++; break; }
    if (claim.data === null) break;
    const parsed = claimSchema.safeParse(claim.data);
    if (!parsed.success) { failed++; break; }
    const args = { p_file_id: parsed.data.fileId, p_claim_token_hash: token };
    const release = () => Promise.resolve(admin.rpc("fail_genome_file_deletion_claim_v1", args)).catch(() => {});
    try {
      const prepared = await prepareFileCleanup(admin, args, signal, "prepare_own_prepared_file_cleanup_claimed_v1");
      if (prepared.error) throw new Error("file_deletion_backstop_unavailable");
      if (!prepared.complete) {
        // Prepared artifacts are still being retired. The record keeps its
        // fixed deadline and its last attempt time; the next run resumes it.
        await release();
        continue;
      }
      const target = originalDeletionTarget.parse(prepared.original);
      if (target.bucket !== parsed.data.bucket || target.name !== parsed.data.name) {
        throw new Error("file_deletion_backstop_unavailable");
      }
      const removal = await admin.storage.from(target.bucket).remove([target.name]);
      // A successful empty list is the Storage API's idempotent ACK when a
      // previous attempt removed the object but database completion failed.
      if (removal.error || !Array.isArray(removal.data)) throw new Error("file_deletion_backstop_unavailable");
      const finished = await admin.rpc("finish_genome_file_deletion_claimed_v1", args);
      if (finished.error) throw new Error("file_deletion_backstop_unavailable");
      processed++;
    } catch {
      await release();
      failed++; break;
    }
  }
  return { processed, failed };
}
