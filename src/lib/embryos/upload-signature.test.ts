import { describe, expect, it } from "vitest";
import { EMBRYO_ARTIFACT_STATEMENT_KEYS } from "./basis";
import { currentStageSignature, type StageSignature } from "./upload-signature";

const signature: StageSignature = { id: "synthetic-signature", artifact_key: "attestation.embryo-parentage", artifact_version: 2,
  artifact_body_sha256: "a".repeat(64), signer_principal_id: "synthetic-parent", signer_account_id: "synthetic-account", purpose: null,
  signed_at: "2026-09-30T00:00:00Z", statement_keys: [...EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-parentage"]],
  jurisdiction_code: "TEST-LOCAL", jurisdiction_revision: 3 };
const input = () => ({ signature: { ...signature }, artifact: { artifact_key: signature.artifact_key, version: 2, body_sha256: signature.artifact_body_sha256 },
  principal: { account_id: signature.signer_account_id, status: "active" }, profile: { jurisdiction_code: "TEST-LOCAL", jurisdiction_revision: 3 },
  attestations: [{ signature_id: signature.id, principal_id: signature.signer_principal_id, kind: "genetic_parent", statement_keys: [...signature.statement_keys], affirmed: true }] });

describe("current upload signatures", () => {
  it("admits the current saved signature and its paired affirmation", () => expect(currentStageSignature(input())).toBe(true));
  it.each(["artifact_version", "artifact_body_sha256", "signer_account_id", "jurisdiction_code", "jurisdiction_revision", "statement_keys"] as const)("refuses a stale or different %s", field => {
    const value = input();
    if (field === "artifact_version" || field === "jurisdiction_revision") value.signature[field] -= 1;
    else if (field === "statement_keys") value.signature.statement_keys = [...value.signature.statement_keys].reverse();
    else value.signature[field] = "different";
    expect(currentStageSignature(value)).toBe(false);
  });
  it("refuses an inactive signer and a missing profile or published artifact", () => {
    expect(currentStageSignature({ ...input(), principal: { ...input().principal, status: "deleted" } })).toBe(false);
    expect(currentStageSignature({ ...input(), profile: undefined })).toBe(false);
    expect(currentStageSignature({ ...input(), artifact: undefined })).toBe(false);
  });
  it("refuses missing, unaffirmed, foreign-parent or wrong-kind attestation", () => {
    expect(currentStageSignature({ ...input(), attestations: [] })).toBe(false);
    for (const changed of [{ affirmed: false }, { principal_id: "other-parent" }, { kind: "disposition_rights" }, { statement_keys: [] }]) {
      expect(currentStageSignature({ ...input(), attestations: [{ ...input().attestations[0], ...changed }] })).toBe(false);
    }
  });
});
