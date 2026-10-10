import crypto from "node:crypto";
import {reviewRefusal} from "@/lib/future-person/review-diagnostics";
import { contactDigestSet } from "@/lib/hmac-keyring";
import { sealClaimantContact } from "@/lib/future-person/claimant-contact";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import {
  REVIEW_CSRF_HEADER,
  REVIEW_NONCE_HEADER,
  isCanonicalId,
  mintReviewNonce,
  readReviewNonce,
  reviewCaseBody,
  reviewCsrf,
  reviewCsrfMatches,
  reviewDecisionBody,
  sealReason,
  sealDocumentaryAttestation,
  verifiedIdentityDigestSet,
  openClaimReviewIdentity,
} from "@/lib/future-person/review";
import { mintReceiptOpenNonce } from "@/lib/future-person/review-receipt";
import {mintKeylessLookupNonce,keylessVerificationIndexes,shapeKeylessVerification} from "@/lib/future-person/keyless-verification";
import {keylessCurrentReview,mintKeylessReleaseNonce} from "@/lib/future-person/keyless-release";
import {sealNoticePackage} from "@/lib/future-person/notice-package";
import {keylessVerificationProofMatches} from "@/lib/future-person/keyless-verification-proof";
import { createClient } from "@/lib/supabase/server";

/**
 * `/api/reviews/future-person/claims/[id]` (register
 * api.future-person-claim-review), for the named human who reviews one
 * Future Person claim.
 *
 * Every call runs under the reviewer's own JWT. The database decides:
 * an active claim reviewer, assigned this case, in a live session stepped
 * up with MFA in the last 15 minutes (reviewer-api-v1). Anything short of
 * that, and anything unknown, stale or inapplicable, is the one opaque 404;
 * there are no redirects.
 *
 * GET returns future-person-claim-review-case-v1 and records the read. It
 * also returns, in headers only, the CSRF value and a ten-minute one-time
 * decision nonce for this reviewer, session and case.
 *
 * POST takes one of the six closed decision bodies. The database allows
 * only the decisions the resolved case kind allows, records the decision
 * against the two documents' SHA-256 digests (after the reviewer has read
 * every chunk of both), and answers future-person-claim-review-v1. An
 * approval is recorded and queued for the release step, which is separate.
 */

const DECISION_KEYS = ["claimId", "state", "reviewRevision"] as const;

function withoutReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function reviewer(request: Request, id: string) {
  if (!futurePersonClaimsOpen() || !isCanonicalId(id) || new URL(request.url).search !== "") return null;
  return getSensitiveAccountContext();
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withoutReferrer(await read(request, id));
}

async function read(request: Request, id: string): Promise<Response> {
  const account = await reviewer(request, id);
  if (!account) return notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("read_claim_review_case_v1", { p_review_id: id });
  if (error) {
    if(error.code!=="42501")return unavailable();
    const current=await supabase.rpc("read_keyless_current_review_v1",{p_review:id});
    if(current.error)return current.error.code==="42501"?notFound():unavailable();
    const review=keylessCurrentReview(current.data,id);
    if(!review||Date.parse(review.scope.deadline)<=Date.now()
      ||(review.scope.operation!=="claim-release"&&!review.scope.current))return notFound();
    const release=review.scope.operation==="claim-release"&&review.scope.noticeDeadline!==null
      &&Date.parse(review.scope.noticeDeadline)<=Date.now();
    const documentsAvailable=review.scope.operation==="claim-objection"||(release&&review.scope.current&&review.scope.objectionId===null);
    const decisionAvailable=review.scope.operation==="claim-objection"||release;
    return sensitiveJson(review.caseBody,200,{
      [REVIEW_CSRF_HEADER]:reviewCsrf(id,account.user.id,account.sessionId),
      [REVIEW_NONCE_HEADER]:release?mintKeylessReleaseNonce(review.scope,account.user.id,account.sessionId):mintReviewNonce(id,account.user.id,account.sessionId),
      "x-inherit-review-operation":review.scope.operation,
      "x-inherit-review-documents":documentsAvailable?"available":"held",
      "x-inherit-review-decision":decisionAvailable?"available":"held",
      ...(review.scope.objectionId!==null?{"x-inherit-objection-review-id":review.scope.objectionId}:{}),
      ...(documentsAvailable?{
        "x-inherit-photo-receipt-nonce":mintReceiptOpenNonce(review.scope.photoDocumentId,account.user.id,account.sessionId),
        "x-inherit-birth-receipt-nonce":mintReceiptOpenNonce(review.scope.birthDocumentId,account.user.id,account.sessionId),
      }:{}),
    });
  }
  const body = reviewCaseBody(data);
  if (!body) return notFound();
  return sensitiveJson(body, 200, {
    [REVIEW_CSRF_HEADER]: reviewCsrf(id, account.user.id, account.sessionId),
    [REVIEW_NONCE_HEADER]: mintReviewNonce(id, account.user.id, account.sessionId),
    "x-inherit-review-documents": "available",
    "x-inherit-review-decision": "available",
    "x-inherit-photo-receipt-nonce": mintReceiptOpenNonce(String((body.evidence as Record<string, unknown>).photoIdentityDocumentId), account.user.id, account.sessionId),
    "x-inherit-birth-receipt-nonce": mintReceiptOpenNonce(String((body.evidence as Record<string, unknown>).birthRecordDocumentId), account.user.id, account.sessionId),
    ...(body.mode==="keyless"?{"x-inherit-keyless-lookup-nonce":mintKeylessLookupNonce(id,account.user.id,account.sessionId)}:{}),
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withoutReferrer(await decide(request, id));
}

async function decide(request: Request, id: string): Promise<Response> {
  const refused=(stage:Parameters<typeof reviewRefusal>[0],error?:unknown,response:Response=notFound())=>{reviewRefusal(stage,error);return response;};
  const account = await reviewer(request, id);
  const url = new URL(request.url);
  if (
    !account ||
    request.headers.get("origin") !== url.origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase() !== "application/json" ||
    !reviewCsrfMatches(request.headers.get(REVIEW_CSRF_HEADER), id, account.user.id, account.sessionId)
  ) {
    return refused("request");
  }
  const parsed = reviewDecisionBody.safeParse(await readBoundedJson(request, 16 * 1024));
  if (!parsed.success) return refused("body");
  const nonce = readReviewNonce(parsed.data.nonce, id, account.user.id, account.sessionId);
  if (!nonce) return refused("nonce");
  const supabase=await createClient();
  const caseResult=await supabase.rpc("read_claim_review_case_v1",{p_review_id:id});
  if(caseResult.error)return refused("case-rpc",caseResult.error,caseResult.error.code==="42501"?notFound():unavailable());
  const row=caseResult.data as {identityCiphertext?:unknown;wrappedDataKey?:unknown}|null;
  if(typeof row?.wrappedDataKey!=="string"||typeof row.identityCiphertext!=="string")return refused("case-key");
  const identity=openClaimReviewIdentity(row.identityCiphertext,row.wrappedDataKey);
  if(!identity)return refused("identity");
  const attestation="documentaryAttestation" in parsed.data?parsed.data.documentaryAttestation:null;
  const digests=attestation?verifiedIdentityDigestSet(attestation):null;
  const contactId=crypto.randomUUID();const nonceHash=sha256Hex(nonce);
  const common={
    p_review_id:id,p_review_revision:parsed.data.reviewRevision,p_decision:parsed.data.decision,p_nonce_hash:nonceHash,
    p_reason_ciphertext:sealReason(parsed.data.reason,row.wrappedDataKey,id,nonceHash),
    p_attestation_ciphertext:attestation?sealDocumentaryAttestation(attestation,row.wrappedDataKey,id,nonceHash):null,
    p_identity_hmac_set:digests,p_verified_date_of_birth:attestation?.dateOfBirth??null,
    p_contact_reference_id:contactId,p_contact_ciphertext:sealClaimantContact(contactId,identity.contactEmail),
    p_contact_hmac_set:contactDigestSet(identity.contactEmail),
  };
  let result;
  if(parsed.data.decision==="keyless-document-match") {
    // The linked attestation has one additional required fact. Project the
    // exact five documentary fields for its independently strict schemas;
    // preserve the separately required true parent link in the transaction.
    const given=parsed.data.documentaryAttestation;
    const human={fullName:given.fullName,dateOfBirth:given.dateOfBirth,photoIdentityReviewed:given.photoIdentityReviewed,
      birthRecordReviewed:given.birthRecordReviewed,adultAgeConfirmed:given.adultAgeConfirmed};
    const indexes=keylessVerificationIndexes(identity,human);
    if(!indexes)return refused("indexes");
    const fresh=await supabase.rpc("verify_keyless_claim_documents_v1",{
      p_review_id:id,p_review_revision:parsed.data.reviewRevision,p_verified_date_of_birth:human.dateOfBirth,
      p_identity_hmac_set:indexes.identity,p_profile_hmac_set:indexes.profile,
    });
    if(fresh.error)return refused("verify-rpc",fresh.error,["42501","22023","23505"].includes(fresh.error.code??"")?notFound():unavailable());
    const shaped=shapeKeylessVerification(fresh.data,{reviewId:id,accountId:account.user.id,
      sessionId:account.sessionId,reviewRevision:parsed.data.reviewRevision},human);
    if(!shaped||shaped.reviewCase.case===null||typeof shaped.reviewCase.case!=="object"
      ||!keylessVerificationProofMatches(parsed.data.verificationProof,shaped.scope))return refused("verify-proof");
    const branch=shaped.reviewCase.case as Record<string,unknown>;
    if(branch.kind!=="unclaimed_keyless")return refused("branch");
    const minimum=sealNoticePackage(human,branch.selectedProfile as {
      childDateOfBirth:string;childPlaceOfBirth:string;parentNames:string[];
    },{reviewId:id,documentaryRevision:shaped.scope.reviewRevision,
      photoDocumentId:shaped.scope.photoIdentity.id,photoSha256:shaped.scope.photoIdentity.sha256,
      birthDocumentId:shaped.scope.birthRecord.id,birthSha256:shaped.scope.birthRecord.sha256});
    result=await supabase.rpc("prepare_keyless_owner_notice_v1",{
      p_review:id,p_revision:parsed.data.reviewRevision,p_nonce_hash:nonceHash,p_reason:common.p_reason_ciphertext,
      p_attestation:common.p_attestation_ciphertext,p_verified_birth:human.dateOfBirth,
      p_parent_link_confirmed:given.recordedParentLinkConfirmed,p_identity_set:indexes.identity,p_profile_set:indexes.profile,
      p_comparison_receipt:shaped.scope.comparisonReceiptDigest,p_minimum_ciphertext:minimum.ciphertext,
      p_minimum_wrapped_key:minimum.wrappedKey,p_contact_id:contactId,p_contact_ciphertext:common.p_contact_ciphertext,
      p_contact_set:common.p_contact_hmac_set,
    });
  }else if(parsed.data.decision==="approve-claimed-unbound-no-key-recovery") {
    const indexes=keylessVerificationIndexes(identity,parsed.data.documentaryAttestation);
    if(!indexes)return refused("indexes");
    const fresh=await supabase.rpc("verify_keyless_claim_documents_v1",{
      p_review_id:id,p_review_revision:parsed.data.reviewRevision,p_verified_date_of_birth:parsed.data.documentaryAttestation.dateOfBirth,
      p_identity_hmac_set:indexes.identity,p_profile_hmac_set:indexes.profile,
    });
    if(fresh.error)return refused("verify-rpc",fresh.error,["42501","22023","23505"].includes(fresh.error.code??"")?notFound():unavailable());
    const shaped=shapeKeylessVerification(fresh.data,{reviewId:id,accountId:account.user.id,
      sessionId:account.sessionId,reviewRevision:parsed.data.reviewRevision},parsed.data.documentaryAttestation);
    if(!shaped||((shaped.reviewCase.case as Record<string,unknown>).kind!=="claimed_unbound_no_key_recovery")
      ||!keylessVerificationProofMatches(parsed.data.verificationProof,shaped.scope))return refused("verify-proof");
    result=await supabase.rpc("restore_future_person_claim_review_v1",{...common,
      p_profile_hmac_set:indexes.profile,p_comparison_receipt_digest:shaped.scope.comparisonReceiptDigest});
  }else if(parsed.data.decision==="approve-recovery-key") {
    result=await supabase.rpc("restore_future_person_claim_review_v1",{...common,
      p_profile_hmac_set:null,p_comparison_receipt_digest:null});
  }else {
    result=await supabase.rpc("decide_claim_review_attested_v1",{...common,
      p_parent_link_confirmed:attestation!==null&&"recordedParentLinkConfirmed" in attestation});
  }
  const {data,error}=result;
  if (error) return refused("decision-rpc",error,["42501", "23505", "22023"].includes(error.code ?? "") ? notFound() : unavailable());
  const outcome = data as { claimId?: unknown; state?: unknown; reviewRevision?: unknown } | null;
  if (
    !outcome || outcome.claimId !== id || typeof outcome.reviewRevision !== "number" ||
    outcome.reviewRevision!==parsed.data.reviewRevision+1 ||
    Object.keys(outcome).sort().join("|")!=="claimId|reviewRevision|state" ||
    !(parsed.data.decision==="keyless-document-match" ? outcome.state==="approved_pending_owner_notice" :
      ["release_queued", "more_information_required", "refused"].includes(String(outcome.state)))
  ) {
    return refused("outcome",undefined,unavailable());
  }
  return closedResponse("api.future-person-claim-review", DECISION_KEYS, {
    claimId: id, state: String(outcome.state), reviewRevision: outcome.reviewRevision,
  }, 200);
}
