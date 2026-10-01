import { z } from "zod";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { claimantNotFound as notFound, claimantResponse } from "@/lib/future-person/rights";
import { ownerObjectionBody, ownerObjectionMutation, ownerObjectionScope, sealOwnerObjection } from "@/lib/future-person/owner-objection";
import { createAdminClient } from "@/lib/supabase/admin";

/** Rights-only: the current credential and exact server-owned notice decide
 * authority. An analytical grant, QC or the owner's jurisdiction never does. */
export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return notFound();
  const parsed = ownerObjectionBody.safeParse(await readBoundedJson(request, 20 * 1024));
  if (!parsed.success) return notFound();
  const authority = ownerObjectionMutation(request, parsed.data.nonce); if (!authority) return notFound();
  const admin = createAdminClient();
  const selected = await admin.rpc("future_person_objection_statement_scope_v1", { p_session_hash: authority.sessionHash });
  const scope = ownerObjectionScope.safeParse(selected.data); if (selected.error || !scope.success) return notFound();
  let envelope: ReturnType<typeof sealOwnerObjection>;
  try { envelope = sealOwnerObjection(parsed.data.statement, scope.data); } catch { return notFound(); }
  const { data, error } = await admin.rpc("submit_future_person_owner_objection_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce,
    p_notice_id: scope.data.noticeId, p_notice_revision: scope.data.noticeRevision,
    p_statement_ciphertext: envelope.ciphertext, p_wrapped_statement_key: envelope.wrappedKey,
  });
  const receipt = z.object({ status: z.literal("suspended_for_review") }).strict().safeParse(data);
  if (error || !receipt.success) return notFound();
  return claimantResponse("api.future-person-claim-objection", ["status"], receipt.data, 202);
}
