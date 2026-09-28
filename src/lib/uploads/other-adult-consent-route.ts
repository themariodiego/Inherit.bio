import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  OTHER_ADULT_UPLOAD_ARTIFACT_KEY,
  isOtherAdultStatementSet,
  otherAdultConsentBody,
  otherAdultTypedNameIsValid,
} from "./other-adult-upload";
import { heldUploadRpc, otherAdultUploadAvailable, readOtherAdultPresentation } from "./other-adult-upload-server";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";

const signatureResponse = z.object({
  recordKind: z.literal("artifact_signature"), recordId: z.uuid(),
  artifactKey: z.literal(OTHER_ADULT_UPLOAD_ARTIFACT_KEY), artifactVersion: z.number().int().positive().safe(),
  signedAt: z.iso.datetime({ offset: true }),
}).strict();

/**
 * `POST /api/consents`, the Tier-2 uploader body with a `subjectDraftId`
 * (register api.consents, signer case `other-adult-uploader-artifact`): the
 * approved `consent.upload-other-adult` for the uploader's own Path B draft
 * or the Path B subject it became. TEST-LOCAL only, because the flow is.
 * The signer, person, artifact version and hash come
 * from the sealed presentation the upload page minted; the body must agree
 * with it or the answer is an unknown resource with no write. The typed name
 * is stored only as ciphertext.
 */
export async function otherAdultUploadConsent(request: Request, payload: unknown): Promise<Response> {
  const parsed = otherAdultConsentBody.safeParse(payload);
  if (!parsed.success) return ownUploadJson({ error: "invalid_request" }, 422);
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin") return ownUploadJson({ error: "forbidden" }, 403);
  const body = parsed.data;
  if (request.headers.get("x-inherit-csrf") !== body.artifactPresentationToken) {
    return ownUploadJson({ error: "forbidden" }, 403);
  }
  const actor = await currentOwnUploadAccount();
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  if (!(await otherAdultUploadAvailable(actor.accountId))) return ownUploadJson({ error: "not_found" }, 404);
  const presentation = readOtherAdultPresentation(body.artifactPresentationToken);
  if (!presentation || presentation.accountId !== actor.accountId || presentation.sessionId !== actor.sessionId
    || presentation.subjectId !== body.subjectDraftId || presentation.artifactVersion !== body.artifactVersion) {
    return ownUploadJson({ error: "not_found" }, 404);
  }
  if (!isOtherAdultStatementSet(body.statementKeys)) return ownUploadJson({ error: "invalid_request" }, 422);
  if (!otherAdultTypedNameIsValid(body.typedName)) return ownUploadJson({ error: "invalid_request" }, 422);
  const { data, error } = await heldUploadRpc(createAdminClient(), "sign_other_adult_upload_artifact_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: presentation.subjectId,
    p_artifact_version: presentation.artifactVersion, p_artifact_body_sha256: presentation.artifactBodySha256,
    p_statement_keys: [...body.statementKeys],
    p_signing_name_ciphertext: `\\x${encryptSecret(body.typedName.trim()).toString("hex")}`,
    p_nonce_hash: crypto.createHash("sha256").update(presentation.nonce).digest("hex"),
    p_test_jurisdiction: true,
  });
  if (error) {
    if (error.code === "42501" || error.code === "23505") return ownUploadJson({ error: "not_found" }, 404);
    if (error.code === "22023") return ownUploadJson({ error: "invalid_request" }, 422);
    if (error.code === "55000") {
      const known = ["adult_account_required", "consent_artifact_changed"];
      return ownUploadJson({ error: error.message && known.includes(error.message) ? error.message : "state_conflict" }, 409);
    }
    return ownUploadJson({ error: "unavailable" }, 503);
  }
  const receipt = signatureResponse.safeParse(data);
  if (!receipt.success || receipt.data.artifactVersion !== presentation.artifactVersion) {
    return ownUploadJson({ error: "unavailable" }, 503);
  }
  return ownUploadJson(receipt.data, 201);
}
