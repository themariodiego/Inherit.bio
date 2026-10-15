import { EMBRYO_ARTIFACT_STATEMENT_KEYS, EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS, type EmbryoArtifactKey } from "./basis";

export interface StageSignature {
  id: string; artifact_key: string; artifact_version: number; artifact_body_sha256: string;
  signer_principal_id: string; signer_account_id: string; purpose: string | null; signed_at: string;
  statement_keys: string[]; jurisdiction_code: string | null; jurisdiction_revision: number;
}
export interface StageAttestation {
  signature_id: string; principal_id: string; kind: string; statement_keys: string[]; affirmed: boolean;
}
const KINDS: Partial<Record<EmbryoArtifactKey, string>> = {
  "attestation.embryo-parentage": "genetic_parent",
  "attestation.embryo-disposition-rights": "disposition_rights",
  "attestation.embryo-single-parent-basis": "single_parent_authority",
  "charter.future-person": "future_person_acknowledgement",
};
const same = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((key, index) => key === right[index]);

/** Mirrors the finalizer's current-artifact, signer, jurisdiction and attestation checks.
 * The mutation repeats all checks under locks; this read never grants authority. */
export function currentStageSignature(input: {
  signature: StageSignature;
  artifact: { artifact_key: string; version: number; body_sha256: string } | undefined;
  principal: { account_id: string | null; status: string } | undefined;
  profile: { jurisdiction_code: string | null; jurisdiction_revision: number } | undefined;
  attestations: StageAttestation[];
}): boolean {
  const { signature: s, artifact: a, principal: p, profile, attestations } = input;
  if (!a || !p || !profile || p.status !== "active" || !p.account_id || s.signer_account_id !== p.account_id
    || s.artifact_key !== a.artifact_key || s.artifact_version !== a.version || s.artifact_body_sha256 !== a.body_sha256
    || s.jurisdiction_code !== profile.jurisdiction_code || s.jurisdiction_revision !== profile.jurisdiction_revision) return false;
  const key = s.artifact_key as EmbryoArtifactKey;
  const uploader = key === "consent.upload-embryo" && s.purpose === "embryo-upload-uploader-class";
  const expected = uploader ? EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS : EMBRYO_ARTIFACT_STATEMENT_KEYS[key];
  if (!expected || !same(s.statement_keys, expected)) return false;
  if (key === "consent.upload-embryo" && s.purpose !== (uploader ? "embryo-upload-uploader-class" : "embryo-upload-parent-class")) return false;
  const kind = KINDS[key];
  return !kind || attestations.some(at => at.signature_id === s.id && at.principal_id === s.signer_principal_id
    && at.kind === kind && at.affirmed && same(at.statement_keys, s.statement_keys));
}
