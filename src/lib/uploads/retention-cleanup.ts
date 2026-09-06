import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { createAdminClient } from "../supabase/admin";

const workSchema = z.object({ manifestId: z.uuid(), objects: z.array(z.object({
  objectId: z.uuid(), bucketId: z.literal("genomes"), objectName: z.uuid().regex(/^[0-9a-f-]+$/),
  ordinal: z.number().int().positive(),
}).strict()).min(1).max(2) }).strict().refine(work =>
  new Set(work.objects.map(object => object.objectName)).size === work.objects.length
  && new Set(work.objects.map(object => object.ordinal)).size === work.objects.length);

/** Scheduled database-selected upload expiry. No caller-supplied target/path,
 * normal-user token, genetic read, mail or analysis operation is involved. */
export async function drainOwnUploadCleanup(admin: ReturnType<typeof createAdminClient>) {
  let processed = 0, failed = 0;
  for (let index = 0; index < 5; index++) {
    const token = createHash("sha256").update(randomBytes(32)).digest("hex");
    const claim = await admin.rpc("claim_own_upload_purge_v1", { p_claim_token_hash: token });
    if (claim.error) { failed++; break; }
    if (claim.data === null) break;
    const parsed = workSchema.safeParse(claim.data);
    if (!parsed.success) { failed++; break; }
    const work = parsed.data;
    const args = { p_manifest_id: work.manifestId, p_claim_token_hash: token };
    try {
      const authority = await admin.rpc("authorize_own_upload_purge_v1", args);
      if (authority.error || authority.data !== true) throw new Error("upload_cleanup_unavailable");
      const deletion = await admin.storage.from("genomes").remove(work.objects.map(object => object.objectName));
      if (deletion.error) throw new Error("upload_cleanup_unavailable");
      const finish = await admin.rpc("finish_own_upload_purge_v1", args);
      if (finish.error || finish.data !== true) throw new Error("upload_cleanup_unavailable");
      processed++;
    } catch {
      await Promise.resolve(admin.rpc("fail_own_upload_purge_v1", args)).catch(() => {});
      failed++; break;
    }
  }
  return { processed, failed };
}
