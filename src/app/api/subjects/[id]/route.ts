import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { bodyIsEmpty, notFound, unavailable } from "@/lib/embryos/api";
import { closedResponse, originDenied, unauthenticated } from "@/lib/embryos/guards";
import { drainSubjectFileDeletions } from "@/lib/subject-endpoints/file-drain";
import { selfWithdrawalNotice } from "@/lib/uploads/own-upload-withdrawal";
import { verifySubjectOperationNonce } from "@/lib/subject-endpoints/operation-nonce";
import { isCanonicalSubjectId } from "@/lib/subject-endpoints/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAccountCsrf } from "@/lib/security/session-csrf";

/**
 * `DELETE /api/subjects/[id]` (register api.subject-delete; owner decisions
 * of 2026-10-16, "The subjects endpoints (G2.1)" and the answers to Q1, Q5
 * and Q6). One database door, `delete_subject_v1`, chooses the case from
 * server state after rechecking the caller's authority over the route
 * subject:
 *
 *   - self: the owning account empties its own self record. The record
 *     stays; every file, result, chat, permission and consent on it is
 *     revoked, and each file is prepared through the per-file deletion
 *     pipeline in the same transaction. This route then removes each file's
 *     bytes and finishes it, as `api.file-delete` does; anything it does not
 *     finish is left to the seven-day backstop (source.revocation-7d).
 *     Since the owner decision of 19 November 2026 ("Withdrawing consent for
 *     a person's own DNA file deletes the files and all made from them") this
 *     is the withdrawal of the account's consent to store its own DNA file,
 *     and the brief's confirmation email goes with it: a self record goes to
 *     `empty_self_subject_with_notice_v1`, which runs `delete_subject_v1`
 *     unchanged and queues the email in the same transaction, addressed to
 *     the signed-in account's own confirmed address. An account with no
 *     confirmed address, or whose address changed meanwhile, is refused with
 *     the same 404, and nothing is deleted.
 *   - adult: the owning account or the verified subject account deletes an
 *     other-adult record (revocation-and-purge-v1). Since the owner decision
 *     of 19 November 2026 ("An uploader's withdrawal for another adult's
 *     file deletes it, unless that adult holds the record themselves") the
 *     owning uploader's request is the withdrawal of its consent for that
 *     adult's file: it goes only to `withdraw_other_adult_upload_v1`, which
 *     runs `delete_subject_v1` unchanged and queues a short notice to the
 *     adult in the same transaction (unless their contact is barred). A
 *     record the adult holds with their own account is handed to them
 *     through the record transfer instead (owner decision of 22 November
 *     2026, "An uploader's withdrawal hands a record its adult holds to that
 *     adult"), only once the transfer is open; while it is closed the door
 *     refuses that record with the same 404, as before. Either way the door
 *     answers the adult case. The adult's own delete still goes to
 *     `delete_subject_v1`.
 *   - embryo: a current parent's authority is locked and rechecked first. A
 *     transferred, unclaimed record is purged alone; any other record
 *     restricts its whole cohort, as `api.cohort-restrict` does. A claimed
 *     record is not found while claimant binding is closed.
 *
 * The request has no body. The one-time code the confirmation page renders
 * for this route and this subject travels in `X-Inherit-Operation-Nonce`;
 * the database records its hash in the same transaction, so a replay
 * changes nothing. The register binds only lifecycle-accepted-v1 and
 * resource-not-found-v1 here, so every refusal, including a missing or spent
 * code, is the same opaque 404.
 */

export const maxDuration = 60;

const NONCE_HEADER = "x-inherit-operation-nonce";

const outcome = z.discriminatedUnion("case", [
  z.object({ case: z.literal("self"), files: z.array(z.uuid()).max(4096) }).strict(),
  z.object({ case: z.literal("adult") }).strict(),
  z.object({ case: z.literal("embryo-transferred-unclaimed"), sources: z.number().int().nonnegative() }).strict(),
  z.object({ case: z.literal("embryo-other") }).strict(),
]);

/** A refusal the caller can cause is the opaque 404; anything else is the server's fault. */
const REFUSALS = new Set(["42501", "55000", "22023", "23505", "P0002"]);

export const DELETE = withAccountCsrf("api.subject-delete", handleDelete);
async function handleDelete(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isCanonicalSubjectId(id)) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return unauthenticated();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  if (!bodyIsEmpty(request)) return notFound();

  const nonce = verifySubjectOperationNonce(request.headers.get(NONCE_HEADER), {
    accountId: account.user.id,
    sessionId: account.sessionId,
    operation: "subject_delete",
    subjectId: id,
  });
  if (!nonce) return notFound();

  const admin = createAdminClient();
  const args = {
    p_account_id: account.user.id,
    p_session_id: account.sessionId,
    p_subject_id: id,
    p_nonce_hash: nonce.nonceHash,
    p_nonce_expires_at: new Date(nonce.expiresAt).toISOString(),
  };
  // The class and the holders choose only the door: each door rechecks the
  // caller's authority over the record itself, under its own locks, so this
  // read grants nothing. A self record never reaches delete_subject_v1
  // directly from here, so its emptying always carries the confirmation
  // email; nor does the uploader's own record of another adult, so its
  // delete always carries the notice to that adult.
  const target = await admin.from("subjects").select("subject_class, owner_account_id, subject_account_id")
    .eq("id", id).maybeSingle();
  if (target.error) return unavailable();
  let answer;
  if (target.data?.subject_class === "self") {
    let notice;
    try {
      notice = await selfWithdrawalNotice(account.user.id);
    } catch {
      return unavailable();
    }
    if (!notice) return notFound();
    answer = await admin.rpc("empty_self_subject_with_notice_v1", { ...args, p_notice: notice });
  } else if (target.data?.subject_class === "other_adult" && target.data.owner_account_id === account.user.id
    && target.data.subject_account_id !== account.user.id) {
    // The uploader's withdrawal for another adult's file (owner decision of
    // 19 November 2026): the person's notice goes in the same transaction,
    // and a record the person holds with their own account is refused.
    answer = await admin.rpc("withdraw_other_adult_upload_v1", args);
  } else {
    answer = await admin.rpc("delete_subject_v1", args);
  }
  const { data, error } = answer;
  if (error) return REFUSALS.has(error.code ?? "") ? notFound() : unavailable();
  const result = outcome.safeParse(data);
  // The transaction has committed; an unreadable answer is still accepted
  // work, and any prepared file is finished by the backstop.
  if (result.success && result.data.case === "self") {
    await drainSubjectFileDeletions(admin, { accountId: account.user.id, sessionId: account.sessionId }, result.data.files, request.signal);
  }
  return closedResponse("api.subject-delete", ["status"], { status: "accepted" }, 202);
}
