import "server-only";

import type { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { readArtifactPresentation, readCohortGrantPresentation } from "@/lib/family/grant-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidRequest, notFound, rpcErrorResponse, sensitiveJson, unavailable } from "./api";
import { typedNameIsValid } from "./basis";
import {
  closedResponse,
  csrfOperation,
  encryptedLiteral,
  jurisdictionDenied,
  originDenied,
  requestForbidden,
  unauthorized,
} from "./guards";
import {
  grantCohortPurposeBody,
  isAnalysisGrantStatementSet,
  isEmbryoArtifactKey,
  isPublishedStatementSet,
  sameStatementKeys,
  signDraftArtifactBody,
  signingJurisdictionCode,
} from "./routes";

/**
 * The two embryo bodies of `POST /api/consents` (contract §6.2): a Tier-2
 * artifact signature against a cohort draft, and one parent's
 * `embryo.analysis` grant on a finalized cohort. Both follow the directional
 * grant's rule: the signer, the target, the artifact and its version are
 * recomputed from the sealed presentation token the page minted, never
 * copied from the body, and the body's declared fields must agree with the
 * token or the request is answered as an unknown resource with no write.
 * The artifact row is read again so a body that changed since the page was
 * rendered is refused rather than signed unseen.
 */

const ARTIFACT_SIGNATURE_KEYS = ["recordKind", "recordId", "artifactKey", "artifactVersion", "signedAt"] as const;
const PURPOSE_GRANT_KEYS = [...ARTIFACT_SIGNATURE_KEYS, "purposeKey"] as const;

function artifactChanged(): Response {
  return sensitiveJson({ error: "consent_artifact_changed" }, 409);
}

type Admin = ReturnType<typeof createAdminClient>;

/** The committed artifact at this version when it is still current; null otherwise. */
async function currentArtifact(admin: Admin, key: string, version: number) {
  const { data } = await admin
    .from("consent_artifacts")
    .select("artifact_key, version, body_sha256")
    .eq("artifact_key", key)
    .eq("version", version)
    .is("superseded_at", null)
    .maybeSingle();
  return data;
}

/** The account's own declared code, as the signature row records it. */
async function profileJurisdictionCode(admin: Admin, accountId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("jurisdiction_code").eq("id", accountId).maybeSingle();
  return signingJurisdictionCode(data?.jurisdiction_code);
}

/** Dispatches an embryo consents payload; the caller has already resolved the user. */
export async function embryoConsent(request: Request, payload: unknown): Promise<Response> {
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  const denied = jurisdictionDenied();
  if (denied) return denied;
  const context = await getSensitiveAccountContext();
  if (!context) return unauthorized();

  const signature = signDraftArtifactBody.safeParse(payload);
  if (signature.success) return signDraftArtifact(request, context.user.id, context.sessionId, signature.data);
  const grant = grantCohortPurposeBody.safeParse(payload);
  if (grant.success) return grantCohortPurpose(request, context.user.id, context.sessionId, grant.data);
  return invalidRequest(["body"]);
}

async function signDraftArtifact(
  request: Request,
  accountId: string,
  sessionId: string,
  body: z.infer<typeof signDraftArtifactBody>,
): Promise<Response> {
  const claims = csrfOperation(request, {
    accountId,
    sessionId,
    operation: "artifact_sign",
    targetKind: "cohort_draft",
    targetId: body.cohortDraftId,
  });
  if (!claims) return requestForbidden();

  // A stale, foreign or retargeted presentation reads as an unknown resource.
  const presentation = readArtifactPresentation(body.artifactPresentationToken);
  if (
    !presentation ||
    presentation.accountId !== accountId ||
    presentation.targetKind !== "cohort_draft" ||
    presentation.targetId !== body.cohortDraftId ||
    presentation.artifactVersion !== body.artifactVersion ||
    !isEmbryoArtifactKey(presentation.artifactKey) ||
    !sameStatementKeys(presentation.statementKeys, body.statementKeys)
  ) {
    return notFound();
  }
  if (!isPublishedStatementSet(presentation.artifactKey, body.statementKeys)) {
    return invalidRequest(["statementKeys"]);
  }
  if (!typedNameIsValid(body.typedName)) return invalidRequest(["typedName"]);

  const admin = createAdminClient();
  const [artifact, jurisdictionCode] = await Promise.all([
    currentArtifact(admin, presentation.artifactKey, presentation.artifactVersion),
    profileJurisdictionCode(admin, accountId),
  ]);
  if (!artifact || artifact.body_sha256 !== presentation.artifactBodySha256) return artifactChanged();

  const { data: signatureId, error } = await admin.rpc("sign_embryo_artifact_v1", {
    p_account_id: accountId,
    p_session_id: sessionId,
    p_target_kind: "cohort_draft",
    p_target_id: body.cohortDraftId,
    p_artifact_key: artifact.artifact_key,
    p_artifact_version: artifact.version,
    p_statement_keys: [...body.statementKeys],
    p_signing_name_ciphertext: encryptedLiteral(body.typedName),
    p_jurisdiction_code: jurisdictionCode,
    p_token_nonce: claims.nonce,
  });
  if (error) return rpcErrorResponse(error);
  if (!signatureId) return unavailable();

  return closedResponse(
    "api.consents",
    ARTIFACT_SIGNATURE_KEYS,
    {
      recordKind: "artifact_signature",
      recordId: signatureId,
      artifactKey: artifact.artifact_key,
      artifactVersion: artifact.version,
      signedAt: new Date().toISOString(),
    },
    201,
  );
}

async function grantCohortPurpose(
  request: Request,
  accountId: string,
  sessionId: string,
  body: z.infer<typeof grantCohortPurposeBody>,
): Promise<Response> {
  const claims = csrfOperation(request, {
    accountId,
    sessionId,
    operation: "cohort_purpose_grant",
    targetKind: "cohort",
    targetId: body.cohortId,
  });
  if (!claims) return requestForbidden();

  const presentation = readCohortGrantPresentation(body.artifactPresentationToken);
  if (
    !presentation ||
    presentation.accountId !== accountId ||
    presentation.cohortId !== body.cohortId ||
    presentation.purpose !== body.purposeKey ||
    presentation.artifactVersion !== body.artifactVersion ||
    presentation.artifactKey !== "consent.upload-embryo"
  ) {
    return notFound();
  }
  if (!isAnalysisGrantStatementSet(body.statementKeys)) return invalidRequest(["statementKeys"]);
  if (!typedNameIsValid(body.typedName)) return invalidRequest(["typedName"]);

  const admin = createAdminClient();
  const [artifact, jurisdictionCode, { data: cohort }] = await Promise.all([
    currentArtifact(admin, presentation.artifactKey, presentation.artifactVersion),
    profileJurisdictionCode(admin, accountId),
    admin.from("embryo_cohorts").select("participant_set_revision").eq("id", body.cohortId).maybeSingle(),
  ]);
  // The parents the page showed must still be the cohort's parents.
  if (!cohort || cohort.participant_set_revision !== presentation.participantSetRevision) return notFound();
  if (!artifact || artifact.body_sha256 !== presentation.artifactBodySha256) return artifactChanged();

  const { data: grantId, error } = await admin.rpc("grant_cohort_purpose_v1", {
    p_account_id: accountId,
    p_session_id: sessionId,
    p_cohort_id: body.cohortId,
    p_artifact_key: artifact.artifact_key,
    p_artifact_version: artifact.version,
    p_statement_keys: [...body.statementKeys],
    p_signing_name_ciphertext: encryptedLiteral(body.typedName),
    p_jurisdiction_code: jurisdictionCode,
    p_token_nonce: claims.nonce,
  });
  if (error) return rpcErrorResponse(error);
  if (!grantId) return unavailable();

  return closedResponse(
    "api.consents",
    PURPOSE_GRANT_KEYS,
    {
      recordKind: "purpose_grant",
      recordId: grantId,
      artifactKey: artifact.artifact_key,
      artifactVersion: artifact.version,
      purposeKey: presentation.purpose,
      signedAt: new Date().toISOString(),
    },
    201,
  );
}
