import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { invalidRequest, notFound, unavailable } from "@/lib/embryos/api";
import { accountJurisdictionDenied, csrfOperation, requestForbidden, unauthorized } from "@/lib/embryos/guards";
import { completeAccepted, completeResult, incompleteUpload, readCompleteBody, sha256Hex } from "@/lib/embryos/ingest-complete";
import { dispatchIngestAttemptFailure } from "@/lib/embryos/ingest-failure";
import { authorizeIngestHttpRequest } from "@/lib/embryos/ingest-http";
import { verifyEmbryoOperation } from "@/lib/embryos/operation-token";
import { createAdminClient } from "@/lib/supabase/admin";

const withNoReferrer = (response: Response): Response => {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};

/**
 * `POST /api/embryo-ingest/[session]/complete` (register
 * `api.embryo-ingest-complete`). TEST-LOCAL only; `EMBRYO_INGEST_AVAILABLE`
 * stays false.
 *
 * Authority is the configure route's, plus the two tokens that route issued:
 * the upload-session-bound `X-Inherit-CSRF` header (`requiredHeader`) and the
 * one-time `completionNonce` in the body. Both must be sealed for this
 * account, auth session and upload session, and their digests must be the
 * ones the configure transaction stored (`embryo_ingest_issued_tokens_match_v1`),
 * so no other token, however it was minted, completes this attempt.
 *
 * The transaction is the worker stream's `public.complete_embryo_ingest_v1`
 * (register `completion`): it verifies the contiguous stored manifest and the
 * exact ordinal set, locks the manifest, enqueues exactly one
 * `split_cohort_vcf` job and marks `sanitization_pending`, and consumes the
 * nonce, in one transaction. Nothing is published here, and no upload notice
 * is queued (`uploadNotice`).
 *
 * A terminal branch dispatches the unwind. `chunk` answers
 * `missingOrNoncontiguous`; every other terminal branch reads as the opaque
 * 404, because the attempt no longer authorizes anything.
 */
export async function POST(request: Request, context: { params: Promise<{ session: string }> }) {
  const { session } = await context.params;
  const account = await getSensitiveAccountContext();
  if (!account) return withNoReferrer(unauthorized());
  const refused = await accountJurisdictionDenied(account.user.id);
  if (refused) return withNoReferrer(refused);
  const authorization = await authorizeIngestHttpRequest(
    request,
    session,
    { accountId: account.user.id, authSessionId: account.sessionId },
    async (args) => createAdminClient().rpc("authorize_embryo_ingest_request_v1", args),
  );
  if (authorization.kind === "denied") return withNoReferrer(authorization.response);
  if (authorization.kind === "failure_pending") {
    await dispatchIngestAttemptFailure(authorization.authority);
    return withNoReferrer(notFound());
  }
  const { authority, credentials } = authorization;
  const bound = {
    accountId: credentials.p_account_id,
    sessionId: credentials.p_auth_session_id,
    targetKind: "ingest_session" as const,
    targetId: authority.session,
  };

  const csrf = csrfOperation(request, { ...bound, operation: "ingest_complete_csrf" });
  if (!csrf) return withNoReferrer(requestForbidden());

  const parsed = await readCompleteBody(request);
  if (!parsed.ok) return withNoReferrer(invalidRequest(parsed.issues));
  const claims = verifyEmbryoOperation(parsed.body.nonce, { ...bound, operation: "ingest_complete" });
  if (!claims) return withNoReferrer(notFound());

  const admin = createAdminClient();
  const issued = await admin.rpc("embryo_ingest_issued_tokens_match_v1", {
    p_account_id: credentials.p_account_id,
    p_auth_session_id: credentials.p_auth_session_id,
    p_ingest_session_id: credentials.p_ingest_session_id,
    p_cookie_hash: credentials.p_cookie_hash,
    p_origin: credentials.p_origin,
    p_completion_nonce_hash: sha256Hex(claims.nonce),
    p_csrf_hash: sha256Hex(csrf.nonce),
    p_test_jurisdiction: credentials.p_test_jurisdiction,
  });
  if (issued.error) return withNoReferrer(unavailable());
  if (issued.data !== true) return withNoReferrer(notFound());

  const { data, error } = await admin.rpc("complete_embryo_ingest_v1", {
    p_account: credentials.p_account_id,
    p_auth: credentials.p_auth_session_id,
    p_session: credentials.p_ingest_session_id,
    p_cookie_hash: credentials.p_cookie_hash,
    p_origin: credentials.p_origin,
    p_cohort: authority.cohortId,
    p_ingest_revision: authority.ingestRevision,
    p_chunk_count: parsed.body.chunkCount,
    p_nonce: claims.nonce,
    p_test: credentials.p_test_jurisdiction,
  });
  if (error) {
    return withNoReferrer(["42501", "23505", "55000", "22023"].includes(error.code ?? "") ? notFound() : unavailable());
  }
  const result = completeResult.safeParse(data);
  if (!result.success) return withNoReferrer(unavailable());
  switch (result.data.status) {
    case "sanitization_pending":
    case "sanitization_in_progress":
      return completeAccepted(result.data);
    case "failure_pending":
      await dispatchIngestAttemptFailure(result.data);
      return withNoReferrer(result.data.failureCode === "chunk" ? incompleteUpload() : notFound());
    case "mapping_required":
      // Unreachable for a configured VCF, whose build is fixed at configure.
      // A table's `buildDecisionRequired` needs the mapping route's raw
      // challenge id, which is stored hash-only; answering it is that route's
      // work. Nothing was written, and the nonce is unspent.
      return withNoReferrer(unavailable());
  }
}
