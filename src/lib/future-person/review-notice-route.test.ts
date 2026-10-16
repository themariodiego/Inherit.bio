import crypto from "node:crypto";
import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({account:vi.fn(),rpc:vi.fn(),open:vi.fn(()=>true)}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:mocks.account}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/future-person/claims-open",()=>({futurePersonClaimsOpen:mocks.open}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_HMAC_KEYRING","");
const {POST}=await import("@/app/api/reviews/future-person/claims/[id]/route");
const {sealClaimIntake}=await import("./claim-intake");
const {sealIdentityProfile}=await import("./identity-profile");
const {reviewCsrf,mintReviewNonce,verifiedIdentityDigestSet}=await import("./review");
const {keylessVerificationIndexes,shapeKeylessVerification}=await import("./keyless-verification");
const {sealKeylessVerificationProof}=await import("./keyless-verification-proof");
const {openNoticePackage}=await import("./notice-package");
const {openMailContact}=await import("./claimant-contact");
const {claimDataKey,openDocumentBytes}=await import("./document-envelope");
afterAll(()=>vi.unstubAllEnvs());
const id=(last:number)=>`7f000000-0000-4000-8000-${String(last).padStart(12,"0")}`;
const ID=id(1),ACCOUNT=id(2),SESSION=id(3);
const human={fullName:"Synthetic Document Claimant",dateOfBirth:"2000-01-01",photoIdentityReviewed:true as const,
  birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
const intake={mode:"keyless-start" as const,claimantName:"Synthetic Unverified Claimant",contactEmail:"synthetic@e2e.local",
  childDateOfBirth:"2001-01-01",childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"],affirmed:true as const};
const sealed=sealClaimIntake(intake);
const row={claimId:ID,mode:"keyless",state:"document_review_pending",reviewRevision:1,
  deadline:"2026-10-30T12:00:00.000Z",caseKind:"keyless_none",allowedDecisions:["reject","needs-more-information"],
  photoIdentityDocumentId:id(4),birthRecordDocumentId:id(5),identityCiphertext:sealed.identityCiphertext.toString("hex"),
  wrappedDataKey:sealed.wrappedDataKey.toString("hex"),parentIdentityCiphertext:null};
const scope={reviewId:ID,reviewerAccountId:ACCOUNT,authSessionId:SESSION,reviewRevision:1,assignmentRevision:1,
  accountAuthRevision:1,originatingSessionRevision:1,photoIdentity:{id:id(4),sha256:"a".repeat(64)},
  birthRecord:{id:id(5),sha256:"b".repeat(64)},comparisonReceiptDigest:"c".repeat(64)};
const binding={reviewId:ID,documentaryRevision:1,photoDocumentId:id(4),photoSha256:"a".repeat(64),
  birthDocumentId:id(5),birthSha256:"b".repeat(64)};
const profileScope={profileId:id(6),embryoId:id(7),identityRevision:1};
const profile=sealIdentityProfile({childDateOfBirth:human.dateOfBirth,childPlaceOfBirth:intake.childPlaceOfBirth,
  parentNames:intake.parentNames,consentSignatureId:id(8)},profileScope);
const lookup={case:{...row,caseKind:"unclaimed_keyless",allowedDecisions:["keyless-document-match","reject","needs-more-information"]},
  scope,profile:{...profileScope,ciphertext:profile.ciphertext.toString("hex"),wrappedKey:profile.wrappedKey.toString("hex")}};
function proof(now=Date.now()){
  const shaped=shapeKeylessVerification(lookup,{reviewId:ID,accountId:ACCOUNT,sessionId:SESSION,reviewRevision:1},human)!;
  return sealKeylessVerificationProof(shaped.scope,now);
}
function body(){return {reviewRevision:1,decision:"keyless-document-match",reason:"Both complete synthetic documents match the current parent profile.",
  documentaryAttestation:{...human,recordedParentLinkConfirmed:true},nonce:mintReviewNonce(ID,ACCOUNT,SESSION),verificationProof:proof()};}
function request(given:unknown=body(),headers:Record<string,string>={}){
  return new Request(`https://test.e2e.local/api/reviews/future-person/claims/${ID}`,{method:"POST",
    headers:{origin:"https://test.e2e.local","sec-fetch-site":"same-origin","content-type":"application/json",
      "x-inherit-csrf":reviewCsrf(ID,ACCOUNT,SESSION),...headers},body:JSON.stringify(given)});
}
const call=(req:Request)=>POST(req,{params:Promise.resolve({id:ID})});
beforeEach(()=>{
  vi.clearAllMocks();mocks.open.mockReturnValue(true);mocks.account.mockResolvedValue({user:{id:ACCOUNT},sessionId:SESSION});
  mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:
    name==="verify_keyless_claim_documents_v1"?lookup:{claimId:ID,state:"approved_pending_owner_notice",reviewRevision:2},error:null}));
});
describe("native initial documentary owner notice",()=>{
  it("projects exactly the verified documentary fields, preserving the true parent link and independent wrapped minimum",async()=>{
    // The linked six-field object must still fail the independent strict parser:
    // success requires the explicit projection at the native boundary.
    expect(keylessVerificationIndexes(intake,body().documentaryAttestation)).toBeNull();
    const response=await call(request());expect(response.status).toBe(200);
    expect(await response.json()).toEqual({claimId:ID,state:"approved_pending_owner_notice",reviewRevision:2});
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(["read_claim_review_case_v1","verify_keyless_claim_documents_v1","prepare_keyless_owner_notice_v1"]);
    const args=mocks.rpc.mock.calls[2]![1];
    expect(args.p_parent_link_confirmed).toBe(true);expect(args.p_identity_set).toEqual(verifiedIdentityDigestSet(human));
    expect(args.p_verified_birth).toBe(human.dateOfBirth);expect(args.p_comparison_receipt).toBe(scope.comparisonReceiptDigest);
    expect(args.p_minimum_wrapped_key).toMatch(/^\\x[0-9a-f]{144}$/u);
    expect(args.p_minimum_wrapped_key.slice(2)).not.toBe(row.wrappedDataKey);
    expect(openNoticePackage(args.p_minimum_ciphertext.slice(2),args.p_minimum_wrapped_key.slice(2),binding)).toEqual({version:1,
      verifiedName:human.fullName,verifiedDateOfBirth:human.dateOfBirth,childPlaceOfBirth:intake.childPlaceOfBirth,parentNames:intake.parentNames});
    expect(openNoticePackage(args.p_minimum_ciphertext.slice(2),row.wrappedDataKey,binding)).toBeNull();
    expect(openMailContact(Buffer.from(args.p_contact_ciphertext.slice(2),"hex"))).toBe(intake.contactEmail);
    const key=claimDataKey(row.wrappedDataKey);let bytes:Buffer|null=null;
    try{bytes=openDocumentBytes(key,`claim-review-v1|${ID}|${args.p_nonce_hash}|attestation`,Buffer.from(args.p_attestation.slice(2),"hex"));
      expect(JSON.parse(bytes!.toString())).toEqual({...human,recordedParentLinkConfirmed:true});}finally{key.fill(0);bytes?.fill(0);}
    for(const absent of [human.fullName,intake.contactEmail,intake.childPlaceOfBirth,intake.claimantName])
      expect(JSON.stringify(args)).not.toContain(absent);
  });
  it("refuses absent/false parent facts, unknown attestation fields and a wrong or expired documentary proof before the producer",async()=>{
    for(const given of [{...body(),documentaryAttestation:human},{...body(),documentaryAttestation:{...human,recordedParentLinkConfirmed:false}},
      {...body(),documentaryAttestation:{...human,recordedParentLinkConfirmed:true,subjectId:id(99)}},
      {...body(),verificationProof:undefined},{...body(),verificationProof:proof(Date.now()-600001)},
      {...body(),documentaryAttestation:{...human,fullName:"Different Synthetic Claimant",recordedParentLinkConfirmed:true}}]){
      mocks.rpc.mockClear();expect((await call(request(given))).status).toBe(404);
      expect(mocks.rpc.mock.calls.some(c=>c[0]==="prepare_keyless_owner_notice_v1")).toBe(false);
    }
  });
  it("refuses changed assignment, actor, documents, comparison and profile before sealing a pending notice",async()=>{
    for(const changed of [{...lookup,scope:{...scope,assignmentRevision:2}},{...lookup,scope:{...scope,accountAuthRevision:2}},
      {...lookup,scope:{...scope,authSessionId:id(99)}},{...lookup,scope:{...scope,comparisonReceiptDigest:"d".repeat(64)}},
      {...lookup,scope:{...scope,birthRecord:{...scope.birthRecord,sha256:"e".repeat(64)}}},
      {...lookup,profile:{...lookup.profile,identityRevision:2}},
      {...lookup,case:{...row,caseKind:"keyless_none",allowedDecisions:["reject","needs-more-information"]},profile:null}]){
      mocks.rpc.mockClear();mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:changed,error:null}));
      expect((await call(request())).status).toBe(404);
      expect(mocks.rpc.mock.calls.some(c=>c[0]==="prepare_keyless_owner_notice_v1")).toBe(false);
    }
  });
  it("keeps SQL lifecycle/read/competing/nonce refusals opaque and never accepts a premature release receipt",async()=>{
    for(const code of ["42501","22023","23505","XX000"]){
      mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:name==="verify_keyless_claim_documents_v1"?lookup:null,
        error:name==="prepare_keyless_owner_notice_v1"?{code}:null}));
      expect((await call(request())).status).toBe(code==="XX000"?503:404);
    }
    for(const outcome of [{claimId:ID,state:"release_queued",reviewRevision:2},
      {claimId:ID,state:"approved_pending_owner_notice",reviewRevision:3},
      {claimId:ID,state:"approved_pending_owner_notice",reviewRevision:2,subjectId:id(99)}]){
      mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:name==="verify_keyless_claim_documents_v1"?lookup:outcome,error:null}));
      expect((await call(request())).status).toBe(503);
    }
  });
  it("denies foreign/disabled/stale own authority before selecting any case",async()=>{
    mocks.open.mockReturnValue(false);expect((await call(request())).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.open.mockReturnValue(true);
    for(const req of [request(body(),{origin:"https://foreign.e2e.local"}),request(body(),{"sec-fetch-site":"cross-site"}),
      request(body(),{"x-inherit-csrf":reviewCsrf(ID,id(99),SESSION)}),
      request({...body(),nonce:mintReviewNonce(ID,ACCOUNT,SESSION,Date.now()-600001)})]){
      expect((await call(req)).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
    }
  });
});
