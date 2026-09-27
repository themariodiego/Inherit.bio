import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OwnCopilotAuthority } from "./own-provider-authority";
import type { OwnChatProjection } from "./own-chat-content";
import { OWN_ANCESTRY_REPORT, ownChatAncestryReceiptSchema, type OwnChatAncestryReceipt } from "./own-chat-ancestry-content";

function sameInstant(a: string, b: string) {
  return Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
}

/** Copilot authority is checked around each service-only, source-bound content read. */
export async function readOwnChatAncestry(authority: OwnCopilotAuthority, projection: OwnChatProjection,
  check: () => Promise<void>): Promise<OwnChatAncestryReceipt[]> {
  await check();
  const db = createAdminClient();
  const { data: collision, error } = await db.from("report_templates").select("slug")
    .eq("slug", OWN_ANCESTRY_REPORT).eq("status", "published").maybeSingle();
  if (error || collision) throw new Error("copilot_unavailable");
  await check();
  const rpc = db.rpc.bind(db) as unknown as (name: "own_copilot_ancestry_v1", args: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: unknown }>;
  const receipts: OwnChatAncestryReceipt[] = [];
  for (const source of projection.sources) {
    const completion = source.completed.find(c => c.purpose === "ancestry");
    if (!completion) continue;
    await check();
    const response = await rpc("own_copilot_ancestry_v1", { p_account_id: authority.accountId,
      p_session_id: authority.sessionId, p_subject_id: authority.subjectId, p_authority: authority,
      p_projection: projection, p_file_id: source.id });
    if (response.error) throw new Error("copilot_unavailable");
    const receipt = ownChatAncestryReceiptSchema.parse(response.data), captured = receipt.content.source;
    if (receipt.fileId !== source.id || receipt.runId !== completion.runId || receipt.resultHash !== completion.resultHash
      || !sameInstant(receipt.completedAt, completion.completedAt) || captured.fileId !== source.id
      || captured.subjectId !== authority.subjectId || captured.sourceRevision !== source.revision
      || captured.sourceSha256 !== source.sha256 || !sameInstant(captured.normalizedAt, source.normalizedAt)) {
      throw new Error("copilot_unavailable");
    }
    await check();
    receipts.push(receipt);
    if (JSON.stringify(receipts).length > 2000000) throw new Error("copilot_unavailable");
  }
  await check();
  return receipts;
}
