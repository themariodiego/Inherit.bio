import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { bodyIsEmpty, invalidRequest, notFound, rpcErrorResponse } from "@/lib/embryos/api";
import { closedResponse, originDenied, unauthorized } from "@/lib/embryos/guards";
import { OPERATION_HEADER, verifyEmbryoOperation } from "@/lib/embryos/operation-token";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/cohorts/[id]/restrict` (register api.cohort-restrict; contract
 * §6.7), also served as `/api/embryo-cohorts/[id]/withdraw`. One disposition
 * authority makes the cohort's parent-controlled material unreadable: the
 * RPC restricts every embryo subject, deletes the derived rows, revokes
 * every Record Key and print right and every grant, and notifies every
 * notice recipient. The request carries no body; the one-time operation
 * nonce travels in `x-inherit-operation-nonce`. A cohort that is already
 * restricted, foreign or unknown is the same 404.
 */

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  if (!bodyIsEmpty(request)) return invalidRequest(["body"]);

  const claims = verifyEmbryoOperation(request.headers.get(OPERATION_HEADER), {
    accountId: account.user.id,
    sessionId: account.sessionId,
    operation: "cohort_restrict",
    targetKind: "cohort",
    targetId: id,
  });
  if (!claims) return notFound();

  const { error } = await createAdminClient().rpc("restrict_embryo_cohort_v1", {
    p_account_id: account.user.id,
    p_session_id: account.sessionId,
    p_cohort_id: id,
    p_token_nonce: claims.nonce,
  });
  // An already restricted cohort is a revoked resource (revoked-resource-v1):
  // the same 404 as one the caller may not see.
  if (error?.code === "55000") return notFound();
  if (error) return rpcErrorResponse(error);

  return closedResponse("api.cohort-restrict", ["status"], { status: "accepted" }, 202);
}
