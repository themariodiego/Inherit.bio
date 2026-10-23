import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { ACCOUNT_OPERATION_NONCE_MAX_LENGTH, verifyAccountOperationNonce } from "@/lib/account-operation-nonce";
import { invalidRequest, notFound, unavailable } from "@/lib/embryos/api";
import { closedResponse, originDenied, readJson, unauthorized } from "@/lib/embryos/guards";
import { isJsonRequest } from "@/lib/subject-endpoints/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * `POST /api/consents/revoke-all` (register api.consents-revoke-all). Turns
 * off every current purpose grant whose immutable signature principal is the
 * acting account, and every cloud-model provider grant it holds. Revoking is
 * a right: no jurisdiction gate applies (policy.jurisdictionBypass).
 *
 * The body is closed: the resolved confirmation copy id and the one-time
 * account operation nonce the page rendered. Nothing in it names a grant,
 * a subject, a cohort or a purpose; `revoke_all_own_consents_v1` selects
 * every row and its disposition in the database, through the same per-grant
 * revocation functions api.consent-revoke runs, records the nonce's hash in
 * the same transaction, and writes one audit batch. A replayed nonce writes
 * nothing. A grant the database cannot dispatch fails the whole request with
 * nothing written, answered resource-not-found-v1.
 */

const CONFIRMATION = "consents.revoke-all.confirmation";

const body = z.object({
  confirmation: z.literal(CONFIRMATION),
  nonce: z.string().min(1).max(ACCOUNT_OPERATION_NONCE_MAX_LENGTH),
}).strict();

const ACCEPTED_KEYS = ["status"] as const;

export const POST = withAccountCsrf("api.consents-revoke-all", handlePost);
async function handlePost(request: Request) {
  const account = await getSensitiveAccountContext();
  if (!account) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;

  if (!isJsonRequest(request)) return invalidRequest(["content-type"]);
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) {
    const issues = [...new Set(parsed.error.issues.map(issue =>
      issue.path[0] === "confirmation" || issue.path[0] === "nonce" ? String(issue.path[0]) : "body"))];
    return invalidRequest(issues.length > 0 ? issues : ["body"]);
  }
  const nonce = verifyAccountOperationNonce(parsed.data.nonce, {
    accountId: account.user.id, sessionId: account.sessionId, operation: "consents_revoke_all",
  });
  if (!nonce) return invalidRequest(["nonce"]);

  const { data, error } = await createAdminClient().rpc("revoke_all_own_consents_v1", {
    p_account_id: account.user.id,
    p_session_id: account.sessionId,
    p_nonce_hash: nonce.nonceHash,
    p_nonce_expires_at: new Date(nonce.expiresAt).toISOString(),
  });
  if (error) {
    switch (error.code) {
      case "42501":
        return notFound();
      case "22023":
        return invalidRequest(["nonce"]);
      default:
        return unavailable();
    }
  }
  if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) return unavailable();
  return closedResponse("api.consents-revoke-all", ACCEPTED_KEYS, { status: "accepted" }, 202);
}
