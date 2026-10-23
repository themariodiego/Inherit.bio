import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound } from "@/lib/embryos/api";
import { closedResponse, readJson, unauthorized } from "@/lib/embryos/guards";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAdultSubjectControlRequest } from "@/lib/uploads/adult-subject-control";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * `POST /api/subjects/bind/session` (register api.adult-subject-bind;
 * adult-subject-account-binding-v1). A person who confirmed a Path B request
 * with no account binds that record to the account they are signed in to, in
 * the same browser as their adult-subject-control rights session. Ownership
 * does not change and no object moves; the person may then use
 * api.subject-transfer separately.
 *
 * BUILT CLOSED (owner decision 2026-10-22). It needs an adult-subject-control
 * session, whose issuer is not built, and the contract's account-binding
 * notice, whose wording is not approved. So `bind_adult_subject_account_v1`
 * refuses every request, and this route answers resource-not-found-v1 for
 * every failure and outside TEST-LOCAL. It sends no notice. The bind is
 * refused while any file is pending, and the non-account principal's grants
 * end rather than wait in a new status.
 *
 * The closed body is the one-time rights-session nonce and nothing else: the
 * subject, principal, account and jurisdiction all come from the session and
 * the signed-in account. Recent re-authentication (15 minutes) and MFA when
 * enrolled are checked in the same database transaction.
 */

const body = z.object({ nonce: z.string().min(16).max(8192) }).strict();
const BOUND = z.object({
  status: z.literal("account_bound"), subjectId: z.uuid(),
  next: z.literal("review_purposes_and_optionally_transfer_ownership"),
}).strict();
const BOUND_KEYS = ["status", "subjectId", "next"] as const;

export const POST = withAccountCsrf("api.adult-subject-bind", handlePost);
async function handlePost(request: Request) {
  if (!isTestJurisdictionEnabled()) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return unauthorized();
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return notFound();
  const authority = readAdultSubjectControlRequest(request, parsed.data.nonce);
  if (!authority) return notFound();

  const { data, error } = await createAdminClient().rpc("bind_adult_subject_account_v1", {
    p_session_hash: authority.sessionHash,
    p_nonce: authority.nonce,
    p_account_id: account.user.id,
    p_auth_session_id: account.sessionId,
    p_test_jurisdiction: true,
  });
  const bound = BOUND.safeParse(data);
  if (error || !bound.success) return notFound();
  return closedResponse("api.adult-subject-bind", BOUND_KEYS, bound.data, 200);
}
