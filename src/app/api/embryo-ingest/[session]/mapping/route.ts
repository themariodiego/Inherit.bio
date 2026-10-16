import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { invalidRequest, notFound, unavailable } from "@/lib/embryos/api";
import { accountJurisdictionDenied, unauthorized } from "@/lib/embryos/guards";
import { newTransportChallenge, withNoReferrer } from "@/lib/embryos/ingest-configure";
import { dispatchIngestAttemptFailure } from "@/lib/embryos/ingest-failure";
import { authorizeIngestHttpRequest, type IngestAuthorization, type IngestAuthorizationArgs } from "@/lib/embryos/ingest-http";
import {
  buildChallengeResponse,
  buildUnknownResponse,
  columnChallengeResponse,
  columnResolution,
  decideResult,
  inspectHeader,
  inspectResult,
  readDecisionBody,
  readInspectBody,
  transportResponse,
  zeroizeHeader,
} from "@/lib/embryos/ingest-mapping";
import { mintIngestSessionOperation, verifyEmbryoOperation, type IngestSessionOperation } from "@/lib/embryos/operation-token";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST`/`PUT /api/embryo-ingest/[session]/mapping` (register
 * `api.embryo-ingest-mapping`, ADR 0037). TEST-LOCAL only;
 * `EMBRYO_INGEST_AVAILABLE` stays false, and production refuses at the
 * jurisdiction guard and again inside every database function.
 *
 * Authority comes first, exactly as on the configure route: the live account
 * and auth session, exact Origin with same-origin fetch metadata, the
 * `embryo_analysis` guard, the host-only upload cookie and the database's
 * credential-bound authorizer. A request carries no `X-Inherit-CSRF` header:
 * the session CSRF rule is unchanged, and only completion requires it. Each
 * request's authority is its one-time nonce, issued in the response before
 * it and bound in the database to the session (`POST`) or to the exact
 * challenge (`PUT`).
 *
 * `POST` inspects the bounded header copy in memory. A forbidden sex,
 * gender, karyotype or proxy column, a file that is not a table, or a plan
 * beyond four decisions is terminal: the attempt is marked failure-pending
 * and the unwind dispatched before anything derived from the header is
 * written. Otherwise the route records the canonical locus kind and answers
 * `pgt-mapping-challenge-v1`: a column challenge, the build question when the
 * header stated no build (owner decision of 16 October 2026: GRCh37, GRCh38
 * or unknown, before any chunk), or the transport when nothing is left.
 *
 * `PUT` answers the current challenge. The stored challenge kind selects the
 * accepted shape; a different, unknown or malformed body is the retryable
 * opaque 404. `unknown` is terminal (`buildUnknown`). Every nonterminal
 * answer is 200 and carries the next challenge with its nonce, or the
 * transport (owner decision "Token rotation in the embryo mapping
 * responses"), never an empty 204.
 */
type Authorized = Extract<IngestAuthorization, { status: "authorized" }>;
type RouteContext = { params: Promise<{ session: string }> };

async function authorize(request: Request, session: string): Promise<
  { kind: "answer"; response: Response } | { kind: "authorized"; authority: Authorized; credentials: IngestAuthorizationArgs }
> {
  const account = await getSensitiveAccountContext();
  if (!account) return { kind: "answer", response: withNoReferrer(unauthorized()) };
  // The register's route-scope `embryo_analysis` guard, in this file so the
  // surface shows its own check (scripts/jurisdiction-enforcement.test.ts).
  const refused = await accountJurisdictionDenied(account.user.id);
  if (refused) return { kind: "answer", response: withNoReferrer(refused) };
  const authorization = await authorizeIngestHttpRequest(
    request,
    session,
    { accountId: account.user.id, authSessionId: account.sessionId },
    async (args) => createAdminClient().rpc("authorize_embryo_ingest_request_v1", args),
  );
  if (authorization.kind === "denied") return { kind: "answer", response: withNoReferrer(authorization.response) };
  if (authorization.kind === "failure_pending") {
    await dispatchIngestAttemptFailure(authorization.authority);
    return { kind: "answer", response: withNoReferrer(notFound()) };
  }
  return { kind: "authorized", authority: authorization.authority, credentials: authorization.credentials };
}

/** A table session whose transport is not yet issued: the only state either method acts on. */
function inMapping(authority: Authorized): boolean {
  return authority.format === "pgt_table" && authority.challengeHash === null;
}

function mint(authority: Authorized, credentials: IngestAuthorizationArgs, operation: IngestSessionOperation) {
  return mintIngestSessionOperation({
    accountId: credentials.p_account_id, sessionId: credentials.p_auth_session_id,
    targetId: authority.session, operation,
  }, new Date(authority.expiresAt));
}

/** The transport the response that ends the mapping carries. */
function mintTransport(authority: Authorized, credentials: IngestAuthorizationArgs) {
  return {
    challenge: newTransportChallenge(),
    completion: mint(authority, credentials, "ingest_complete"),
    csrf: mint(authority, credentials, "ingest_complete_csrf"),
  };
}

const REFUSED = ["42501", "23505", "55000", "P0002"];

export async function POST(request: Request, context: RouteContext) {
  const { session } = await context.params;
  const authorized = await authorize(request, session);
  if (authorized.kind === "answer") return authorized.response;
  const { authority, credentials } = authorized;

  const parsed = await readInspectBody(request);
  if (!parsed.ok) return withNoReferrer(invalidRequest(parsed.issues));
  const body = parsed.body;
  const claims = verifyEmbryoOperation(body.nonce, {
    accountId: credentials.p_account_id, sessionId: credentials.p_auth_session_id,
    operation: "ingest_mapping_inspect", targetKind: "ingest_session", targetId: authority.session,
  });
  if (!claims || !inMapping(authority)) {
    zeroizeHeader(body);
    return withNoReferrer(notFound());
  }

  // The header copy is read once, in memory, and zeroized inside.
  const inspection = inspectHeader(body);
  const outcome = inspection.kind === "terminal" ? inspection.branch
    : inspection.kind === "columns" ? "columns" : authority.build === null ? "build" : "transport";
  let challengeId: string | null = null;
  let next: { token: string; nonce: string } | null = null;
  let issued: ReturnType<typeof mintTransport> | null = null;
  try {
    if (outcome === "columns" || outcome === "build") {
      challengeId = newTransportChallenge();
      next = mint(authority, credentials, "ingest_mapping_decide");
    } else if (outcome === "transport") {
      issued = mintTransport(authority, credentials);
    }
  } catch {
    return withNoReferrer(notFound());
  }

  const { data, error } = await createAdminClient().rpc("inspect_embryo_table_mapping_v1", {
    p_account_id: credentials.p_account_id,
    p_auth_session_id: credentials.p_auth_session_id,
    p_ingest_session_id: credentials.p_ingest_session_id,
    p_cookie_hash: credentials.p_cookie_hash,
    p_origin: credentials.p_origin,
    p_cohort_id: authority.cohortId,
    p_ingest_revision: authority.ingestRevision,
    p_outcome: outcome,
    p_column_count: inspection.kind === "columns" ? inspection.columnCount : null,
    p_locus: inspection.kind === "terminal" ? null : inspection.locus,
    p_nonce: claims.nonce,
    p_challenge: challengeId ?? issued?.challenge ?? null,
    p_next_nonce: next?.nonce ?? null,
    p_completion_nonce: issued?.completion.nonce ?? null,
    p_csrf_nonce: issued?.csrf.nonce ?? null,
    p_test_jurisdiction: credentials.p_test_jurisdiction,
  });
  if (error) return withNoReferrer(REFUSED.includes(error.code ?? "") ? notFound() : unavailable());
  const result = inspectResult.safeParse(data);
  if (!result.success) return withNoReferrer(unavailable());

  switch (result.data.status) {
    case "terminal":
      await dispatchIngestAttemptFailure(result.data);
      if (result.data.branch !== outcome) return withNoReferrer(unavailable());
      return withNoReferrer(notFound());
    case "failure_pending":
      await dispatchIngestAttemptFailure(result.data);
      return withNoReferrer(notFound());
    case "challenge":
      if (result.data.kind !== outcome || !challengeId || !next) return withNoReferrer(unavailable());
      if (inspection.kind === "columns") {
        return columnChallengeResponse({ challengeId, decisions: inspection.decisions,
          expiresAt: result.data.expiresAt, nonce: next.token });
      }
      return buildChallengeResponse({ challengeId, expiresAt: result.data.expiresAt, nonce: next.token });
    case "transport":
      if (outcome !== "transport" || !issued || result.data.build !== authority.build) return withNoReferrer(unavailable());
      return transportResponse({ build: result.data.build, challenge: issued.challenge, revision: result.data.revision,
        completionNonce: issued.completion.token, csrfToken: issued.csrf.token });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { session } = await context.params;
  const authorized = await authorize(request, session);
  if (authorized.kind === "answer") return authorized.response;
  const { authority, credentials } = authorized;

  const decision = await readDecisionBody(request);
  if (!decision) return withNoReferrer(notFound());
  const claims = verifyEmbryoOperation(decision.nonce, {
    accountId: credentials.p_account_id, sessionId: credentials.p_auth_session_id,
    operation: "ingest_mapping_decide", targetKind: "ingest_session", targetId: authority.session,
  });
  if (!claims || !inMapping(authority)) return withNoReferrer(notFound());

  // What follows a column decision depends on the recorded build; a build
  // decision is always followed by the transport. The database checks both.
  const nextIsBuild = decision.kind === "columns" && authority.build === null;
  let buildChallenge: string | null = null;
  let next: { token: string; nonce: string } | null = null;
  let issued: ReturnType<typeof mintTransport> | null = null;
  try {
    if (nextIsBuild) {
      buildChallenge = newTransportChallenge();
      next = mint(authority, credentials, "ingest_mapping_decide");
    } else {
      issued = mintTransport(authority, credentials);
    }
  } catch {
    return withNoReferrer(notFound());
  }

  const { data, error } = await createAdminClient().rpc("decide_embryo_table_mapping_v1", {
    p_account_id: credentials.p_account_id,
    p_auth_session_id: credentials.p_auth_session_id,
    p_ingest_session_id: credentials.p_ingest_session_id,
    p_cookie_hash: credentials.p_cookie_hash,
    p_origin: credentials.p_origin,
    p_cohort_id: authority.cohortId,
    p_ingest_revision: authority.ingestRevision,
    p_challenge: decision.challengeId,
    p_resolution: decision.kind === "columns" ? columnResolution(decision.mappings) : { referenceBuild: decision.referenceBuild },
    p_nonce: claims.nonce,
    p_build_challenge: buildChallenge,
    p_build_nonce: next?.nonce ?? null,
    p_transport_challenge: issued?.challenge ?? null,
    p_completion_nonce: issued?.completion.nonce ?? null,
    p_csrf_nonce: issued?.csrf.nonce ?? null,
    p_test_jurisdiction: credentials.p_test_jurisdiction,
  });
  if (error) {
    // An unknown, stale-nonce, cross-kind or malformed decision changed
    // nothing and reads as the opaque 404; contention is the retryable 503.
    return withNoReferrer([...REFUSED, "22023"].includes(error.code ?? "") ? notFound() : unavailable());
  }
  const result = decideResult.safeParse(data);
  if (!result.success) return withNoReferrer(unavailable());

  switch (result.data.status) {
    case "terminal":
      await dispatchIngestAttemptFailure(result.data);
      if (decision.kind !== "build" || decision.referenceBuild !== "unknown") return withNoReferrer(unavailable());
      return withNoReferrer(buildUnknownResponse());
    case "failure_pending":
      await dispatchIngestAttemptFailure(result.data);
      return withNoReferrer(notFound());
    case "challenge":
      if (result.data.kind !== "build" || !nextIsBuild || !buildChallenge || !next) return withNoReferrer(unavailable());
      return buildChallengeResponse({ challengeId: buildChallenge, expiresAt: result.data.expiresAt, nonce: next.token });
    case "transport": {
      const expected = decision.kind === "build" ? decision.referenceBuild : authority.build;
      if (!issued || result.data.build !== expected) return withNoReferrer(unavailable());
      return transportResponse({ build: result.data.build, challenge: issued.challenge, revision: result.data.revision,
        completionNonce: issued.completion.token, csrfToken: issued.csrf.token });
    }
  }
}
