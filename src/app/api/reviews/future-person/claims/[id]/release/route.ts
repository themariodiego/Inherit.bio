import crypto from "node:crypto";
import {getSensitiveAccountContext} from "@/lib/account-deletion";
import {contactDigestSet} from "@/lib/hmac-keyring";
import {notFound,unavailable} from "@/lib/embryos/api";
import {closedResponse} from "@/lib/embryos/guards";
import {futurePersonClaimsOpen} from "@/lib/future-person/claims-open";
import {readBoundedJson} from "@/lib/future-person/bounded-body";
import {keylessCurrentReview,keylessDeliveryAddress,keylessReleaseDecisionBody,readKeylessReleaseNonce} from "@/lib/future-person/keyless-release";
import {isCanonicalId,reviewCsrfMatches,REVIEW_CSRF_HEADER,sealDocumentaryAttestation,sealReason,verifiedIdentityDigestSet} from "@/lib/future-person/review";
import {sha256Hex} from "@/lib/future-person/claim-session";
import {sealClaimantContact} from "@/lib/future-person/claimant-contact";
import {createClient} from "@/lib/supabase/server";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params,response=await decide(request,id);
  response.headers.set("Referrer-Policy","no-referrer");return response;
}
/** A separate fresh named-human operation. The closed native body accepts
 * neither caller identity/selectors nor clocks; SQL rechecks every effect. */
async function decide(request:Request,id:string):Promise<Response> {
  const url=new URL(request.url);
  if(!futurePersonClaimsOpen()||!isCanonicalId(id)||url.search!==""||request.headers.get("origin")!==url.origin
    ||request.headers.get("sec-fetch-site")!=="same-origin"
    ||request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")return notFound();
  const account=await getSensitiveAccountContext();
  if(!account||!reviewCsrfMatches(request.headers.get(REVIEW_CSRF_HEADER),id,account.user.id,account.sessionId))return notFound();
  const body=keylessReleaseDecisionBody.safeParse(await readBoundedJson(request,16*1024));if(!body.success)return notFound();
  const ownJwt=await createClient();
  const current=await ownJwt.rpc("read_keyless_current_review_v1",{p_review:id});
  if(current.error)return current.error.code==="42501"?notFound():unavailable();
  const review=keylessCurrentReview(current.data,id);
  if(!review||review.scope.operation!=="claim-release"||review.scope.reviewRevision!==body.data.reviewRevision
    ||review.scope.noticeRevision!==body.data.noticeRevision)return notFound();
  const nonce=readKeylessReleaseNonce(body.data.nonce,review.scope,account.user.id,account.sessionId);if(!nonce)return notFound();
  const nonceHash=sha256Hex(nonce),approval=body.data.decision==="approve-release";
  const address=approval?keylessDeliveryAddress(review.scope):null;
  if(approval&&(!review.profileMatches||!review.scope.current||!address||review.scope.noticeDeadline===null
    ||Date.parse(review.scope.noticeDeadline)>Date.now()||Date.parse(review.scope.deadline)<=Date.now()||review.scope.objectionId!==null))return notFound();
  if(body.data.decision==="refuse-release"&&body.data.refusalCode==="identity_profile_conflict"
    &&(review.profileMatches||review.scope.profile===null))return notFound();
  const contactId=approval?crypto.randomUUID():null;
  const finalAttestation={...review.documentaryIdentity,recordedParentLinkConfirmed:true as const};
  const result=await ownJwt.rpc("decide_keyless_release_v1",{
    p_review:id,p_review_revision:body.data.reviewRevision,p_notice_revision:body.data.noticeRevision,p_decision:body.data.decision,
    p_refusal_code:body.data.decision==="refuse-release"?body.data.refusalCode:null,p_nonce_hash:nonceHash,
    p_reason:sealReason(body.data.reason,review.scope.wrappedComparisonKey,id,nonceHash),
    p_attestation:approval?sealDocumentaryAttestation(finalAttestation,review.scope.wrappedComparisonKey,id,nonceHash):null,
    p_verified_birth:approval?review.documentaryIdentity.dateOfBirth:null,p_identity_set:approval?verifiedIdentityDigestSet(review.documentaryIdentity):null,
    p_profile_set:approval||(body.data.decision==="refuse-release"&&body.data.refusalCode==="identity_profile_conflict")?review.profileIndexes:null,
    p_contact:contactId,p_contact_ciphertext:approval?sealClaimantContact(contactId!,address!):null,p_contact_set:approval?contactDigestSet(address!):null,
  });
  if(result.error)return ["42501","22023","23505"].includes(result.error.code??"")?notFound():unavailable();
  const receipt=result.data as {claimId?:unknown;state?:unknown;reviewRevision?:unknown}|null;
  if(!receipt||Object.keys(receipt).sort().join("|")!=="claimId|reviewRevision|state"||receipt.claimId!==id
    ||receipt.reviewRevision!==body.data.reviewRevision+1||receipt.state!==(approval?"release_queued":"refused"))return unavailable();
  return closedResponse("api.future-person-claim-release",["claimId","state","reviewRevision"],receipt,200);
}
