import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { invalidRequest, notFound, unavailable } from "@/lib/embryos/api";
import { accountJurisdictionDenied, unauthorized } from "@/lib/embryos/guards";
import {
  configuredResponse,
  configureResult,
  deriveHeaderBuild,
  newTransportChallenge,
  readConfigureBody,
  terminalResponse,
  withNoReferrer,
  zeroizeEvidence,
} from "@/lib/embryos/ingest-configure";
import { dispatchIngestAttemptFailure } from "@/lib/embryos/ingest-failure";
import { authorizeIngestHttpRequest } from "@/lib/embryos/ingest-http";
import { mintIngestSessionOperation, verifyEmbryoOperation } from "@/lib/embryos/operation-token";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/embryo-ingest/[session]/configure` (register
 * `api.embryo-ingest-configure`, ADR 0035). A VCF upload session is
 * configured once, from the source's `##fileformat`, `##reference` and
 * `##contig` lines and its sample count. The server works out the build; the
 * browser never declares one.
 *
 * The order is the register's:
 *
 *  1. Authority before anything is read. `authorizeIngestHttpRequest` needs
 *     the live account and auth session, exact Origin with same-origin fetch
 *     metadata, the `embryo_analysis` jurisdiction guard (TEST-LOCAL only),
 *     the session id and its host-only upload cookie, and then the database's
 *     own credential-bound authorizer. An unreadable target is the opaque 404
 *     `invalid-request-v1.authorizationPrecedence` puts before validation.
 *  2. The closed body, in memory. A forbidden line or field is
 *     `invalid-request-v1`, which is retryable and changes nothing.
 *  3. The one-time `operationNonce` from `upload-session-v1`, bound to this
 *     account, auth session and upload session. Anything else is a 404.
 *  4. The build, by the product parser's header rule only. The submitted
 *     lines are zeroized here and never reach the database, a log or a hash.
 *  5. One transaction, `configure_embryo_vcf_ingest_v1`: it re-locks the
 *     credential-bound session, decides the sample count against the cohort's
 *     immutable embryo count (after the build, per the contract's
 *     `selection`), and either records format and build through
 *     `private.configure_embryo_ingest_session_v1` and stores the new
 *     challenge, random revision, completion nonce and CSRF token as digests
 *     only, or marks the attempt failure-pending and names the terminal
 *     branch.
 *  6. A terminal branch, or an attempt already failure-pending, dispatches the
 *     identical `attemptFailure` unwind before answering.
 *
 * `EMBRYO_INGEST_AVAILABLE` stays false and production refuses at step 1 and
 * again inside every database function (`p_test_jurisdiction`).
 *
 * The request carries no `X-Inherit-CSRF` header: the only upload-session
 * CSRF token is the one this response issues. The body nonce, delivered only
 * in a same-origin JSON response and bound to the host-only cookie's session,
 * is this request's authority (see the owner question in the PR body).
 */
export async function POST(request: Request, context: { params: Promise<{ session: string }> }) {
  const { session } = await context.params;
  const account = await getSensitiveAccountContext();
  if (!account) return withNoReferrer(unauthorized());
  // The register's route-scope `embryo_analysis` guard, called in this file so
  // the surface shows its own check (scripts/jurisdiction-enforcement.test.ts).
  // `authorizeIngestHttpRequest` asks the same question again and gets the
  // same answer; outside TEST-LOCAL both refuse before any ingest authority.
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

  const parsed = await readConfigureBody(request);
  if (!parsed.ok) return withNoReferrer(invalidRequest(parsed.issues));
  const body = parsed.body;

  const claims = verifyEmbryoOperation(body.nonce, {
    accountId: credentials.p_account_id,
    sessionId: credentials.p_auth_session_id,
    operation: "ingest_session_open",
    targetKind: "ingest_session",
    targetId: authority.session,
  });
  // A session is configured once. A configured one, or a nonce that is not
  // this session's, reads exactly like an unknown session.
  if (!claims || authority.format !== null || authority.build !== null || authority.challengeHash !== null) {
    zeroizeEvidence(body);
    return withNoReferrer(notFound());
  }

  const build = deriveHeaderBuild(body);
  const expiresAt = new Date(authority.expiresAt);
  const operation = {
    accountId: credentials.p_account_id,
    sessionId: credentials.p_auth_session_id,
    targetId: authority.session,
  };
  let completion: { token: string; nonce: string };
  let csrf: { token: string; nonce: string };
  try {
    completion = mintIngestSessionOperation({ ...operation, operation: "ingest_complete" }, expiresAt);
    csrf = mintIngestSessionOperation({ ...operation, operation: "ingest_complete_csrf" }, expiresAt);
  } catch {
    // An expired session: the database will not authorize it either.
    return withNoReferrer(notFound());
  }
  const challenge = newTransportChallenge();

  const { data, error } = await createAdminClient().rpc("configure_embryo_vcf_ingest_v1", {
    p_account_id: credentials.p_account_id,
    p_auth_session_id: credentials.p_auth_session_id,
    p_ingest_session_id: credentials.p_ingest_session_id,
    p_cookie_hash: credentials.p_cookie_hash,
    p_origin: credentials.p_origin,
    p_cohort_id: authority.cohortId,
    p_ingest_revision: authority.ingestRevision,
    p_build: build,
    p_sample_count: body.sampleCount,
    p_nonce: claims.nonce,
    p_challenge: challenge,
    p_completion_nonce: completion.nonce,
    p_csrf_nonce: csrf.nonce,
    p_test_jurisdiction: credentials.p_test_jurisdiction,
  });
  if (error) {
    // A foreign or stale credential, a spent nonce or a session that is no
    // longer open: the same opaque 404. Contention and anything else is the
    // retryable 503; nothing was consumed.
    return withNoReferrer(["42501", "23505", "55000", "P0002"].includes(error.code ?? "") ? notFound() : unavailable());
  }
  const result = configureResult.safeParse(data);
  if (!result.success) return withNoReferrer(unavailable());

  switch (result.data.status) {
    case "configured":
      if (result.data.build !== build) return withNoReferrer(unavailable());
      return configuredResponse({
        build: result.data.build,
        challenge,
        revision: result.data.revision,
        completionNonce: completion.token,
        csrfToken: csrf.token,
      });
    case "terminal":
      await dispatchIngestAttemptFailure(result.data);
      // The database names the build branch only for the null build this
      // route sent; any other pairing is a contract breach, not an answer.
      if ((result.data.branch === "build_unknown") !== (build === null)) return withNoReferrer(unavailable());
      return terminalResponse(result.data.branch);
    case "failure_pending":
      await dispatchIngestAttemptFailure(result.data);
      return withNoReferrer(notFound());
  }
}
