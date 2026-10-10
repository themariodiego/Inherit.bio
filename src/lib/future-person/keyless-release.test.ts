import crypto from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_HMAC_KEYRING","");
const {keylessCurrentReview,keylessDeliveryAddress,keylessReleaseDecisionBody,mintKeylessReleaseNonce,readKeylessReleaseNonce}=await import("./keyless-release");
const {sealNoticePackage}=await import("./notice-package");
const {sealIdentityProfile}=await import("./identity-profile");
const {sealClaimantContact}=await import("./claimant-contact");
const {reviewPageCase,reviewPageDecisions}=await import("./review-page-contract");
afterAll(()=>vi.unstubAllEnvs());
const id=(n:number)=>`7e000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const human={fullName:"Synthetic Verified Claimant",dateOfBirth:"2000-01-01",photoIdentityReviewed:true as const,
 birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
const fields={childDateOfBirth:human.dateOfBirth,childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"]};
const packageScope={reviewId:id(1),documentaryRevision:1,photoDocumentId:id(2),photoSha256:"a".repeat(64),birthDocumentId:id(3),birthSha256:"b".repeat(64)};
const profileScope={profileId:id(4),embryoId:id(5),identityRevision:2};
let raw:Record<string,unknown>;
beforeAll(()=>{
 const minimum=sealNoticePackage(human,fields,packageScope),profile=sealIdentityProfile({...fields,consentSignatureId:id(6)},profileScope);
 raw={operation:"claim-release",claimId:id(1),reviewRevision:3,assignmentRevision:2,accountAuthRevision:1,originatingSessionRevision:1,
 noticeId:id(7),noticeRevision:2,noticeDeadline:"2026-10-01T00:00:00.000Z",deadline:"2026-11-01T00:00:00.000Z",documentaryRevision:1,
 photoDocumentId:id(2),photoSha256:"a".repeat(64),birthDocumentId:id(3),birthSha256:"b".repeat(64),comparisonCiphertext:minimum.ciphertext.slice(2),
 wrappedComparisonKey:minimum.wrappedKey.slice(2),objectionId:null,current:true,
 profile:{...profileScope,ciphertext:profile.ciphertext.toString("hex"),wrappedKey:profile.wrappedKey.toString("hex")},
 contact:{id:id(8),ciphertext:sealClaimantContact(id(8),"synthetic@e2e.local").slice(2)}};
});
describe("the separate current keyless release proof",()=>{
 it("opens only separately wrapped exact minimum/profile scopes and keeps pending notice free of an initial release choice",()=>{
  const current=keylessCurrentReview(raw,id(1))!;expect(current).not.toBeNull();expect(current.profileMatches).toBe(true);
  expect(current.documentaryIdentity).toEqual(human);expect(current.caseBody.case.selectedProfile).toEqual(fields);
  expect(reviewPageCase.parse(current.caseBody)).toEqual(current.caseBody);expect(reviewPageDecisions(current.caseBody)).toEqual([]);
  expect(JSON.stringify(current.caseBody)).not.toMatch(/ciphertext|wrapped|synthetic@|profileId|embryoId|sha256|assignmentRevision/iu);
  expect(keylessDeliveryAddress(current.scope)).toBe("synthetic@e2e.local");
  const postgres=keylessCurrentReview({...raw,deadline:"2026-11-01T00:00:00+00:00",noticeDeadline:"2026-10-01T00:00:00+00:00"},id(1))!;
  expect(reviewPageCase.parse(postgres.caseBody).deadline).toBe("2026-11-01T00:00:00.000Z");
 });
 it("recognizes actual material profile mismatch without requiring the old profile revision",()=>{
  const changed=sealIdentityProfile({...fields,parentNames:["Different Synthetic Parent"],consentSignatureId:id(6)}, {...profileScope,identityRevision:3});
  const current=keylessCurrentReview({...raw,profile:{...profileScope,identityRevision:3,ciphertext:changed.ciphertext.toString("hex"),wrappedKey:changed.wrappedKey.toString("hex")}},id(1))!;
  expect(current).not.toBeNull();expect(current.profileMatches).toBe(false);expect(current.caseBody.case.selectedProfile).toEqual(fields);
 });
 it("refuses substituted documents, profile scopes, keys, minimum or caller-selected extra fields",()=>{
  for(const override of [{claimId:id(20)},{documentaryRevision:2},{photoDocumentId:id(20)},{photoSha256:"c".repeat(64)},
   {birthDocumentId:id(20)},{birthSha256:"c".repeat(64)},{wrappedComparisonKey:"0".repeat(144)},
   {comparisonCiphertext:"0".repeat(200)},{candidateCount:1},
   {profile:{...(raw.profile as object),profileId:id(20)}},{profile:{...(raw.profile as object),identityRevision:3}},
   {profile:{...(raw.profile as object),wrappedKey:"0".repeat(144)}},{photoDocumentId:id(3)}])
   expect(keylessCurrentReview({...raw,...override},id(1))).toBeNull();
 });
 it("returns a closed refusal when a valid minimum contains unsupported current-index fields",()=>{
  const oversized=sealNoticePackage(human,{...fields,parentNames:["S".repeat(121)]},packageScope);
  expect(keylessCurrentReview({...raw,comparisonCiphertext:oversized.ciphertext.slice(2),wrappedComparisonKey:oversized.wrappedKey.slice(2)},id(1))).toBeNull();
 });
 it("binds its stateless proof to the distinct release operation, actor, Auth session, revisions, exact bytes and minimum",()=>{
  const current=keylessCurrentReview(raw,id(1))!,now=Date.now(),token=mintKeylessReleaseNonce(current.scope,id(10),id(11),now);
  expect(readKeylessReleaseNonce(token,current.scope,id(10),id(11),now+1)).toBeTypeOf("string");
  for(const changed of [{operation:"documentary" as const},{operation:"claim-objection" as const},{reviewRevision:4},{noticeRevision:3},
   {assignmentRevision:3},{accountAuthRevision:2},{originatingSessionRevision:2},{photoSha256:"c".repeat(64)},
   {birthDocumentId:id(20)},{comparisonCiphertext:"0".repeat(200)}])
   expect(readKeylessReleaseNonce(token,{...current.scope,...changed},id(10),id(11),now+1)).toBeNull();
  expect(readKeylessReleaseNonce(token,current.scope,id(20),id(11),now+1)).toBeNull();
  expect(readKeylessReleaseNonce(token,current.scope,id(10),id(20),now+1)).toBeNull();
  expect(readKeylessReleaseNonce(token,current.scope,id(10),id(11),now+10*60_000+1)).toBeNull();
  expect(()=>mintKeylessReleaseNonce({...current.scope,operation:"documentary"},id(10),id(11))).toThrow();
 });
 it("refuses a swapped contact ID, ciphertext, unknown envelope and missing retained delivery address",()=>{
  const current=keylessCurrentReview(raw,id(1))!;
  expect(keylessDeliveryAddress({...current.scope,contact:{...current.scope.contact!,id:id(20)}})).toBeNull();
  expect(keylessDeliveryAddress({...current.scope,contact:{id:id(8),ciphertext:"0".repeat(100)}})).toBeNull();
  expect(keylessDeliveryAddress({...current.scope,contact:null})).toBeNull();
 });
 it("accepts only the registered closed final body and five actual refusal codes",()=>{
  const base={reviewRevision:3,noticeRevision:2,reason:"A current human decision after reading both complete documents.",nonce:"proof"};
  expect(keylessReleaseDecisionBody.safeParse({...base,decision:"approve-release"}).success).toBe(true);
  for(const refusalCode of ["documentary_evidence_insufficient","identity_profile_conflict","notice_delivery_failed","claim_deadline_expired","record_state_changed"])
   expect(keylessReleaseDecisionBody.safeParse({...base,decision:"refuse-release",refusalCode}).success).toBe(true);
  for(const extra of [{now:"2026-11-01T00:00:00.000Z"},{force:true},{attestation:human},{subjectId:id(5)},{refusalCode:"record_state_changed"},
   {reason:"Short"},{reason:"A sufficiently long human reason containing forbidden \u0081 control."}])
   expect(keylessReleaseDecisionBody.safeParse({...base,decision:"approve-release",...extra}).success).toBe(false);
  expect(keylessReleaseDecisionBody.safeParse({...base,decision:"refuse-release",refusalCode:"other"}).success).toBe(false);
 });
});
