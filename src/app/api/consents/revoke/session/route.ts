import { z } from "zod";
import { notFound } from "@/lib/embryos/api";
import { closedResponse, readJson } from "@/lib/embryos/guards";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAdultSubjectControlRequest } from "@/lib/uploads/adult-subject-control";
import { withPurposeCsrf, readRightsCsrfSession } from "@/lib/security/session-csrf";

/**
 * `POST /api/consents/revoke/session` (register api.consent-revoke-rights).
 * A person who confirmed a Path B request with no account turns off one
 * purpose they granted the uploader, through their adult-subject-control
 * rights session. The body names only the purpose and the session-bound
 * one-time nonce. The signer, data subject, recipient, relationship and
 * every revision are re-derived in `revoke_purpose_rights_v1` from the
 * session, which ends only the exact current grant pair and dispatches
 * purpose-revocation-v1. Revoking is a right: no jurisdiction gate applies.
 *
 * Every failure (no or a foreign session, a stale or used nonce, an unknown
 * or already revoked pair, a field the closed body does not list) is the same
 * resource-not-found-v1. Path B is TEST-LOCAL, so outside the test
 * jurisdiction this route is that 404 too. No issuer of the session purpose
 * exists yet, so the database refuses every request until one is built.
 */

const body = z.object({
  purposeKey: z.enum(["reports.monogenic", "reports.polygenic", "ancestry", "copilot.local"]),
  nonce: z.string().min(16).max(8192),
}).strict();

const ACCEPTED_KEYS = ["status"] as const;

export const POST = withPurposeCsrf("api.consent-revoke-rights", readRightsCsrfSession, handlePost);
async function handlePost(request: Request) {
  if (!isTestJurisdictionEnabled()) return notFound();
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return notFound();
  const authority = readAdultSubjectControlRequest(request, parsed.data.nonce);
  if (!authority) return notFound();

  const { data, error } = await createAdminClient().rpc("revoke_purpose_rights_v1", {
    p_session_hash: authority.sessionHash,
    p_nonce: authority.nonce,
    p_purpose: parsed.data.purposeKey,
    p_test_jurisdiction: true,
  });
  if (error || data !== "accepted") return notFound();
  return closedResponse("api.consent-revoke-rights", ACCEPTED_KEYS, { status: "accepted" }, 202);
}
