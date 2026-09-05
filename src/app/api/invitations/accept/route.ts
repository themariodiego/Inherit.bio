import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { hmacSecret } from "@/lib/crypto";
import { notFound } from "@/lib/embryos/api";
import { EMBRYO_ARTIFACT_STATEMENT_KEYS, typedNameIsValid } from "@/lib/embryos/basis";
import {
  closedResponse,
  encryptedLiteral,
  jurisdictionDenied,
  originDenied,
  readJson,
  unauthorized,
} from "@/lib/embryos/guards";
import { verifyEmbryoOperation } from "@/lib/embryos/operation-token";
import { readRightsSessionHash } from "@/lib/embryos/rights-session";
import {
  acceptedJurisdictionCode,
  coParentAcceptBody,
  normalizeContact,
  sameStatementKeys,
  type CoParentAcceptRequest,
} from "@/lib/embryos/routes";
import { readArtifactPresentation, type ArtifactPresentation } from "@/lib/family/grant-token";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/invitations/accept` (register api.invitation-accept; contract
 * §6.5), the co-parent body. The invited parent, now signed in, presents
 * the rights cookie the activation route set, one operation token bound to
 * that session, and the two artifacts the page showed them. The route
 * checks that every token was minted for this account and for the one
 * draft the rights session names, that the artifacts are still the ones
 * shown, and that the account controls the invited address; the RPC checks
 * all of it again and binds the account to its parent slot. Every failure
 * is the same 404 with no write.
 */

const ACCEPTED_KEYS = ["invitationKind", "status", "cohortDraftId", "participantState"] as const;

const UPLOAD_KEYS = EMBRYO_ARTIFACT_STATEMENT_KEYS["consent.upload-embryo"];
const PARENTAGE_KEYS = EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-parentage"];

type CoParentArtifacts = CoParentAcceptRequest["coParentArtifacts"];
/** Either of the two accepted artifacts; they differ only in the key each declares. */
type AcceptedArtifact = CoParentArtifacts["uploadEmbryo"] | CoParentArtifacts["parentageAttestation"];

/**
 * The presentation of one accepted artifact when it was minted for this
 * account, this artifact at this version and a cohort draft, and shows
 * exactly the published statement keys the body affirms; null otherwise.
 */
function presentationOf(
  accountId: string,
  artifact: AcceptedArtifact,
  published: readonly string[],
): ArtifactPresentation | null {
  const presentation = readArtifactPresentation(artifact.artifactPresentationToken);
  if (
    !presentation ||
    presentation.accountId !== accountId ||
    presentation.targetKind !== "cohort_draft" ||
    presentation.artifactKey !== artifact.artifactKey ||
    presentation.artifactVersion !== artifact.artifactVersion ||
    !sameStatementKeys(presentation.statementKeys, artifact.statementKeys) ||
    !sameStatementKeys(artifact.statementKeys, published) ||
    !typedNameIsValid(artifact.typedName)
  ) {
    return null;
  }
  return presentation;
}

export async function POST(request: Request) {
  const context = await getSensitiveAccountContext();
  if (!context) return unauthorized();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  const denied = jurisdictionDenied();
  if (denied) return denied;

  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash || !context.user.email) return notFound();
  const parsed = coParentAcceptBody.safeParse(await readJson(request));
  if (!parsed.success) return notFound();
  const body = parsed.data;
  // Only a country the jurisdiction register knows is ever persisted.
  const jurisdictionCode = acceptedJurisdictionCode(body.jurisdictionCode);
  if (!jurisdictionCode) return notFound();

  const claims = verifyEmbryoOperation(body.nonce, {
    accountId: context.user.id,
    sessionId: context.sessionId,
    operation: "invitation_accept",
    targetKind: "rights_session",
    targetId: sessionHash,
  });
  if (!claims) return notFound();

  const upload = presentationOf(context.user.id, body.coParentArtifacts.uploadEmbryo, UPLOAD_KEYS);
  const parentage = presentationOf(context.user.id, body.coParentArtifacts.parentageAttestation, PARENTAGE_KEYS);
  if (!upload || !parentage || upload.targetId !== parentage.targetId) return notFound();

  const admin = createAdminClient();
  // The draft the page learned from the rights session must be the draft
  // the session still names, and both artifacts must still be the current
  // bodies that were shown; otherwise nothing is written.
  const [{ data: session }, { data: artifacts }] = await Promise.all([
    admin
      .from("rights_sessions")
      .select("target_id")
      .eq("session_hash", sessionHash)
      .eq("purpose", "co-parent-invitation")
      .eq("target_kind", "cohort_draft")
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
    admin
      .from("consent_artifacts")
      .select("artifact_key, version, body_sha256")
      .in("artifact_key", [upload.artifactKey, parentage.artifactKey])
      .is("superseded_at", null),
  ]);
  if (!session || session.target_id !== upload.targetId) return notFound();
  for (const presentation of [upload, parentage]) {
    const current = (artifacts ?? []).find((row) => row.artifact_key === presentation.artifactKey);
    if (
      !current ||
      current.version !== presentation.artifactVersion ||
      current.body_sha256 !== presentation.artifactBodySha256
    ) {
      return notFound();
    }
  }

  const { data: draftId, error } = await admin.rpc("accept_embryo_co_parent_invitation_v1", {
    p_session_hash: sessionHash,
    p_account_id: context.user.id,
    p_account_email_hmac: hmacSecret(normalizeContact(context.user.email), "contact-email-v1"),
    p_signing_name_ciphertext: encryptedLiteral(body.coParentArtifacts.uploadEmbryo.typedName),
    p_jurisdiction_code: jurisdictionCode,
    p_upload_statement_keys: [...body.coParentArtifacts.uploadEmbryo.statementKeys],
    p_parentage_statement_keys: [...body.coParentArtifacts.parentageAttestation.statementKeys],
    p_token_nonce: claims.nonce,
  });
  if (error || draftId !== upload.targetId) return notFound();

  return closedResponse(
    "api.invitation-accept",
    ACCEPTED_KEYS,
    {
      invitationKind: "co_parent",
      status: "accepted",
      cohortDraftId: draftId,
      participantState: "accepted_pending_cohort_finalization",
    },
    200,
  );
}
