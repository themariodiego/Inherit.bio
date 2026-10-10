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
const {reviewCsrf,mintReviewNonce,verifiedIdentityDigestSet}=await import("./review");
const {shapeKeylessVerification}=await import("./keyless-verification");
const {sealKeylessVerificationProof}=await import("./keyless-verification-proof");
const {claimDataKey,openDocumentBytes}=await import("./document-envelope");
afterAll(()=>vi.unstubAllEnvs());
const id=(last:number)=>`7d000000-0000-4000-8000-${String(last).padStart(12,"0")}`;
const ID=id(1),ACCOUNT=id(2),SESSION=id(3);
const human={fullName:"Synthetic Verified Claimant",dateOfBirth:"2000-01-01",photoIdentityReviewed:true as const,
  birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
const sealed=sealClaimIntake({mode:"keyless-start",claimantName:"Synthetic Unverified Claimant",contactEmail:"synthetic@e2e.local",
  childDateOfBirth:"2001-01-01",childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"],affirmed:true});
const row={claimId:ID,mode:"keyless",state:"document_review_pending",reviewRevision:1,
  deadline:"2026-10-30T12:00:00.000Z",caseKind:"keyless_none",allowedDecisions:["reject","needs-more-information"],
  photoIdentityDocumentId:id(4),birthRecordDocumentId:id(5),identityCiphertext:sealed.identityCiphertext.toString("hex"),
  wrappedDataKey:sealed.wrappedDataKey.toString("hex"),parentIdentityCiphertext:null};
const scope={reviewId:ID,reviewerAccountId:ACCOUNT,authSessionId:SESSION,reviewRevision:1,assignmentRevision:1,
  accountAuthRevision:1,originatingSessionRevision:1,photoIdentity:{id:id(4),sha256:"a".repeat(64)},
  birthRecord:{id:id(5),sha256:"b".repeat(64)},comparisonReceiptDigest:"c".repeat(64)};
const lookup={case:{...row,caseKind:"claimed_unbound_no_key_recovery",
  allowedDecisions:["approve-claimed-unbound-no-key-recovery","reject","needs-more-information"]},scope,profile:null};
function proof(raw:unknown=lookup,now=Date.now()){
  const shaped=shapeKeylessVerification(raw,{reviewId:ID,accountId:ACCOUNT,sessionId:SESSION,reviewRevision:1},human)!;
  return sealKeylessVerificationProof(shaped.scope,now);
}
function body(){return {reviewRevision:1,decision:"approve-claimed-unbound-no-key-recovery",
  reason:"I freshly reviewed both complete synthetic documents and their exact identity.",
  nonce:mintReviewNonce(ID,ACCOUNT,SESSION),documentaryAttestation:human,verificationProof:proof()};}
function request(given:unknown=body(),headers:Record<string,string>={}){
  return new Request(`https://test.e2e.local/api/reviews/future-person/claims/${ID}`,{method:"POST",
    headers:{origin:"https://test.e2e.local","sec-fetch-site":"same-origin","content-type":"application/json",
      "x-inherit-csrf":reviewCsrf(ID,ACCOUNT,SESSION),...headers},body:JSON.stringify(given)});
}
const call=(req:Request)=>POST(req,{params:Promise.resolve({id:ID})});
beforeEach(()=>{
  vi.clearAllMocks();mocks.open.mockReturnValue(true);mocks.account.mockResolvedValue({user:{id:ACCOUNT},sessionId:SESSION});
  mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:
    name==="verify_keyless_claim_documents_v1"?lookup:{claimId:ID,state:"release_queued",reviewRevision:2},error:null}));
});
describe("native assigned reviewer recovery POST",()=>{
  it("binds genuine encrypted lookup, fresh verified identity and a separate consumed decision nonce",async()=>{
    const response=await call(request());expect(response.status).toBe(200);
    expect(await response.json()).toEqual({claimId:ID,state:"release_queued",reviewRevision:2});
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(["read_claim_review_case_v1","verify_keyless_claim_documents_v1","restore_future_person_claim_review_v1"]);
    const args=mocks.rpc.mock.calls[2]![1];
    expect(args.p_identity_hmac_set).toEqual(verifiedIdentityDigestSet(human));
    expect(args.p_verified_date_of_birth).toBe(human.dateOfBirth);
    expect(args.p_comparison_receipt_digest).toBe(scope.comparisonReceiptDigest);
    expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(args.p_parent_link_confirmed).toBeUndefined();
    expect(JSON.stringify(args)).not.toContain("synthetic@e2e.local");
    expect(JSON.stringify(args)).not.toContain(human.fullName);
    const key=claimDataKey(row.wrappedDataKey);
    try{
      const bytes=openDocumentBytes(key,`claim-review-v1|${ID}|${args.p_nonce_hash}|attestation`,Buffer.from(args.p_attestation_ciphertext.slice(2),"hex"));
      expect(JSON.parse(bytes!.toString())).toEqual(human);bytes!.fill(0);
    }finally{key.fill(0);}
  });
  it("uses the matched Recovery Key branch without any parent-profile lookup or documentary lookup proof",async()=>{
    mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?{...row,mode:"claimant-recovery-key",caseKind:"claimant_recovery_key"}:
      {claimId:ID,state:"release_queued",reviewRevision:2},error:null}));
    const {verificationProof:_proof,...given}=body();
    expect(_proof).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect((await call(request({...given,decision:"approve-recovery-key"}))).status).toBe(200);
    expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(["read_claim_review_case_v1","restore_future_person_claim_review_v1"]);
    expect(mocks.rpc.mock.calls[1]![1].p_profile_hmac_set).toBeNull();
    expect(mocks.rpc.mock.calls[1]![1].p_comparison_receipt_digest).toBeNull();
  });
  it("refuses absent, expired and wrong-reviewer proofs or a changed verified tuple before mutation",async()=>{
    for(const given of [{...body(),verificationProof:undefined},{...body(),verificationProof:"a".repeat(300)},
      {...body(),verificationProof:proof(lookup,Date.now()-600001)},
      {...body(),documentaryAttestation:{...human,fullName:"Synthetic Different Claimant"}},
      {...body(),documentaryAttestation:{...human,dateOfBirth:"2000-02-01"}}]){
      mocks.rpc.mockClear();expect((await call(request(given))).status).toBe(404);
      expect(mocks.rpc.mock.calls.some(c=>c[0]==="restore_future_person_claim_review_v1")).toBe(false);
    }
    mocks.account.mockResolvedValue({user:{id:id(99)},sessionId:SESSION});
    expect((await call(request())).status).toBe(404);
  });
  it("refuses a proof after real assignment, session, documents, match or authority receipt changed",async()=>{
    for(const changed of [{...lookup,scope:{...scope,assignmentRevision:2}},
      {...lookup,scope:{...scope,accountAuthRevision:2}},
      {...lookup,scope:{...scope,originatingSessionRevision:2}},
      {...lookup,scope:{...scope,comparisonReceiptDigest:"d".repeat(64)}},
      {...lookup,scope:{...scope,photoIdentity:{...scope.photoIdentity,sha256:"e".repeat(64)}}},
      {...lookup,case:{...row,caseKind:"keyless_ambiguous",allowedDecisions:["reject","needs-more-information"]}}]){
      mocks.rpc.mockClear();mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:changed,error:null}));
      expect((await call(request())).status).toBe(404);
      expect(mocks.rpc.mock.calls.some(c=>c[0]==="restore_future_person_claim_review_v1")).toBe(false);
    }
  });
  it("keeps the TEST-LOCAL, own-session, CSRF, one-use nonce and closed request boundaries",async()=>{
    mocks.open.mockReturnValue(false);expect((await call(request())).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.open.mockReturnValue(true);
    for(const req of [request(body(),{origin:"https://foreign.e2e.local"}),request(body(),{"sec-fetch-site":"cross-site"}),
      request(body(),{"content-type":"text/plain"}),request({...body(),matchedSubjectId:id(99)}),
      request({...body(),nonce:mintReviewNonce(ID,ACCOUNT,SESSION,Date.now()-600001)}),
      request({...body(),documentaryAttestation:{...human,recordedParentLinkConfirmed:true}})]){
      expect((await call(req)).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
    }
  });
  it("preserves real SQL read, identity, lifecycle, nonce and purge refusals",async()=>{
    for(const code of ["42501","22023","23505","XX000"]){
      mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:
        name==="verify_keyless_claim_documents_v1"?lookup:null,error:name==="restore_future_person_claim_review_v1"?{code}:null}));
      const response=await call(request());expect(response.status).toBe(code==="XX000"?503:404);
      expect(await response.json()).toEqual({error:code==="XX000"?"unavailable":"not_found"});
    }
  });
});
