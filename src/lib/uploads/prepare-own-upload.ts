import "server-only";

import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { currentOwnUploadAccount, ownSnapshotArgs, ownUploadContextSchema } from "./own-upload-context";
import { mintOwnAccountCompletionPresentation, mintOwnConsentPresentation } from "./own-consent-token";
import { OWN_UPLOAD_ARTIFACT_KEYS } from "./own-consent";
import type { OwnUploadView } from "./own-upload-view";

/** No personal birth date or genotype enters the client presentation. */
export async function prepareOwnUpload(subject = "me"): Promise<OwnUploadView> {
  const actor = await currentOwnUploadAccount();
  if (!actor) return { kind: "unavailable" };
  const target = await resolveSubjectForAccount(actor.accountId, subject);
  if (!target || target.subjectAccountId !== actor.accountId
    || !["self", "other_adult"].includes(target.subjectClass)) return { kind: "unavailable" };
  const admin = createAdminClient();
  const contextResult = await admin.rpc("own_upload_context_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: target.id,
  });
  const parsed = ownUploadContextSchema.safeParse(contextResult.data);
  if (contextResult.error || !parsed.success) return { kind: "unavailable" };
  const { birthDateState, ...revisions } = parsed.data;
  const snapshot = { ...actor, ...revisions, subjectId: target.id };
  if (birthDateState === "underage") return { kind: "underage" };
  if (birthDateState === "missing") {
    const presentation = mintOwnAccountCompletionPresentation(snapshot);
    const { error } = await admin.rpc("issue_own_upload_nonce_v1", {
      ...ownSnapshotArgs(snapshot), p_operation: "own_account_completion",
      p_nonce_hash: presentation.nonceHash, p_expires_at: new Date(presentation.claims.expiresAt).toISOString(),
    });
    return error ? { kind: "unavailable" } : { kind: "account-completion", token: presentation.token };
  }
  const now = new Date().toISOString();
  const [artifactResult, bindingResult] = await Promise.all([
    admin.from("consent_artifacts")
      .select("artifact_key, version, body_sha256, body_markdown, summary_markdown")
      .in("artifact_key", [...OWN_UPLOAD_ARTIFACT_KEYS]).is("superseded_at", null)
      .lte("published_at", now).lte("effective_on", now.slice(0, 10)),
    admin.from("subject_account_bindings").select("subject_principal_id")
      .eq("subject_id", target.id).eq("account_id", actor.accountId).eq("status", "current")
      .eq("binding_revision", revisions.accountBindingRevision).maybeSingle(),
  ]);
  if (artifactResult.error || bindingResult.error || !bindingResult.data || artifactResult.data?.length !== 2) {
    return { kind: "unavailable" };
  }
  const artifacts = artifactResult.data;
  if (artifacts.some(a => crypto.createHash("sha256").update(a.body_markdown).digest("hex") !== a.body_sha256)) {
    return { kind: "unavailable" };
  }
  const [signatureResult, grantResult] = await Promise.all([
    admin.from("consent_signatures").select("id, artifact_key, artifact_version, artifact_body_sha256")
      .eq("target_kind", "subject").eq("target_id", target.id).eq("signer_account_id", actor.accountId)
      .eq("signer_principal_id", bindingResult.data.subject_principal_id)
      .eq("subject_binding_revision", revisions.subjectBindingRevision)
      .eq("jurisdiction_revision", revisions.jurisdictionRevision)
      .in("artifact_key", [...OWN_UPLOAD_ARTIFACT_KEYS]),
    admin.from("subject_consents").select("signature_id").eq("subject_id", target.id)
      .eq("account_id", actor.accountId).eq("consent_type", "upload_class").is("revoked_at", null)
      .contains("scope", ["store"]).or(`expires_at.is.null,expires_at.gt.${now}`),
  ]);
  if (signatureResult.error || grantResult.error) return { kind: "unavailable" };
  for (const key of OWN_UPLOAD_ARTIFACT_KEYS) {
    const artifact = artifacts.find(a => a.artifact_key === key)!;
    const current = signatureResult.data?.some(s => s.artifact_key === key && s.artifact_version === artifact.version
      && s.artifact_body_sha256 === artifact.body_sha256
      && (key !== "consent.upload-self" || grantResult.data?.some(g => g.signature_id === s.id)));
    if (current) continue;
    const presentation = mintOwnConsentPresentation({ ...snapshot, artifactKey: key,
      artifactVersion: artifact.version, artifactBodySha256: artifact.body_sha256 });
    const { error } = await admin.rpc("issue_own_upload_nonce_v1", {
      ...ownSnapshotArgs(snapshot), p_operation: "own_upload_artifact_sign", p_nonce_hash: presentation.nonceHash,
      p_expires_at: new Date(presentation.claims.expiresAt).toISOString(),
    });
    if (error) return { kind: "unavailable" };
    return { kind: "consent", subjectId: target.id, token: presentation.token,
      artifact: { key, version: artifact.version, summary: artifact.summary_markdown, body: artifact.body_markdown } };
  }
  return { kind: "ready", subjectId: target.id };
}
