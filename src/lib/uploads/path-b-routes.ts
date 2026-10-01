import "server-only";

import { hmacSecret } from "@/lib/crypto";
import { encryptedLiteral } from "@/lib/embryos/guards";
import { contactDigestSet, legacyContactDigest } from "@/lib/hmac-keyring";
import { invitationQuotaKeys } from "@/lib/invitation-quota";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isAdultOn,
  pathBDraftBody,
  pathBDraftReceipt,
  pathBInvitationBody,
} from "./other-adult-upload";
import { heldUploadRpc, otherAdultUploadAvailable, verifyPathBOperation } from "./other-adult-upload-server";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";

/**
 * The two uploader mutations of the register's Path B that are not
 * signatures (TEST-LOCAL only):
 *   - `POST /api/subject-drafts` with the path-b-subject-esignature body
 *     reserves a draft with the person's name, date of birth and address;
 *   - `POST /api/invitations` with `targetSubjectDraftId` sends the
 *     e-signature request to the address that draft already holds.
 * Both are same-origin, carry a page-minted operation token, and are refused
 * as an unknown resource wherever Path B is not available. Both send the
 * address under every contact key revision this deployment holds, never one
 * bare digest; the request also sends the attempt-quota keys, which the
 * database consumes before it matches anything.
 */

function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin
    && request.headers.get("sec-fetch-site") === "same-origin";
}

export async function createPathBDraft(request: Request, payload: unknown): Promise<Response> {
  if (!sameOrigin(request)) return ownUploadJson({ error: "forbidden" }, 403);
  const actor = await currentOwnUploadAccount();
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  if (!(await otherAdultUploadAvailable(actor.accountId))) return ownUploadJson({ error: "not_found" }, 404);
  if (!verifyPathBOperation(request.headers.get("x-inherit-csrf"), { accountId: actor.accountId,
    sessionId: actor.sessionId, operation: "draft-create", targetId: actor.accountId })) {
    return ownUploadJson({ error: "forbidden" }, 403);
  }
  const parsed = pathBDraftBody.safeParse(payload);
  if (!parsed.success || !isAdultOn(parsed.data.dateOfBirth)) return ownUploadJson({ error: "invalid_request" }, 422);
  const body = parsed.data;
  const { data, error } = await heldUploadRpc(createAdminClient(), "create_path_b_adult_draft_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_display_name: body.displayName,
    p_date_of_birth: body.dateOfBirth, p_contact_ciphertext: encryptedLiteral(body.contactEmail),
    p_contact_hmac: null,
    p_contact_hmac_set: contactDigestSet(body.contactEmail),
    p_request_key: hmacSecret(JSON.stringify(["adult-path-b-draft-v1", actor.accountId, body.requestId]),
      "mail-idempotency-v1"),
    p_test_jurisdiction: true,
  });
  if (error) {
    if (error.code === "42501") return ownUploadJson({ error: "not_found" }, 404);
    if (error.code === "22023") return ownUploadJson({ error: "invalid_request" }, 422);
    if (error.code === "55000" && error.message === "adult_account_required") {
      return ownUploadJson({ error: "adult_account_required" }, 409);
    }
    return ownUploadJson({ error: "unavailable" }, 503);
  }
  const receipt = pathBDraftReceipt.safeParse(data);
  if (!receipt.success) return ownUploadJson({ error: "unavailable" }, 503);
  return ownUploadJson(receipt.data, 201);
}

export async function createPathBInvitation(request: Request, payload: unknown): Promise<Response> {
  if (!sameOrigin(request)) return ownUploadJson({ error: "forbidden" }, 403);
  const actor = await currentOwnUploadAccount();
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  if (!(await otherAdultUploadAvailable(actor.accountId))) return ownUploadJson({ error: "not_found" }, 404);
  const parsed = pathBInvitationBody.safeParse(payload);
  if (!parsed.success) return ownUploadJson({ error: "invalid_request" }, 422);
  const body = parsed.data;
  if (!verifyPathBOperation(request.headers.get("x-inherit-csrf"), { accountId: actor.accountId,
    sessionId: actor.sessionId, operation: "request-send", targetId: body.targetSubjectDraftId })) {
    return ownUploadJson({ error: "forbidden" }, 403);
  }
  const { error } = await heldUploadRpc(createAdminClient(), "create_path_b_invitation_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: body.targetSubjectDraftId,
    p_contact_hmac: null,
    p_contact_hmac_set: contactDigestSet(body.contactEmail),
    p_quota_keys: invitationQuotaKeys(actor.accountId, request.headers),
    // The revision-1 digest keeps the idempotency key stable across a rotation.
    p_idempotency_key: hmacSecret(JSON.stringify(["adult-path-b-request-v1", actor.accountId,
      body.targetSubjectDraftId, legacyContactDigest(body.contactEmail)]), "mail-idempotency-v1"),
    p_test_jurisdiction: true,
  });
  // A mismatch, a foreign or used draft, a missing signature, a live refusal
  // bar and an exhausted attempt quota are the same receipt: the answer never
  // says which.
  if (error && error.code !== "42501" && error.code !== "22023") return ownUploadJson({ error: "unavailable" }, 503);
  return ownUploadJson({ status: "received" }, 202);
}
