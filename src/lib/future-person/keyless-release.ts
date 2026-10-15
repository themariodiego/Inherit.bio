import "server-only";
import crypto from "node:crypto";
import {z} from "zod";
import {decryptSecret} from "@/lib/crypto";
import {mintPublicFormToken,readPublicFormToken} from "@/lib/embryos/operation-token";
import {identityProfileDigestSet,openIdentityProfile} from "./identity-profile";
import {openNoticePackage} from "./notice-package";
import {openMailContact} from "./claimant-contact";
import {sha256Hex} from "./claim-session";
const rev=z.number().int().positive().safe();
const hash=z.string().regex(/^[0-9a-f]{64}$/u);
const hex=z.string().regex(/^[0-9a-f]+$/u).min(58).max(32768);
const clock=z.iso.datetime({offset:true});
const rawScope=z.object({operation:z.enum(["documentary","claim-objection","claim-release"]),claimId:z.uuid(),reviewRevision:rev,
  assignmentRevision:rev,accountAuthRevision:rev,originatingSessionRevision:rev,
  noticeId:z.uuid(),noticeRevision:rev,noticeDeadline:clock.nullable(),deadline:clock,documentaryRevision:rev,
  photoDocumentId:z.uuid(),photoSha256:hash,birthDocumentId:z.uuid(),birthSha256:hash,
  comparisonCiphertext:hex,wrappedComparisonKey:z.string().regex(/^[0-9a-f]{144}$/u),objectionId:z.uuid().nullable(),current:z.boolean(),
  profile:z.object({profileId:z.uuid(),embryoId:z.uuid(),identityRevision:rev,ciphertext:hex,
    wrappedKey:z.string().regex(/^[0-9a-f]{144}$/u)}).strict().nullable(),
  contact:z.object({id:z.uuid(),ciphertext:hex}).strict().nullable(),
}).strict().refine(row=>row.photoDocumentId!==row.birthDocumentId);
export type KeylessReleaseScope=z.infer<typeof rawScope>;
/** Only a current own-JWT assigned operation supplies this raw envelope.
 * The independently wrapped minimum cannot authorize a different review. */
export function keylessCurrentReview(raw:unknown,id:string) {
  const parsed=rawScope.safeParse(raw);if(!parsed.success||parsed.data.claimId!==id)return null;
  const scope=parsed.data;
  const minimum=openNoticePackage(scope.comparisonCiphertext,scope.wrappedComparisonKey,{reviewId:id,
    documentaryRevision:scope.documentaryRevision,photoDocumentId:scope.photoDocumentId,photoSha256:scope.photoSha256,
    birthDocumentId:scope.birthDocumentId,birthSha256:scope.birthSha256});
  if(!minimum)return null;
  const selectedProfile={childDateOfBirth:minimum.verifiedDateOfBirth,childPlaceOfBirth:minimum.childPlaceOfBirth,parentNames:minimum.parentNames};
  const documentaryIdentity={fullName:minimum.verifiedName,dateOfBirth:minimum.verifiedDateOfBirth,
    photoIdentityReviewed:true as const,birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
  let profileIndexes:ReturnType<typeof identityProfileDigestSet>;
  try{profileIndexes=identityProfileDigestSet(selectedProfile);}catch{return null;}
  let profileMatches=false;
  if(scope.profile){
    const profile=openIdentityProfile(Buffer.from(scope.profile.ciphertext,"hex"),scope.profile.wrappedKey,{profileId:scope.profile.profileId,embryoId:scope.profile.embryoId,identityRevision:scope.profile.identityRevision});
    if(!profile)return null;
    const actual=identityProfileDigestSet({childDateOfBirth:profile.childDateOfBirth,childPlaceOfBirth:profile.childPlaceOfBirth,parentNames:profile.parentNames});
    profileMatches=Object.keys(actual).length===Object.keys(profileIndexes).length&&Object.entries(actual).every(([revision,digest])=>
      typeof profileIndexes[revision]==="string"&&crypto.timingSafeEqual(Buffer.from(digest,"hex"),Buffer.from(profileIndexes[revision]! ,"hex")));
  }
  const caseBody={claimId:id,mode:"keyless" as const,state:"approved_pending_owner_notice" as const,reviewRevision:scope.reviewRevision,
    deadline:new Date(scope.deadline).toISOString(),claimant:{fullName:minimum.verifiedName,dateOfBirth:minimum.verifiedDateOfBirth},
    evidence:{photoIdentityDocumentId:scope.photoDocumentId,birthRecordDocumentId:scope.birthDocumentId},
    case:{kind:"unclaimed_keyless" as const,candidateClass:"exactly_one" as const,selectedProfile},
    notice:{state:scope.objectionId!==null?"objected" as const:scope.noticeDeadline===null?"delivery_pending" as const:"notice_pending" as const,
      noticeRevision:scope.noticeRevision,deadline:scope.noticeDeadline}};
  return {scope,caseBody,documentaryIdentity,profileIndexes,profileMatches};
}
const reason=z.string().max(8000).transform(value=>value.normalize("NFC").trim()).refine(value=>[...value].length>=20&&[...value].length<=2000
  &&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value));
const common={reviewRevision:rev,noticeRevision:rev,reason,nonce:z.string().min(1).max(2048)};
export const keylessReleaseDecisionBody=z.discriminatedUnion("decision",[
  z.object({...common,decision:z.literal("approve-release")}).strict(),
  z.object({...common,decision:z.literal("refuse-release"),refusalCode:z.enum(["documentary_evidence_insufficient","identity_profile_conflict",
    "notice_delivery_failed","claim_deadline_expired","record_state_changed"])}).strict(),
]);
function binding(scope:KeylessReleaseScope,account:string,session:string) {
  return sha256Hex(JSON.stringify([scope.claimId,account,session,scope.reviewRevision,scope.noticeRevision,scope.assignmentRevision,
    scope.accountAuthRevision,scope.originatingSessionRevision,scope.photoDocumentId,scope.photoSha256,
    scope.birthDocumentId,scope.birthSha256,sha256Hex(scope.comparisonCiphertext)]));
}
export function mintKeylessReleaseNonce(scope:KeylessReleaseScope,account:string,session:string,now=Date.now()) {
  if(scope.operation!=="claim-release")throw new Error("claim release unavailable");
  return mintPublicFormToken("future-person-claim-release",now,binding(scope,account,session));
}
export function readKeylessReleaseNonce(token:string,scope:KeylessReleaseScope,account:string,session:string,now=Date.now()) {
  return scope.operation==="claim-release"&&token.length<=2048?
    readPublicFormToken(token,"future-person-claim-release",now,binding(scope,account,session))?.nonce??null:null;
}
/** The new pending contact always has a version2 independently wrapped
 * envelope bound to the exact stored ID. Legacy or swapped blobs refuse. */
export function keylessDeliveryAddress(scope:KeylessReleaseScope):string|null {
  try{
    if(!scope.contact)return null;
    const bytes=Buffer.from(scope.contact.ciphertext,"hex");
    const envelope=z.object({version:z.literal(2),contactId:z.uuid(),wrappedKey:hex,sealedEmail:hex}).strict()
      .safeParse(JSON.parse(decryptSecret(bytes)));
    if(!envelope.success||envelope.data.contactId!==scope.contact.id)return null;
    return openMailContact(bytes);
  }catch{return null;}
}
