import crypto from "node:crypto";
import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({account:vi.fn(),rpc:vi.fn(),open:vi.fn(()=>true)}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:mocks.account}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/future-person/claims-open",()=>({futurePersonClaimsOpen:mocks.open}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
vi.stubEnv("INHERIT_HMAC_KEYRING","");
const {POST}=await import("@/app/api/reviews/future-person/claims/[id]/verify-documents/route");
const {sealClaimIntake}=await import("./claim-intake");
const {reviewCsrf,mintReviewNonce}=await import("./review");
const {mintKeylessLookupNonce,shapeKeylessVerification}=await import("./keyless-verification");
const {keylessVerificationProofMatches}=await import("./keyless-verification-proof");
afterAll(()=>vi.unstubAllEnvs());
const id=(last:number)=>`7c000000-0000-4000-8000-${String(last).padStart(12,"0")}`;
const ID=id(1),ACCOUNT=id(2),SESSION=id(3);
const human={fullName:"Synthetic Claimant",dateOfBirth:"2000-01-01",photoIdentityReviewed:true as const,
  birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
const sealed=sealClaimIntake({mode:"keyless-start",claimantName:"Synthetic Claimant",contactEmail:"synthetic@e2e.local",
  childDateOfBirth:"2001-01-01",childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"],affirmed:true});
const row={claimId:ID,mode:"keyless",state:"document_review_pending",reviewRevision:1,
  deadline:"2026-10-30T12:00:00.000Z",caseKind:"keyless_none",allowedDecisions:["reject","needs-more-information"],
  photoIdentityDocumentId:id(4),birthRecordDocumentId:id(5),identityCiphertext:sealed.identityCiphertext.toString("hex"),
  wrappedDataKey:sealed.wrappedDataKey.toString("hex"),parentIdentityCiphertext:null};
const scope={reviewId:ID,reviewerAccountId:ACCOUNT,authSessionId:SESSION,reviewRevision:1,assignmentRevision:1,
  accountAuthRevision:1,originatingSessionRevision:1,photoIdentity:{id:id(4),sha256:"a".repeat(64)},
  birthRecord:{id:id(5),sha256:"b".repeat(64)},comparisonReceiptDigest:"c".repeat(64)};
const lookup={case:row,scope,profile:null};
function request(body:unknown={reviewRevision:1,documentaryAttestation:human,nonce:mintKeylessLookupNonce(ID,ACCOUNT,SESSION)},
  headers:Record<string,string>={},url=`https://test.e2e.local/api/reviews/future-person/claims/${ID}/verify-documents`) {
  return new Request(url,{method:"POST",headers:{origin:"https://test.e2e.local","sec-fetch-site":"same-origin",
    "content-type":"application/json","x-inherit-csrf":reviewCsrf(ID,ACCOUNT,SESSION),...headers},body:JSON.stringify(body)});
}
const call=(req:Request)=>POST(req,{params:Promise.resolve({id:ID})});
beforeEach(()=>{
  vi.clearAllMocks();mocks.open.mockReturnValue(true);
  mocks.account.mockResolvedValue({user:{id:ACCOUNT},sessionId:SESSION});
  mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:lookup,error:null}));
});
describe("assigned-review documentary verification route",()=>{
  it("keeps absent, ambiguous and malformed authority opaque and creates no positive state",async()=>{
    const response=await call(request());expect(response.status).toBe(200);
    const body=await response.json();expect(Object.keys(body).sort()).toEqual(["reviewCase","verificationProof"]);
    expect(body.verificationProof).toBeNull();expect(body.reviewCase.case.kind).toBe("keyless_none");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(mocks.rpc.mock.calls.map(call=>call[0])).toEqual(["read_claim_review_case_v1","verify_keyless_claim_documents_v1"]);
    expect(mocks.rpc.mock.calls[1]![1].p_verified_date_of_birth).toBe(human.dateOfBirth);
    expect(JSON.stringify(body)).not.toContain("synthetic@e2e.local");
    expect(JSON.stringify(body)).not.toContain(scope.comparisonReceiptDigest);
  });
  it("seals only a genuine private unique lookup receipt under the current own-JWT scope",async()=>{
    const unique={...lookup,case:{...row,caseKind:"claimed_unbound_no_key_recovery",
      allowedDecisions:["approve-claimed-unbound-no-key-recovery","reject","needs-more-information"]}};
    mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:unique,error:null}));
    const response=await call(request()),body=await response.json();expect(response.status).toBe(200);
    const shaped=shapeKeylessVerification(unique,{reviewId:ID,accountId:ACCOUNT,sessionId:SESSION,reviewRevision:1},human)!;
    expect(keylessVerificationProofMatches(body.verificationProof,shaped.scope)).toBe(true);
    expect(keylessVerificationProofMatches(body.verificationProof,{...shaped.scope,assignmentRevision:2})).toBe(false);
    expect(body.reviewCase.state).toBe("document_review_pending");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("refuses disabled, foreign, stale and recursively open requests before any data selection",async()=>{
    mocks.open.mockReturnValue(false);expect((await call(request())).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.open.mockReturnValue(true);
    const normal={reviewRevision:1,documentaryAttestation:human,nonce:mintKeylessLookupNonce(ID,ACCOUNT,SESSION)};
    for(const req of [request(normal,{origin:"https://foreign.e2e.local"}),request(normal,{"sec-fetch-site":"cross-site"}),
      request(normal,{"content-type":"text/plain"}),request(normal,{"x-inherit-csrf":reviewCsrf(ID,id(99),SESSION)}),
      request({...normal,selectedSubject:id(99)}),request({...normal,documentaryAttestation:{...human,parentLink:true}}),
      request({...normal,nonce:mintReviewNonce(ID,ACCOUNT,SESSION)}),
      request({...normal,nonce:mintKeylessLookupNonce(ID,ACCOUNT,SESSION,Date.now()-600001)}),
      request(normal,{},`https://test.e2e.local/api/reviews/future-person/claims/${ID}/verify-documents?record=${id(99)}`)]){
      const response=await call(req);expect(response.status).toBe(404);expect(await response.json()).toEqual({error:"not_found"});
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.account.mockResolvedValue(null);expect((await call(request())).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("never converts a wrong stored mode, revision, document or assignment into a verification receipt",async()=>{
    for(const original of [{...row,mode:"record-key"},{...row,reviewRevision:2}]){
      mocks.rpc.mockResolvedValue({data:original,error:null});expect((await call(request())).status).toBe(404);
    }
    for(const bad of [{...lookup,scope:{...scope,reviewerAccountId:id(99)}},
      {...lookup,scope:{...scope,photoIdentity:{...scope.photoIdentity,id:id(99)}}},
      {...lookup,case:{...row,contactEmail:"synthetic@e2e.local"}}]){
      mocks.rpc.mockImplementation(async name=>({data:name==="read_claim_review_case_v1"?row:bad,error:null}));
      const response=await call(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"unavailable"});
    }
  });
  it("preserves the database's exact assignment/read refusal and unavailable response",async()=>{
    for(const code of ["42501","22023","23505","XX000"]){
      mocks.rpc.mockImplementation(async name=>name==="read_claim_review_case_v1"?{data:row,error:null}:{data:null,error:{code}});
      const response=await call(request());expect(response.status).toBe(code==="XX000"?503:404);
      expect(await response.json()).toEqual({error:code==="XX000"?"unavailable":"not_found"});
    }
  });
});
