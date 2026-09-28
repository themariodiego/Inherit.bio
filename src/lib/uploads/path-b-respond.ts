import "server-only";

import { notFound } from "@/lib/embryos/api";
import { closedResponse, encryptedLiteral } from "@/lib/embryos/guards";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { currentJurisdictionAttestation, jurisdictionChoices } from "@/lib/legal/jurisdiction-declaration";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SUBJECT_ESIGNATURE_STATEMENT_KEYS,
  isExactKeys,
  otherAdultTypedNameIsValid,
  type PathBAccountConfirmRequest,
  type PathBSubjectConfirmRequest,
} from "./other-adult-upload";
import { contactDigestSet } from "@/lib/hmac-keyring";
import { currentPathBAccount, heldUploadRpc } from "./other-adult-upload-server";
import { readSubjectPresentation } from "./path-b-review";

const RECEIPT_KEYS = ["status", "operation"] as const;

/**
 * The person signs a Path B request with no account (register api.withdraw,
 * the full confirm body; adult-subject-confirmation-v1, the no-account
 * branch of path-b-token-or-account). Every mismatch is the same 404: a stale
 * presentation, a statement set that is not the published one, a name that
 * is not a name, a country outside the catalogue or an attestation that is
 * not the current one. The typed name is stored only as ciphertext.
 */
export async function confirmPathBSubject(authority: { sessionHash: string; nonce: string },
  body: PathBSubjectConfirmRequest): Promise<Response> {
  if (!isTestJurisdictionEnabled()) return notFound();
  const artifact = body.subjectArtifact;
  const presentation = readSubjectPresentation(artifact.artifactPresentationToken);
  if (!presentation || presentation.sessionHash !== authority.sessionHash
    || presentation.artifactVersion !== artifact.artifactVersion
    || !isExactKeys(artifact.statementKeys, SUBJECT_ESIGNATURE_STATEMENT_KEYS)
    || !otherAdultTypedNameIsValid(artifact.typedName)
    || !jurisdictionChoices().some(choice => choice.code === body.jurisdictionCode)) return notFound();
  const attestation = await currentJurisdictionAttestation();
  if (!attestation || attestation.version !== body.jurisdictionAttestationVersion
    || attestation.sha256 !== body.jurisdictionAttestationHash) return notFound();
  const { data, error } = await heldUploadRpc(createAdminClient(), "confirm_path_b_subject_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce,
    p_artifact_version: presentation.artifactVersion, p_artifact_body_sha256: presentation.artifactBodySha256,
    p_statement_keys: [...artifact.statementKeys],
    p_signing_name_ciphertext: encryptedLiteral(artifact.typedName.trim()),
    p_jurisdiction_code: body.jurisdictionCode, p_test_jurisdiction: true,
  });
  if (error || data !== "accepted") return notFound();
  return closedResponse("api.withdraw", RECEIPT_KEYS, { status: "accepted", operation: "confirm" }, 202);
}

/**
 * The person confirms a Path B request with their signed-in account (Path
 * B's account branch; adult-subject-confirmation-v1, the authenticated
 * transaction). The same artifact and typed name; no country field, because
 * the account's own current declaration counts. The account's address goes
 * to the database only as digests under every held contact key revision, and
 * the database compares the one the invitation was written under. Every
 * mismatch, including no signed-in account or an unconfirmed address, is the
 * same 404.
 */
export async function confirmPathBSubjectWithAccount(authority: { sessionHash: string; nonce: string },
  body: PathBAccountConfirmRequest): Promise<Response> {
  if (!isTestJurisdictionEnabled()) return notFound();
  const artifact = body.subjectArtifact;
  const presentation = readSubjectPresentation(artifact.artifactPresentationToken);
  if (!presentation || presentation.sessionHash !== authority.sessionHash
    || presentation.artifactVersion !== artifact.artifactVersion
    || !isExactKeys(artifact.statementKeys, SUBJECT_ESIGNATURE_STATEMENT_KEYS)
    || !otherAdultTypedNameIsValid(artifact.typedName)) return notFound();
  const account = await currentPathBAccount().catch(() => null);
  if (!account?.email) return notFound();
  const { data, error } = await heldUploadRpc(createAdminClient(), "confirm_path_b_subject_account_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce,
    p_artifact_version: presentation.artifactVersion, p_artifact_body_sha256: presentation.artifactBodySha256,
    p_statement_keys: [...artifact.statementKeys],
    p_signing_name_ciphertext: encryptedLiteral(artifact.typedName.trim()),
    p_account_id: account.accountId, p_auth_session_id: account.sessionId,
    p_account_email_hmac: null, p_account_email_hmac_set: contactDigestSet(account.email),
    p_test_jurisdiction: true,
  });
  if (error || data !== "accepted") return notFound();
  return closedResponse("api.withdraw", RECEIPT_KEYS, { status: "accepted", operation: "confirm" }, 202);
}

/**
 * The person answers one held file (adult-upload-revision-confirmation-v1,
 * adult-upload-revision-refusal-v1, or the subject's own delete). No account
 * is needed and the uploader is never involved. When someone is signed in,
 * their account goes with the answer: for a person who confirmed with an
 * account, the database refuses any other account (authorityCases
 * account-bound-subject). The receipt names the operation and nothing else.
 */
export async function answerAdultUploadRevision(authority: { sessionHash: string; nonce: string },
  operation: "confirm" | "refuse" | "delete"): Promise<Response> {
  const account = await currentPathBAccount().catch(() => null);
  const { data, error } = await heldUploadRpc(createAdminClient(), "respond_adult_upload_revision_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce, p_action: operation,
    p_account_id: account?.accountId ?? null,
  });
  const expected = operation === "confirm" ? "confirmed" : operation === "refuse" ? "refused" : "deleted";
  if (error || data !== expected) return notFound();
  return closedResponse("api.withdraw", RECEIPT_KEYS, { status: "accepted", operation }, 202);
}
