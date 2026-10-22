import "server-only";

import crypto from "node:crypto";
import {z} from "zod";
import {hmacSecret} from "@/lib/crypto";
import {mintPublicFormToken,readPublicFormToken} from "@/lib/embryos/operation-token";
import {identityProfileDigestSet,openIdentityProfile} from "./identity-profile";
import {openClaimReviewIdentity,reviewCaseBody,verifiedDocumentIdentity,verifiedIdentityDigestSet} from "./review";
import type {KeylessVerificationScope} from "./keyless-verification-proof";

const hash=z.string().regex(/^[0-9a-f]{64}$/u);
const revision=z.number().int().positive().safe();
const doc=z.object({id:z.uuid(),sha256:hash}).strict();
const profile=z.object({profileId:z.uuid(),embryoId:z.uuid(),identityRevision:revision,
  ciphertext:z.string().regex(/^[0-9a-f]+$/u).min(58).max(32768),
  wrappedKey:z.string().regex(/^[0-9a-f]{144}$/u),}).strict();
const receipt=z.object({
  case:z.unknown(),scope:z.object({reviewId:z.uuid(),reviewerAccountId:z.uuid(),authSessionId:z.uuid(),
    reviewRevision:revision,assignmentRevision:revision,accountAuthRevision:revision,originatingSessionRevision:revision,
    photoIdentity:doc,birthRecord:doc,comparisonReceiptDigest:hash}).strict(),profile:profile.nullable(),
}).strict();
export const keylessVerificationBody=z.object({reviewRevision:revision,
  documentaryAttestation:verifiedDocumentIdentity,nonce:z.string().min(1).max(2048),}).strict();
const candidateDetails=z.object({childPlaceOfBirth:z.string().min(2).max(640),
  parentNames:z.array(z.string().min(2).max(480)).min(1).max(4),}).strict();

/** Registered read-only lookup proof, distinct from the consumed decision
 * nonce. Its stateless case response issuance never creates database state. */
export function mintKeylessLookupNonce(reviewId:string,accountId:string,sessionId:string,now=Date.now()):string {
  return mintPublicFormToken("claim-review-keyless-verification",now,
    hmacSecret(JSON.stringify([reviewId,accountId,sessionId]),"claim-review-keyless-lookup-binding-v1"));
}
export function keylessLookupNonceMatches(token:string,reviewId:string,accountId:string,sessionId:string,now=Date.now()):boolean {
  return token.length<=2048&&readPublicFormToken(token,"claim-review-keyless-verification",now,
    hmacSecret(JSON.stringify([reviewId,accountId,sessionId]),"claim-review-keyless-lookup-binding-v1"))!==null;
}

/** Unverified place/names only narrow a parent-profile search after the
 * documentary name/DOB has found zero prior claimant identities. Neither
 * these intake fields nor a stored profile establishes majority or identity. */
export function keylessVerificationIndexes(intake:unknown,attestation:z.infer<typeof verifiedDocumentIdentity>) {
  const given=verifiedDocumentIdentity.safeParse(attestation);
  if(!given.success||!intake||typeof intake!=="object")return null;
  const fields=intake as Record<string,unknown>;
  const details=candidateDetails.safeParse({childPlaceOfBirth:fields.childPlaceOfBirth,parentNames:fields.parentNames});
  if(!details.success)return null;
  try{
    return {identity:verifiedIdentityDigestSet(given.data),profile:identityProfileDigestSet({
      childDateOfBirth:given.data.dateOfBirth,...details.data}),};
  }catch{return null;}
}

/** A closed private SQL receipt becomes only the registered named-reviewer
 * case. No subject/profile/claimant selector, ciphertext, count, contact or
 * authority snapshot reaches the response. A positive case remains a lookup,
 * with all release gates independently closed. */
export function shapeKeylessVerification(
  raw:unknown,expected:{reviewId:string;accountId:string;sessionId:string;reviewRevision:number},
  attestation:z.infer<typeof verifiedDocumentIdentity>,
) :{reviewCase:Record<string,unknown>;scope:KeylessVerificationScope}|null {
  const parsed=receipt.safeParse(raw),human=verifiedDocumentIdentity.safeParse(attestation);
  if(!parsed.success||!human.success)return null;
  const value=parsed.data;
  if(value.scope.reviewId!==expected.reviewId||value.scope.reviewerAccountId!==expected.accountId
    ||value.scope.authSessionId!==expected.sessionId||value.scope.reviewRevision!==expected.reviewRevision)return null;
  if(!value.case||typeof value.case!=="object")return null;
  const row=value.case as Record<string,unknown>,kind=row.caseKind;
  if(row.claimId!==expected.reviewId||row.reviewRevision!==expected.reviewRevision||row.mode!=="keyless"
    ||row.photoIdentityDocumentId!==value.scope.photoIdentity.id||row.birthRecordDocumentId!==value.scope.birthRecord.id
    ||!['claimed_unbound_no_key_recovery','unclaimed_keyless','keyless_none','keyless_ambiguous'].includes(String(kind)))return null;
  const allowed=kind==="claimed_unbound_no_key_recovery"?["approve-claimed-unbound-no-key-recovery","reject","needs-more-information"]
    :kind==="unclaimed_keyless"?["keyless-document-match","reject","needs-more-information"]:["reject","needs-more-information"];
  if(JSON.stringify(row.allowedDecisions)!==JSON.stringify(allowed))return null;
  const base=reviewCaseBody({...row,caseKind:"keyless_none",allowedDecisions:["reject","needs-more-information"]});
  if(!base)return null;
  let reviewCase:Record<string,unknown>=base;
  if(kind==="claimed_unbound_no_key_recovery"){
    if(value.profile!==null)return null;
    reviewCase={...base,case:{kind,claimantBinding:{candidateClass:"exactly_one",lifecycle:"claimed_unbound",
      identityHmacComparison:"pending_human_verified_document_tuple"}}};
  }else if(kind==="unclaimed_keyless"){
    if(!value.profile)return null;
    const selected=openIdentityProfile(Buffer.from(value.profile.ciphertext,"hex"),value.profile.wrappedKey,
      {profileId:value.profile.profileId,embryoId:value.profile.embryoId,identityRevision:value.profile.identityRevision});
    if(!selected||selected.childDateOfBirth!==human.data.dateOfBirth||typeof row.identityCiphertext!=="string"
      ||typeof row.wrappedDataKey!=="string")return null;
    const identity=openClaimReviewIdentity(row.identityCiphertext,row.wrappedDataKey);
    const signals=identity?keylessVerificationIndexes(identity,human.data):null;
    if(!signals)return null;
    const actual=identityProfileDigestSet({childDateOfBirth:selected.childDateOfBirth,
      childPlaceOfBirth:selected.childPlaceOfBirth,parentNames:selected.parentNames});
    if(Object.keys(signals.profile).length!==Object.keys(actual).length||Object.entries(actual).some(([rev,digest])=>
      signals.profile[rev]!==digest||!crypto.timingSafeEqual(Buffer.from(digest,"hex"),Buffer.from(signals.profile[rev]! ,"hex"))))return null;
    reviewCase={...base,case:{kind,candidateClass:"exactly_one",selectedProfile:{
      childDateOfBirth:selected.childDateOfBirth,childPlaceOfBirth:selected.childPlaceOfBirth,parentNames:selected.parentNames}}};
  }else{
    if(value.profile!==null)return null;
    reviewCase={...base,case:{kind,selectorOutcome:"no_unique_candidate",allowedDecisions:["reject","needs-more-information"]}};
  }
  // This purpose-separated hash describes only the human-verified tuple. The
  // profile receipt and assignment/document revisions remain separate bindings.
  return {reviewCase,scope:{...value.scope,verifiedTupleDigest:hmacSecret(JSON.stringify([
    human.data.fullName.toLowerCase(),human.data.dateOfBirth]),"future-person-keyless-verified-tuple-v1")}};
}
