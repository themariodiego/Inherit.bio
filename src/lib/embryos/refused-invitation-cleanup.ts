import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";

const manifest = z.array(z.object({
  objectId: z.uuid(),
  bucketId: z.literal("legal-evidence"),
  objectName: z.string().min(1).max(1_024),
  ordinal: z.number().int().positive(),
}).strict()).max(10_000);

/** Server-selected work only; no account, draft, bucket or path input. */
export async function drainRefusedInvitationCleanup(admin: ReturnType<typeof createAdminClient>) {
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < 5; index++) {
    const claim = createHash("sha256").update(randomBytes(32)).digest("hex");
    const { data, error } = await admin.rpc("claim_refused_invitation_draft_purge_v1", {
      p_claim_token_hash: claim,
    });
    if (error) { failed++; break; }
    const work = data?.[0];
    if (!work) break;
    try {
      const objects = manifest.parse(work.storage_objects);
      for (let offset = 0; offset < objects.length; offset += 1_000) {
        const batch = objects.slice(offset, offset + 1_000);
        const { error: storageError } = await admin.storage.from("legal-evidence")
          .remove(batch.map((entry) => entry.objectName));
        if (storageError) throw new Error("refusal_storage_delete_failed");
        const { error: receiptError } = await admin.rpc("complete_refused_invitation_storage_v1", {
          p_manifest_id: work.manifest_id,
          p_claim_token_hash: claim,
          p_ordinals: batch.map((entry) => entry.ordinal),
        });
        if (receiptError) throw new Error("refusal_storage_receipt_failed");
      }
      const { error: finishError } = await admin.rpc("finish_refused_invitation_draft_purge_v1", {
        p_manifest_id: work.manifest_id,
        p_claim_token_hash: claim,
      });
      if (finishError) throw new Error("refusal_database_purge_failed");
      processed++;
    } catch {
      // Never log paths or evidence/provider errors. Stop this drain so one
      // outage does not spend all five attempts on the same due draft.
      await admin.rpc("fail_refused_invitation_draft_purge_v1", {
        p_manifest_id: work.manifest_id,
        p_claim_token_hash: claim,
      });
      failed++;
      break;
    }
  }
  return { processed, failed };
}
