import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, rpcErrorResponse, sensitiveJson } from "@/lib/embryos/api";
import { cohortCreatedBody, cohortFinalizeBody, ingestCookieParts } from "@/lib/embryos/cohort-create";
import { jurisdictionDenied, originDenied, readJson, unauthorized } from "@/lib/embryos/guards";
import { ingestRequestOrigin } from "@/lib/embryos/ingest-http";
import { ingestCookie } from "@/lib/embryos/ingest-session";
import { verifyEmbryoOperation } from "@/lib/embryos/operation-token";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/embryo-cohorts` (register `api.embryo-cohorts`). The entry point
 * of embryo ingest: one request finalizes a cohort draft and comes back with
 * the upload session the chunk route will need.
 *
 * The register's policy for this route runs to eight ordered prerequisites and
 * a transaction clause naming about twenty invariants, and **none of it is
 * decided here**. `finalize_embryo_cohort_ingest_v1` locks and consumes the
 * draft, resolves the basis-authority case, creates the cohort and its embryo
 * subjects with neutral ordinal labels, provisions the Record Key print
 * rights, and mints the ingest session and its retention row — all in one
 * transaction, or writes nothing. Fifteen fields are `serverAuthoritative`,
 * which is why the body carries four values and the route adds none.
 *
 * What the route owns is the two boundaries the database cannot reach:
 *
 *  - **Authority in.** The account and auth session come from
 *    `getSensitiveAccountContext()`, never from the request, and the one-time
 *    operation token must have been minted for this exact account, session,
 *    operation and draft. Anything else is the same 404 the register asks for,
 *    so a probe learns nothing about which draft exists.
 *  - **Credentials out.** The mint returns the upload session's secret and the
 *    mapping challenge. The secret leaves only inside a `HttpOnly;
 *    SameSite=Strict` cookie and the challenge does not leave at all;
 *    `cohortCreatedBody` builds the response without either, and
 *    `cohort-create.test.ts` fails if one ever appears in it.
 *
 * Production refuses this whole path today regardless: the private
 * transaction's first statement raises `42501` unless the deployment is under
 * TEST-LOCAL, and `embryo_analysis` is `unreviewed` in every jurisdiction
 * (G5.5). The route exists so the journey can be proved where it is permitted,
 * not to open one where it is not.
 */
export async function POST(request: Request) {
  const account = await getSensitiveAccountContext();
  if (!account) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  // The register puts an `embryo_analysis` guard at route scope. Without it
  // the refusal would be whatever `rpcErrorResponse` makes of the private
  // transaction's 42501, instead of the registered 403 and its copy.
  const unavailable = jurisdictionDenied();
  if (unavailable) return unavailable;

  // The origin the session is minted with must be derived the same way every
  // later ingest request derives it, because `authorize_embryo_ingest_request_v1`
  // matches them for equality. `ingestRequestOrigin` reads the `origin` header
  // and requires it to equal the request URL's origin and to match the pattern
  // the RPC itself enforces; `new URL(request.url).origin` does neither, and
  // behind a proxy the two can differ — which would mint a session that no
  // chunk request could ever authorize against.
  const origin = ingestRequestOrigin(request);
  if (!origin) return notFound();

  // The register answers unknown, missing, invalid, stale and ambiguous alike
  // with resource-not-found-v1: a finalize that failed for any of those
  // reasons must not tell the caller which.
  const parsed = cohortFinalizeBody.safeParse(await readJson(request));
  if (!parsed.success) return notFound();
  const claims = verifyEmbryoOperation(parsed.data.nonce, {
    accountId: account.user.id,
    sessionId: account.sessionId,
    operation: "cohort_finalize",
    targetKind: "cohort_draft",
    targetId: parsed.data.cohortDraftId,
  });
  if (!claims) return notFound();

  const { data, error } = await createAdminClient().rpc("finalize_embryo_cohort_ingest_v1", {
    p_account_id: account.user.id,
    p_auth_session_id: account.sessionId,
    p_draft_id: parsed.data.cohortDraftId,
    p_insurance_ack_id: parsed.data.insuranceAcknowledgementId,
    p_charter_ack_id: parsed.data.futurePersonCharterAcknowledgementId,
    p_token_nonce: claims.nonce,
    p_origin: origin,
    // `isTestJurisdictionEnabled` is the one reader of this flag, and it
    // compares against "1". An inlined `=== "true"` here would send `false`
    // under TEST-LOCAL and the transaction would refuse every call.
    p_test_jurisdiction: isTestJurisdictionEnabled(),
  });
  if (error) return rpcErrorResponse(error);

  // Built before the cookie, so a result this route cannot represent fails
  // before anything is set in the caller's browser.
  const body = cohortCreatedBody(data);
  const cookie = ingestCookieParts(data);
  return sensitiveJson(body, 201, {
    "set-cookie": ingestCookie(cookie.session, cookie.secret, cookie.expiresAt),
  });
}
