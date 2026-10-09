import { z } from "zod";
import { invalidRequest, unavailable } from "@/lib/embryos/api";
import { correctionIntakeBody, sealNewCorrection } from "@/lib/future-person/correction-case-envelope";
import { correctionIntakeMutation, correctionPrepareFrame, sealNewCorrectionContact } from "@/lib/future-person/correction-intake";
import { createCorrectionIntakeRuntime, type CorrectionIntakeRuntime } from "@/lib/future-person/correction-intake-runtime";
import { readCorrectionIntakeJson } from "@/lib/future-person/correction-intake-json";
import { applyAppealIntakeHeaders } from "@/lib/future-person/appeal-intake-response";
import { requesterStatementsOpen } from "@/lib/future-person/requester-statement";
import { claimantNotFound, claimantResponse } from "@/lib/future-person/rights";
import { createAdminClient } from "@/lib/supabase/admin";

const received = z.object({ status: z.literal("review_pending"), correctionId: z.uuid() }).strict();
const privateResponse = (response: Response) => applyAppealIntakeHeaders(response);

async function receive(request: Request, owner: CorrectionIntakeRuntime): Promise<Response> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return privateResponse(invalidRequest(["request"]));
  }
  const body = correctionIntakeBody.safeParse(await readCorrectionIntakeJson(request, owner));
  if (!body.success) return privateResponse(invalidRequest(["request"]));
  owner.assertOpen();
  const authority = correctionIntakeMutation(request, body.data.nonce);
  if (!authority) return privateResponse(claimantNotFound());
  const admin = createAdminClient();
  const prepared = await owner.wait(owner.rpc("correction-prepare", () => admin.rpc("prepare_new_correction_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce, p_field: body.data.field,
  }).retry(false).abortSignal(owner.signal)));
  const frame = correctionPrepareFrame.safeParse(prepared.data);
  if (prepared.error || !frame.success || frame.data.scope.requestedField !== body.data.field) return privateResponse(claimantNotFound());
  owner.assertOpen();
  const sealed = sealNewCorrection(frame.data.scope, body.data.statement);
  const selected = await owner.wait(owner.rpc("correction-contact", () => admin.rpc("read_new_correction_intake_contact_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce, p_expected: frame.data,
  }).retry(false).abortSignal(owner.signal)));
  if (selected.error) return privateResponse(claimantNotFound());
  const contact = sealNewCorrectionContact(selected.data, frame.data, owner);
  owner.assertOpen();
  const committed = await owner.wait(owner.rpc("correction-commit", () => admin.rpc("commit_new_correction_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce, p_expected: frame.data,
    p_statement: `\\x${sealed.statementCiphertextHex}`, p_working: `\\x${sealed.workingCiphertextHex}`,
    p_wrapped_key: `\\x${sealed.wrappedCaseKeyHex}`, p_contact_cipher: contact.ciphertext, p_contact_hmac_set: contact.hmacSet,
  }).retry(false).abortSignal(owner.signal)));
  if (committed.error) return privateResponse(committed.error.code === "42501" || committed.error.code === "23505" ? claimantNotFound() : unavailable());
  const receipt = received.safeParse(committed.data);
  if (!receipt.success || receipt.data.correctionId !== frame.data.scope.caseId) return privateResponse(unavailable());
  owner.confirmNativeCommit();
  return privateResponse(await claimantResponse("api.future-person-correction", ["status", "correctionId"], receipt.data, 202));
}

/** Accountless claimant POST. TEST/default guards are independent of a valid
 * token or ciphertext. No cancellation ABI, expiry ACK or rollback is invented. */
export async function POST(request: Request): Promise<Response> {
  if (!requesterStatementsOpen()) return privateResponse(claimantNotFound());
  const owner = createCorrectionIntakeRuntime(request.signal);
  let response: Response;
  try { response = await receive(request, owner); }
  catch { response = privateResponse(unavailable()); }
  finally { await owner.finish(); }
  const settled = owner.disposition();
  // A prepared reservation without a confirmed commit is still a native
  // cleanup HOLD. A bounded caller refusal never grants a cleanup ACK.
  if (settled.cleanupHeld || settled.lateCommitUncertain || settled.pendingActualTasks !== 0
    || settled.ownedMutableBuffers !== 0 || (response.status === 202 && settled.nativePreparationHeld)) {
    return privateResponse(unavailable());
  }
  return response;
}
