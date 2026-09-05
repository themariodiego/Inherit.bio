import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { blockedResponse, invalidRequest, notFound, rpcErrorResponse, sensitiveJson } from "@/lib/embryos/api";
import { originDenied, readJson, unauthorized } from "@/lib/embryos/guards";
import { verifyEmbryoOperation } from "@/lib/embryos/operation-token";
import { dispositionBody, dispositionResponse, dispositionRpcArgs } from "@/lib/embryos/routes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/embryos/[id]/disposition` (register api.embryo-disposition;
 * contract §6.8). One disposition authority records what happened to one
 * embryo. Two evidenced parents propose and confirm in turn; a single
 * authority commits in one step; the RPC decides which of the two the
 * cohort's basis allows and refuses the other as a malformed action. The
 * timestamps, the retention deadline and any replacement Record Key Card
 * come from the database commit, never from the request; the response
 * body is one of the register's three closed shapes or nothing.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;

  const parsed = dispositionBody.safeParse(await readJson(request));
  if (!parsed.success) return invalidRequest(["body"]);
  const claims = verifyEmbryoOperation(parsed.data.nonce, {
    accountId: account.user.id,
    sessionId: account.sessionId,
    operation: "embryo_disposition",
    targetKind: "embryo",
    targetId: id,
  });
  if (!claims) return notFound();

  const { data, error } = await createAdminClient().rpc("record_embryo_disposition_v1", {
    p_account_id: account.user.id,
    p_session_id: account.sessionId,
    p_embryo_id: id,
    ...dispositionRpcArgs(parsed.data),
    p_token_nonce: claims.nonce,
  });
  if (error) {
    // A wrong action for the basis is a malformed request; a disposition
    // that is already final is a state the request cannot change.
    if (error.code === "22023") return invalidRequest(["action"]);
    if (error.code === "55000") return invalidRequest(["disposition_state"]);
    return rpcErrorResponse(error);
  }

  try {
    const response = dispositionResponse(data);
    return sensitiveJson(response.body, response.status);
  } catch {
    // The disposition is already committed; a result outside the three
    // registered shapes is a defect and never reaches the body.
    return blockedResponse("api.embryo-disposition");
  }
}
