import { z } from "zod";
import { getSensitiveAccountContext, isSameOrigin } from "@/lib/account-deletion";
import { createAdminClient } from "@/lib/supabase/admin";

const target = z.object({ token: z.string().uuid(), bucket: z.literal("genomes"), name: z.string().min(1) }).strict();
const headers = { "Cache-Control": "private, no-store" };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return failure("file_delete_unauthorized", 403);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return failure("file_delete_not_found", 404);
  const account = await getSensitiveAccountContext();
  if (!account) return failure("file_delete_unauthorized", 401);
  const admin = createAdminClient();
  const args = { p_account_id: account.user.id, p_session_id: account.sessionId, p_file_id: id };
  try {
    const prepared = await admin.rpc("prepare_genome_file_deletion_v1", args);
    if (prepared.error) {
      const message = prepared.error.message;
      if (message.includes("file_delete_not_found")) return failure("file_delete_not_found", 404);
      if (message.includes("file_delete_unauthorized")) return failure("file_delete_unauthorized", 401);
      if (message.includes("file_delete_processing")) return failure("file_delete_processing", 409);
      if (message.includes("file_delete_shared_graph") || message.includes("file_delete_subject_unavailable")) {
        return failure("file_delete_subject_unavailable", 409);
      }
      return failure("file_delete_failed", 503);
    }
    const manifest = target.safeParse(prepared.data);
    if (!manifest.success) return failure("file_delete_failed", 503);
    const { data: removed, error } = await admin.storage.from(manifest.data.bucket).remove([manifest.data.name]);
    // A successful empty list is the Storage API's idempotent ACK when a
    // previous attempt removed the object but database completion failed.
    if (error || !Array.isArray(removed)) return failure("file_delete_failed", 503);
    const finished = await admin.rpc("finish_genome_file_deletion_v1", { ...args, p_token: manifest.data.token });
    if (finished.error) return failure("file_delete_failed", 503);
    return new Response(null, { status: 204, headers });
  } catch {
    return failure("file_delete_failed", 503);
  }
}
