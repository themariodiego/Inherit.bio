import {getSensitiveAccountContext} from "@/lib/account-deletion";
import {createClient} from "@/lib/supabase/server";
import {futurePersonClaimsOpen} from "@/lib/future-person/claims-open";
import {readBoundedJson} from "@/lib/future-person/bounded-body";
import {notFound,unavailable} from "@/lib/embryos/api";
import {closedResponse} from "@/lib/embryos/guards";
import {isCanonicalId,openClaimReviewIdentity,reviewCsrfMatches,REVIEW_CSRF_HEADER} from "@/lib/future-person/review";
import {keylessVerificationBody,keylessLookupNonceMatches,keylessVerificationIndexes,shapeKeylessVerification} from "@/lib/future-person/keyless-verification";
import {sealKeylessVerificationProof} from "@/lib/future-person/keyless-verification-proof";

/** The assigned human's read-only documentary lookup. A positive projection
 * creates no approval, notice, claimant, release or retained identity field. */
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;
  const response=await verify(request,id);response.headers.set("Referrer-Policy","no-referrer");return response;
}
async function verify(request:Request,id:string):Promise<Response> {
  const url=new URL(request.url);
  if(!futurePersonClaimsOpen()||!isCanonicalId(id)||url.search!==""
    ||request.headers.get("origin")!==url.origin||request.headers.get("sec-fetch-site")!=="same-origin"
    ||request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")return notFound();
  const account=await getSensitiveAccountContext();
  if(!account||!reviewCsrfMatches(request.headers.get(REVIEW_CSRF_HEADER),id,account.user.id,account.sessionId))return notFound();
  const body=keylessVerificationBody.safeParse(await readBoundedJson(request,16*1024));
  if(!body.success||!keylessLookupNonceMatches(body.data.nonce,id,account.user.id,account.sessionId))return notFound();
  const supabase=await createClient();
  const original=await supabase.rpc("read_claim_review_case_v1",{p_review_id:id});
  if(original.error)return original.error.code==="42501"?notFound():unavailable();
  const row=original.data as {mode?:unknown;reviewRevision?:unknown;identityCiphertext?:unknown;wrappedDataKey?:unknown}|null;
  if(row?.mode!=="keyless"||row.reviewRevision!==body.data.reviewRevision
    ||typeof row.identityCiphertext!=="string"||typeof row.wrappedDataKey!=="string")return notFound();
  const identity=openClaimReviewIdentity(row.identityCiphertext,row.wrappedDataKey);
  const indexes=identity?keylessVerificationIndexes(identity,body.data.documentaryAttestation):null;
  if(!indexes)return notFound();
  const current=await supabase.rpc("verify_keyless_claim_documents_v1",{p_review_id:id,
    p_review_revision:body.data.reviewRevision,p_verified_date_of_birth:body.data.documentaryAttestation.dateOfBirth,
    p_identity_hmac_set:indexes.identity,p_profile_hmac_set:indexes.profile});
  if(current.error)return ["42501","23505","22023"].includes(current.error.code??"")?notFound():unavailable();
  const shaped=shapeKeylessVerification(current.data,{reviewId:id,accountId:account.user.id,
    sessionId:account.sessionId,reviewRevision:body.data.reviewRevision},body.data.documentaryAttestation);
  if(!shaped)return unavailable();
  const kind=String((shaped.reviewCase.case as Record<string,unknown>).kind);
  return closedResponse("api.future-person-documentary-verification",["reviewCase","verificationProof"],{
    reviewCase:shaped.reviewCase,verificationProof:["unclaimed_keyless","claimed_unbound_no_key_recovery"].includes(kind)
      ?sealKeylessVerificationProof(shaped.scope):null,
  },200);
}
