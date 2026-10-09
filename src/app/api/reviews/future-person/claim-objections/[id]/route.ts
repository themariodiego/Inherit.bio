import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { mintAssignedObjectionNonce, readAssignedObjectionNonce, objectionDecisionBody,
  objectionDecisionScope, shapeObjectionReview } from "@/lib/future-person/objection-review";
import { isCanonicalId, REVIEW_CSRF_HEADER, REVIEW_NONCE_HEADER, reviewCsrf, reviewCsrfMatches, sealReason } from "@/lib/future-person/review";
import { mintReceiptOpenNonce } from "@/lib/future-person/review-receipt";
import { createClient } from "@/lib/supabase/server";

function noReferrer(response: Response) { response.headers.set("Referrer-Policy", "no-referrer"); return response; }
async function reviewer(request: Request, id: string) {
  if (!futurePersonClaimsOpen() || !isCanonicalId(id) || new URL(request.url).search) return null;
  return getSensitiveAccountContext();
}
/** Current own JWT, MFA and this exact operation assignment precede any
 * ciphertext opening. GET mints only stateless revision-bound proofs. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params, account = await reviewer(request, id);
  if (!account || request.body !== null) return noReferrer(notFound());
  const { data, error } = await (await createClient()).rpc("read_keyless_review_operation_v1", { p_id: id, p_operation: "claim-objection" });
  if (error) return noReferrer(error.code === "42501" ? notFound() : unavailable());
  const body = shapeObjectionReview(data, id); if (!body) return noReferrer(notFound());
  return noReferrer(sensitiveJson(body, 200, {
    [REVIEW_CSRF_HEADER]: reviewCsrf(id, account.user.id, account.sessionId),
    [REVIEW_NONCE_HEADER]: mintAssignedObjectionNonce(id, account.user.id, account.sessionId, body),
    "x-inherit-photo-receipt-nonce": mintReceiptOpenNonce(body.reviewPackage.photoIdentityDocumentId, account.user.id, account.sessionId),
    "x-inherit-birth-receipt-nonce": mintReceiptOpenNonce(body.reviewPackage.birthRecordDocumentId, account.user.id, account.sessionId),
  }));
}
/** Every current revision and both full byte receipts are rechecked by SQL;
 * a review overrule only queues a separate fresh human operation. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params, account = await reviewer(request, id), url = new URL(request.url);
  if (!account || request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    || !reviewCsrfMatches(request.headers.get(REVIEW_CSRF_HEADER), id, account.user.id, account.sessionId)) return noReferrer(notFound());
  const parsed = objectionDecisionBody.safeParse(await readBoundedJson(request, 16 * 1024));
  if (!parsed.success) return noReferrer(notFound());
  const nonce = readAssignedObjectionNonce(parsed.data.nonce, id, account.user.id, account.sessionId, parsed.data);
  if (!nonce) return noReferrer(notFound());
  const ownJwt = await createClient();
  const current = await ownJwt.rpc("read_keyless_review_operation_v1", { p_id: id, p_operation: "claim-objection" });
  if (current.error) return noReferrer(current.error.code === "42501" ? notFound() : unavailable());
  const scope = objectionDecisionScope(current.data, id);
  if (!scope || scope.objection?.objectionRevision !== parsed.data.objectionRevision
    || scope.reviewRevision !== parsed.data.claimReviewRevision || scope.noticeRevision !== parsed.data.noticeRevision) return noReferrer(notFound());
  const nonceHash = sha256Hex(nonce);
  const result = await ownJwt.rpc("decide_keyless_objection_v1", { p_objection: id,
    p_objection_revision: parsed.data.objectionRevision, p_review_revision: parsed.data.claimReviewRevision,
    p_notice_revision: parsed.data.noticeRevision, p_decision: parsed.data.decision, p_nonce_hash: nonceHash,
    p_reason_ciphertext: sealReason(parsed.data.reason, scope.wrappedComparisonKey, scope.claimId, nonceHash) });
  if (result.error) return noReferrer(["42501", "22023", "23505"].includes(result.error.code ?? "") ? notFound() : unavailable());
  const receipt = result.data as { objectionId?: unknown; state?: unknown; objectionRevision?: unknown } | null;
  const expected = { "uphold-objection": "claim_rejected", "overrule-objection": "release_recheck_required", "needs-more-information": "more_information_required" };
  if (!receipt || Object.keys(receipt).sort().join(",") !== "objectionId,objectionRevision,state"
    || receipt.objectionId !== id || receipt.objectionRevision !== parsed.data.objectionRevision + 1
    || receipt.state !== expected[parsed.data.decision]) return noReferrer(unavailable());
  return noReferrer(await closedResponse("api.future-person-claim-objection-review", ["objectionId", "state", "objectionRevision"], receipt, 200));
}
