import "server-only";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { decryptSecret, hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentArtifact } from "@/lib/legal/artifacts";
import { isTestJurisdictionEnabled, resolveCapability } from "@/lib/legal/jurisdictions";
import { mintArtifactPresentation } from "@/lib/family/grant-token";
import { EMBRYO_ARTIFACT_STATEMENT_KEYS } from "./basis";
import { mintEmbryoOperation } from "./operation-token";
import { readRightsSessionHash } from "./rights-session";
import { normalizeContact } from "./routes";

const ARTIFACTS = ["consent.upload-embryo", "attestation.embryo-parentage"] as const;

/**
 * A purpose-limited read, never an acceptance. No target is read until the
 * cookie resolves to an active, unexpired session of the supported purpose.
 * No target details or signing forms reach an unauthenticated/wrong account.
 * The mutation rechecks authority in its transaction; this read grants none.
 */
export async function loadCoParentReview(request: Request, now = Date.now()) {
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin.from("rights_sessions")
    .select("purpose, target_kind, target_id, principal_id, authority_revision, status, expires_at")
    .eq("session_hash", sessionHash).maybeSingle();
  if (sessionError || !session || session.purpose !== "co-parent-invitation"
    || session.target_kind !== "cohort_draft" || session.status !== "active"
    || !(Date.parse(session.expires_at) > now)) return null;

  const context = await getSensitiveAccountContext();
  if (!context) return { kind: "sign-in" as const };
  if (!context.user.email || !context.user.email_confirmed_at) return null;

  const { data: invitation, error: invitationError } = await admin.from("subject_invitations")
    .select("id")
    .eq("invitee_principal_id", session.principal_id)
    .eq("target_kind", "cohort_draft").eq("target_id", session.target_id)
    .eq("invitation_kind", "co_parent").eq("status", "pending")
    .eq("invitation_revision", session.authority_revision)
    .eq("email_hmac", hmacSecret(normalizeContact(context.user.email), "contact-email-v1"))
    .gt("expires_at", new Date(now).toISOString()).maybeSingle();
  if (invitationError || !invitation) return null;

  const [{ data: draft, error: draftError }, { data: principal, error: principalError },
    { data: slot, error: slotError }, { data: profile, error: profileError }] = await Promise.all([
    admin.from("embryo_cohort_drafts").select("id, embryo_count, owner_account_id, upload_situation, basis_case")
      .eq("id", session.target_id).in("state", ["draft", "evidence_pending", "ready"])
      .gt("fixed_expires_at", new Date(now).toISOString()).maybeSingle(),
    admin.from("subject_principals").select("id")
      .eq("id", session.principal_id).eq("status", "pending").eq("principal_kind", "genetic_parent").maybeSingle(),
    admin.from("draft_participant_slots").select("id")
      .eq("embryo_draft_id", session.target_id).eq("principal_id", session.principal_id)
      .eq("state", "pending").in("slot_kind", ["parent_a", "parent_b"]).maybeSingle(),
    admin.from("profiles").select("deletion_requested_at")
      .eq("id", context.user.id).maybeSingle(),
  ]);
  if (draftError || principalError || slotError || profileError || !draft || !principal || !slot || !profile
    || draft.owner_account_id === context.user.id || profile.deletion_requested_at) return null;

  // Read only the inviter's already-signed name for this draft, not their
  // account profile, contact address, genome or any unrelated signature.
  const { data: signature, error: signatureError } = await admin.from("consent_signatures")
    .select("signing_name_encrypted")
    .eq("signer_account_id", draft.owner_account_id)
    .eq("target_kind", "cohort_draft").eq("target_id", draft.id)
    .eq("artifact_key", "consent.upload-embryo")
    .order("signed_at", { ascending: false }).limit(1).maybeSingle();
  if (signatureError || !signature?.signing_name_encrypted) return null;
  let inviterName: string;
  try {
    inviterName = decryptSecret(Buffer.from(signature.signing_name_encrypted.replace(/^\\x/u, ""), "hex"));
  } catch { return null; }

  const artifacts = await Promise.all(ARTIFACTS.map(async key => {
    const artifact = await getCurrentArtifact(key);
    if (!artifact) return null;
    const statementKeys = [...EMBRYO_ARTIFACT_STATEMENT_KEYS[key]];
    return {
      ...artifact,
      statementKeys,
      presentationToken: mintArtifactPresentation({
        accountId: context.user.id, targetKind: "cohort_draft", targetId: draft.id,
        artifactKey: key, artifactVersion: artifact.version,
        artifactBodySha256: artifact.body_sha256, statementKeys,
      }, now),
    };
  }));
  if (artifacts.some(artifact => artifact === null)) return null;
  return {
    kind: "review" as const,
    inviterName,
    embryoCount: draft.embryo_count,
    uploadSituation: draft.upload_situation,
    basisCase: draft.basis_case,
    artifacts: artifacts.filter(artifact => artifact !== null),
    nonce: mintEmbryoOperation({
      accountId: context.user.id, sessionId: context.sessionId, operation: "invitation_accept",
      targetKind: "rights_session", targetId: sessionHash,
    }, now),
    acceptanceAvailable: isTestJurisdictionEnabled(),
    unavailableCopy: resolveCapability(null, "embryo_analysis", { testJurisdiction: false }).userFacingCopy,
  };
}

export type CoParentReview = Extract<NonNullable<Awaited<ReturnType<typeof loadCoParentReview>>>, { kind: "review" }>;
