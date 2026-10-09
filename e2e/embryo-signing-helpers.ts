import { expect, type Page, type Response } from "@playwright/test";
import { adminClient } from "./helpers";
import { SIGNING_STATUS } from "@/copy/embryos/signing";

const DRAFT_PURPOSES: Record<string, string> = {
  "attestation.embryo-parentage": "embryo-parentage-attestation",
  "attestation.embryo-disposition-rights": "embryo-disposition-rights-attestation",
  "attestation.embryo-single-parent-basis": "embryo-single-parent-basis-attestation",
  "charter.future-person": "future-person-charter-acknowledgement",
  "disclosure.insurance-and-discrimination": "disclosure-acknowledgement",
};
const ATTESTATION_KINDS: Record<string, string> = {
  "attestation.embryo-parentage": "genetic_parent",
  "attestation.embryo-disposition-rights": "disposition_rights",
  "attestation.embryo-single-parent-basis": "single_parent_authority",
  "charter.future-person": "future_person_acknowledgement",
};

/** Observe the native product requests and their exact committed signatures.
 * Completion is a real receipt, not an assumption about form unmounting. */
export async function signStatements(page: Page, button: string, accountId: string) {
  const form = page.locator('[data-slot="signing-form"]');
  const artifacts = await form.locator("fieldset[data-artifact]").evaluateAll(fields => fields.map(field => {
    const key = field.getAttribute("data-artifact")!;
    const paragraphs = [...field.querySelectorAll("p")].map(p => p.textContent ?? "");
    const version = Number(paragraphs.find(text => /^Version \d+ ·/.test(text))?.match(/^Version (\d+)/)?.[1]);
    const sha256 = paragraphs.find(text => /^sha256 [a-f0-9]{64}$/.test(text))?.slice(7);
    const statements = [...field.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .map(input => input.name.slice(key.length + 1));
    return { key, version, sha256, statements };
  }));
  expect(artifacts.length).toBeGreaterThan(0);
  expect(new Set(artifacts.map(artifact => artifact.key)).size).toBe(artifacts.length);
  for (const artifact of artifacts) {
    expect(Number.isInteger(artifact.version) && artifact.version > 0).toBe(true);
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.statements.length).toBeGreaterThan(0);
  }
  for (const box of await form.getByRole("checkbox").all()) await box.check();
  await form.getByLabel("Full legal name").fill("Synthetic Parent");
  const responses: Response[] = [];
  const observe = (response: Response) => {
    if (new URL(response.url()).pathname === "/api/consents" && response.request().method() === "POST") responses.push(response);
  };
  page.on("response", observe);
  try {
    await form.getByRole("button", { name: button, exact: true }).click();
    const admin = adminClient();
    const profile = await admin.from("profiles").select("jurisdiction_code,jurisdiction_revision").eq("id", accountId).single();
    expect(profile.error).toBeNull();
    for (let index = 0; index < artifacts.length; index++) {
      await expect.poll(() => responses.length).toBeGreaterThan(index);
      const artifact = artifacts[index], response = responses[index];
      expect(response.status(), `Native signing receipt for ${artifact.key}`).toBe(201);
      const receipt = await response.json();
      const request = response.request().postDataJSON();
      const grant = request.action === "grant-purpose";
      expect(Object.keys(receipt).sort()).toEqual((grant
        ? ["recordKind", "recordId", "artifactKey", "artifactVersion", "signedAt", "purposeKey"]
        : ["recordKind", "recordId", "artifactKey", "artifactVersion", "signedAt"]).sort());
      expect(receipt).toMatchObject({ recordKind: grant ? "purpose_grant" : "artifact_signature",
        artifactKey: artifact.key, artifactVersion: artifact.version });
      expect(receipt.recordId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      expect(typeof receipt.signedAt).toBe("string");
      expect(Number.isFinite(Date.parse(receipt.signedAt))).toBe(true);
      expect(request.statementKeys).toEqual(artifact.statements);
      let signatureId: string = receipt.recordId;
      if (grant) {
        expect(receipt.purposeKey).toBe("embryo.analysis");
        const stored = await admin.from("purpose_grants").select("signature_id,target_kind,target_id,purpose,artifact_body_sha256,revoked_at")
          .eq("grant_id", receipt.recordId).single();
        expect(stored.error).toBeNull();
        expect(stored.data).toMatchObject({ target_kind: "cohort", target_id: request.cohortId,
          purpose: "embryo.analysis", artifact_body_sha256: artifact.sha256, revoked_at: null });
        signatureId = stored.data!.signature_id;
      }
      const stored = await admin.from("consent_signatures")
        .select("id,artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,signer_account_id,target_kind,target_id,purpose,statement_keys,signed_at,jurisdiction_code,jurisdiction_revision")
        .eq("id", signatureId).single();
      expect(stored.error).toBeNull();
      const purpose = grant ? "embryo.analysis" : artifact.key === "consent.upload-embryo"
        ? artifact.statements.includes("uploader-right-to-files") ? "embryo-upload-uploader-class" : "embryo-upload-parent-class"
        : DRAFT_PURPOSES[artifact.key];
      expect(typeof purpose).toBe("string");
      expect(stored.data).toMatchObject({ id: signatureId, artifact_key: artifact.key, artifact_version: artifact.version,
        artifact_body_sha256: artifact.sha256, signer_account_id: accountId,
        target_kind: grant ? "cohort" : "cohort_draft", target_id: grant ? request.cohortId : request.cohortDraftId,
        purpose, statement_keys: artifact.statements, ...profile.data });
      expect(Number.isFinite(Date.parse(stored.data!.signed_at))).toBe(true);
      const principal = await admin.from("subject_principals").select("account_id,status").eq("id", stored.data!.signer_principal_id).single();
      expect(principal.error).toBeNull();
      expect(principal.data).toEqual({ account_id: accountId, status: "active" });
      if (!grant && ATTESTATION_KINDS[artifact.key]) {
        const attestation = await admin.from("attestations").select("principal_id,target_kind,target_id,kind,statement_keys,affirmed")
          .eq("signature_id", signatureId).single();
        expect(attestation.error).toBeNull();
        expect(attestation.data).toEqual({ principal_id: stored.data!.signer_principal_id, target_kind: "cohort_draft",
          target_id: request.cohortDraftId, kind: ATTESTATION_KINDS[artifact.key], statement_keys: artifact.statements, affirmed: true });
      }
    }
    expect(responses).toHaveLength(artifacts.length);
    await expect(page.getByRole("button", { name: SIGNING_STATUS, exact: true })).toHaveCount(0);
    await expect(page.locator('[data-slot="signing-failed"]')).toHaveCount(0);
  } finally { page.off("response", observe); }
}
