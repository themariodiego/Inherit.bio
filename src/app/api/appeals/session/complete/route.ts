import { z } from "zod";
import { closedResponse } from "@/lib/embryos/guards";
import { notFound, unavailable } from "@/lib/embryos/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { readPublicAppealMutation } from "@/lib/future-person/public-appeal-session";
import { createAppealIntakeRuntime } from "@/lib/future-person/appeal-intake-runtime";
const common = { photoIdentityDocumentId: z.uuid(), affirmed: z.literal(true), nonce: z.string().min(1).max(2048) };
export const publicAppealCompletionBody = z.union([
 z.object({ ...common, subjectSourceControlDocumentId: z.uuid() }).strict(),
 z.object({ ...common, geneticParentAuthorityDocumentId: z.uuid() }).strict(),
]);
const receipt = z.object({ status: z.literal("review_pending"), deadline: z.iso.datetime({ offset: true }) }).strict();
/** Native case kind chooses the exact two documents. A handle does not grant
 * access, prove parentage, select a target or approve any evidence. */
export async function POST(request: Request) {
 const owner = createAppealIntakeRuntime(request.signal); let result: z.infer<typeof receipt> | null = null; let refused = false;
 try {
  const parsed = publicAppealCompletionBody.safeParse(await owner.wait(owner.read(() => readBoundedJson(request, 4096))));
  if (!parsed.success) return notFound();
  const proof = readPublicAppealMutation(request, "complete", parsed.data.nonce); if (!proof) return notFound();
  const documents = "subjectSourceControlDocumentId" in parsed.data
   ? { photoIdentityDocumentId: parsed.data.photoIdentityDocumentId, subjectSourceControlDocumentId: parsed.data.subjectSourceControlDocumentId }
   : { photoIdentityDocumentId: parsed.data.photoIdentityDocumentId, geneticParentAuthorityDocumentId: parsed.data.geneticParentAuthorityDocumentId };
  const { data, error } = await owner.wait(owner.rpc("public-commit", () => createAdminClient()
   .rpc("complete_new_public_appeal_evidence_v1", { p_session_hash: proof.sessionHash, p_nonce: proof.nonce, p_documents: documents, p_affirmed: true })
   .retry(false).abortSignal(owner.signal)));
  if (error) refused = ["42501", "23505", "22023"].includes(error.code ?? "");
  else { const parsedReceipt = receipt.safeParse(data); if (parsedReceipt.success) result = parsedReceipt.data; }
 } catch { /* Opaque; a lost response never becomes an adopted completion. */ }
 finally { await owner.finish(); }
 const settled = owner.disposition();
 if (settled.cleanupHeld || settled.pendingActualTasks !== 0 || settled.ownedMutableBuffers !== 0) return unavailable();
 if (!result) return refused ? notFound() : unavailable();
 const response = await closedResponse("api.appeal-complete", ["status", "deadline"], result, 202);
 response.headers.set("Referrer-Policy", "no-referrer");return response;
}
