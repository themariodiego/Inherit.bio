import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { createClient } from "@/lib/supabase/server";
import { readOwnerAccountObjection } from "@/lib/future-person/owner-account-objection";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { claimantNotFound as notFound, claimantResponse } from "@/lib/future-person/rights";
import { ownerObjectionBody, ownerObjectionMutation, ownerObjectionScope, sealOwnerObjection } from "@/lib/future-person/owner-objection";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRightsOrAccountCsrf, type CsrfSession } from "@/lib/security/session-csrf";

/** The current credential and exact server-owned notice decide
 * authority. An analytical grant, QC or the owner's jurisdiction never does.
 *
 * Two principals (policy.accountEquivalent): the emailed link's rights session,
 * and the same owner signed in from Settings. X-Inherit-CSRF is a one-time
 * session token of whichever the gate admitted, rights first (owner decision of
 * 19 November 2026, "G8.5: the claim-objection address accepts either kind of
 * session"), and only that principal's branch runs. Each branch's one-time
 * objection nonce stays in the body, checked as before; the two digests that
 * X-Inherit-CSRF carried (of the rights session, and of the account branch's
 * nonce) are gone. */
export const POST = withRightsOrAccountCsrf("api.future-person-claim-objection", objection);

async function objection(request: Request, session: CsrfSession | null): Promise<Response> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return notFound();
  const parsed = ownerObjectionBody.safeParse(await readBoundedJson(request, 20 * 1024));
  if (!parsed.success) return notFound();
  if (session?.kind === "authenticated") return accountObjection(request, parsed.data);
  if (session?.kind !== "token") return notFound();
  const authority = ownerObjectionMutation(request, parsed.data.nonce);
  if (!authority) return notFound();
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

async function accountObjection(request: Request, body: { statement: string; nonce: string }) {
  const account = await getSensitiveAccountContext(); if (!account) return notFound();
  const proof = readOwnerAccountObjection(request, body.nonce, { accountId: account.user.id, authSessionId: account.sessionId });
  if (!proof) return notFound();
  const caller = await createClient();
  const selected = await caller.rpc("future_person_owner_account_objection_scope_v1", { p_notice: proof.noticeId });
  const scope = ownerObjectionScope.safeParse(selected.data);
  if (selected.error || !scope.success || scope.data.noticeId !== proof.noticeId || scope.data.noticeRevision !== proof.noticeRevision) return notFound();
  let envelope: ReturnType<typeof sealOwnerObjection>;
  try { envelope = sealOwnerObjection(body.statement, scope.data); } catch { return notFound(); }
  const { data, error } = await caller.rpc("submit_future_person_account_objection_v1", {
    p_notice: scope.data.noticeId, p_revision: scope.data.noticeRevision, p_nonce: proof.nonce,
    p_statement_ciphertext: envelope.ciphertext, p_wrapped_statement_key: envelope.wrappedKey,
  });
  const receipt = z.object({ status: z.literal("suspended_for_review") }).strict().safeParse(data);
  if (error || !receipt.success) return notFound();
  return claimantResponse("api.future-person-claim-objection", ["status"], receipt.data, 202);
}
