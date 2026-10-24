import {
  adultSubjectAnswerBody,
  adultSubjectConfirmEnvelope,
  readAdultSubjectOffer,
  readAdultSubjectResponse,
} from "@/lib/embryos/adult-subject-review";
import { embryoParentWithdrawalBody, readEmbryoParentWithdrawal, respondEmbryoParentWithdrawal } from "@/lib/embryos/embryo-parent-withdrawal";
import { invalidRequest, notFound } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { invitationRefusalBody, readInvitationRefusal, refusalRequestAllowed } from "@/lib/embryos/invitation-refusal";
import { createAdminClient } from "@/lib/supabase/admin";
import { adultUploadRevisionBody, pathBAccountConfirmBody, pathBSubjectConfirmBody } from "@/lib/uploads/other-adult-upload";
import {
  answerAdultUploadRevision,
  confirmPathBSubject,
  confirmPathBSubjectWithAccount,
} from "@/lib/uploads/path-b-respond";
import { readAdultUploadRevisionResponse } from "@/lib/uploads/path-b-review";
import { withPurposeCsrf, readRightsCsrfSession } from "@/lib/security/session-csrf";

/**
 * `POST /api/withdraw/[token]` with the segment pinned to `session`
 * (register api.withdraw). Adult-subject, co-parent, embryo-parent and
 * held-file answers each require their own purpose-bound form token.
 * The body cannot select authority for another form or rights holder.
 * The database rechecks the current credential and purpose matrix.
 *
 * The registered receipt is `{status, operation}` and nothing else. An
 * invitation that has expired, been answered or was never this session's is
 * the same 404 as one that does not exist.
 *
 * Path A is not confirmed here any more (owner decision of 23 October 2026,
 * "D-103: Path A acceptance includes a typed name"): the register puts its
 * account confirmation on api.invitation-accept
 * (adult-subject-confirmation-v1.modes.path-a-account-required), and
 * api.withdraw confirms only a Path B request or one held file. A confirm
 * sent here on a Path A session whose form nonce is this session's is
 * invalid-request-v1, the register's answer for a body the stored kind does
 * not take (requestContract.confirmBodySelection), read without an account
 * and with no database write; one that cannot be tied to the session is the
 * opaque 404.
 */

const RECEIPT_KEYS = ["status", "operation"] as const;

/** At most 4 KiB of well-formed UTF-8 JSON, or null. */
async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  let size = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4_096) { await reader.cancel(); return null; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch { return null; }
  try { return JSON.parse(text); } catch { return null; }
}

export const POST = withPurposeCsrf("api.withdraw", readRightsCsrfSession, handlePost);
async function handlePost(request: Request) {
  if (!refusalRequestAllowed(request)) return notFound();
  const json = await readBoundedJson(request);
  if (json === null) return notFound();

  // The register's Path B (TEST-LOCAL only): the person's own signature of a
  // request, with or without their account, and their answer to one held
  // file. The adult-subject form token decides the first; the upload-revision
  // form token the second.
  const pathBAccount = pathBAccountConfirmBody.safeParse(json);
  if (pathBAccount.success) {
    const authority = readAdultSubjectResponse(request, pathBAccount.data.nonce);
    return authority ? confirmPathBSubjectWithAccount(authority, pathBAccount.data) : notFound();
  }
  const pathB = pathBSubjectConfirmBody.safeParse(json);
  if (pathB.success) {
    const authority = readAdultSubjectResponse(request, pathB.data.nonce);
    return authority ? confirmPathBSubject(authority, pathB.data) : notFound();
  }
  const revision = adultUploadRevisionBody.safeParse(json);
  if (revision.success) {
    const authority = readAdultUploadRevisionResponse(request, revision.data.nonce);
    if (authority) return answerAdultUploadRevision(authority, revision.data.operation);
  }

  const adult = adultSubjectAnswerBody.safeParse(json);
  if (adult.success) {
    const authority = readAdultSubjectResponse(request, adult.data.nonce);
    if (authority) return answerAdultSubject(authority, adult.data.operation);
  }
  const adultConfirm = adultSubjectConfirmEnvelope.safeParse(json);
  if (adultConfirm.success) {
    const authority = readAdultSubjectResponse(request, adultConfirm.data.nonce);
    if (authority) return refusePathAConfirm(request, authority);
  }

  const embryo = embryoParentWithdrawalBody.safeParse(json);
  if (embryo.success) {
    const authority = readEmbryoParentWithdrawal(request, embryo.data.nonce);
    if (authority) {
      if (!(await respondEmbryoParentWithdrawal(authority, embryo.data.operation))) return notFound();
      return closedResponse("api.withdraw", RECEIPT_KEYS,
        { status: "accepted", operation: embryo.data.operation }, 202);
    }
  }

  const body = invitationRefusalBody.safeParse(json);
  if (!body.success) return notFound();
  const authority = readInvitationRefusal(request, body.data.nonce);
  if (!authority) return notFound();
  const { error } = await createAdminClient().rpc("refuse_co_parent_invitation_session_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce,
  });
  if (error) return notFound();
  return closedResponse("api.withdraw", RECEIPT_KEYS,
    { status: "accepted", operation: "refuse" }, 202);
}

/**
 * A Path A confirm sent to api.withdraw. The register gives a Path A
 * invitation's rights session no confirm here: its account confirmation is
 * api.invitation-accept's, and this route's only adult confirms are Path B's.
 * Once the form nonce and the offer show this session's own pending Path A
 * invitation, the body is one the stored kind does not take, and the answer
 * is invalid-request-v1 naming the operation; nothing about an account is
 * read and nothing is written. A session that offers no such invitation is
 * the opaque 404.
 */
async function refusePathAConfirm(request: Request, authority: { sessionHash: string; nonce: string }) {
  const offer = await readAdultSubjectOffer(request);
  if (!offer || offer.sessionHash !== authority.sessionHash) return notFound();
  return invalidRequest(["operation"]);
}

/**
 * Refusing and deleting need no account. The database consumes the form
 * nonce and answers for the session's own invitation.
 */
async function answerAdultSubject(
  authority: { sessionHash: string; nonce: string },
  operation: "refuse" | "delete",
) {
  const { data, error } = await createAdminClient().rpc(
    "respond_adult_subject_invitation_session_v1",
    { p_session_hash: authority.sessionHash, p_action: operation, p_nonce: authority.nonce },
  );
  const expected = operation === "refuse" ? "refused" : "deleted";
  if (error || data !== expected) return notFound();
  return closedResponse("api.withdraw", RECEIPT_KEYS,
    { status: "accepted", operation }, 202);
}
