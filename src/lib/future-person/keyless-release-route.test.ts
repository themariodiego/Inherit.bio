import crypto from "node:crypto";
import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({account:vi.fn(),rpc:vi.fn(),open:vi.fn(()=>true)}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:mocks.account}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/future-person/claims-open",()=>({futurePersonClaimsOpen:mocks.open}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));vi.stubEnv("INHERIT_HMAC_KEYRING","");
const {GET}=await import("@/app/api/reviews/future-person/claims/[id]/route");
const {POST}=await import("@/app/api/reviews/future-person/claims/[id]/release/route");
const {sealNoticePackage}=await import("./notice-package");const {sealIdentityProfile}=await import("./identity-profile");
const {sealClaimantContact,openMailContact}=await import("./claimant-contact");
const {keylessCurrentReview,mintKeylessReleaseNonce}=await import("./keyless-release");
const {reviewCsrf,verifiedIdentityDigestSet}=await import("./review");
const {claimDataKey,openDocumentBytes}=await import("./document-envelope");
afterAll(()=>vi.unstubAllEnvs());
const id=(n:number)=>`7d000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const ID=id(1),ACCOUNT=id(10),SESSION=id(11);
const human={fullName:"Synthetic Final Claimant",dateOfBirth:"2000-01-01",photoIdentityReviewed:true as const,birthRecordReviewed:true as const,adultAgeConfirmed:true as const};
const fields={childDateOfBirth:human.dateOfBirth,childPlaceOfBirth:"Synthetic City",parentNames:["Synthetic Parent"]};
const profileScope={profileId:id(4),embryoId:id(5),identityRevision:2};
const minimum=sealNoticePackage(human,fields,{reviewId:ID,documentaryRevision:1,photoDocumentId:id(2),photoSha256:"a".repeat(64),birthDocumentId:id(3),birthSha256:"b".repeat(64)});
const profile=sealIdentityProfile({...fields,consentSignatureId:id(6)},profileScope);
const base={operation:"claim-release",claimId:ID,reviewRevision:3,assignmentRevision:2,accountAuthRevision:1,originatingSessionRevision:1,
 noticeId:id(7),noticeRevision:2,noticeDeadline:new Date(Date.now()-1000).toISOString(),deadline:new Date(Date.now()+86400000).toISOString(),documentaryRevision:1,
 photoDocumentId:id(2),photoSha256:"a".repeat(64),birthDocumentId:id(3),birthSha256:"b".repeat(64),comparisonCiphertext:minimum.ciphertext.slice(2),
 wrappedComparisonKey:minimum.wrappedKey.slice(2),objectionId:null,current:true,
 profile:{...profileScope,ciphertext:profile.ciphertext.toString("hex"),wrappedKey:profile.wrappedKey.toString("hex")},
 contact:{id:id(8),ciphertext:sealClaimantContact(id(8),"synthetic@e2e.local").slice(2)}};
function body(){return {decision:"approve-release",reviewRevision:3,noticeRevision:2,reason:"Fresh human review of both full documents and the retained minimum.",
 nonce:mintKeylessReleaseNonce(keylessCurrentReview(base,ID)!.scope,ACCOUNT,SESSION)};}
function request(given:unknown=body(),headers:Record<string,string>={}){return new Request(`https://test.e2e.local/api/reviews/future-person/claims/${ID}/release`,
 {method:"POST",headers:{origin:"https://test.e2e.local","sec-fetch-site":"same-origin","content-type":"application/json","x-inherit-csrf":reviewCsrf(ID,ACCOUNT,SESSION),...headers},body:JSON.stringify(given)});}
const call=(req:Request)=>POST(req,{params:Promise.resolve({id:ID})});
beforeEach(()=>{vi.clearAllMocks();mocks.open.mockReturnValue(true);mocks.account.mockResolvedValue({user:{id:ACCOUNT},sessionId:SESSION});
 mocks.rpc.mockImplementation(async(name,args)=>({data:name==="read_keyless_current_review_v1"?base:{claimId:ID,state:args.p_decision==="approve-release"?"release_queued":"refused",reviewRevision:4},error:null}));});
describe("the actual fresh keyless final native boundary",()=>{
 it("uses own current scope and separate nonce, seals fresh attestation/contact and accepts only the next closed receipt",async()=>{
  const response=await call(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({claimId:ID,state:"release_queued",reviewRevision:4});
  expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(mocks.rpc.mock.calls.map(call=>call[0])).toEqual(["read_keyless_current_review_v1","decide_keyless_release_v1"]);
  const args=mocks.rpc.mock.calls[1]![1];expect(args.p_contact).not.toBe(base.contact.id);expect(args.p_identity_set).toEqual(verifiedIdentityDigestSet(human));
  expect(openMailContact(Buffer.from(args.p_contact_ciphertext.slice(2),"hex"))).toBe("synthetic@e2e.local");
  const key=claimDataKey(base.wrappedComparisonKey);let bytes:Buffer|null=null;
  try{bytes=openDocumentBytes(key,`claim-review-v1|${ID}|${args.p_nonce_hash}|attestation`,Buffer.from(args.p_attestation.slice(2),"hex"));
   expect(JSON.parse(bytes!.toString())).toEqual({...human,recordedParentLinkConfirmed:true});}finally{key.fill(0);bytes?.fill(0);}
  expect(args).not.toHaveProperty("p_now");expect(args.p_refusal_code).toBeNull();
  for(const text of [human.fullName,"synthetic@e2e.local",fields.childPlaceOfBirth])expect(JSON.stringify(args)).not.toContain(text);
 });
 it("refuses premature, expired, changed lifecycle/assignment, active objection, lost profile and swapped contact before the effect",async()=>{
  for(const changed of [{noticeDeadline:new Date(Date.now()+86400000).toISOString()},{deadline:new Date(Date.now()-1000).toISOString()},
   {current:false},{assignmentRevision:3},{accountAuthRevision:2},{originatingSessionRevision:2},{reviewRevision:4},{noticeRevision:3},
   {operation:"documentary"},{objectionId:id(90)},{profile:null},{contact:{...base.contact,id:id(90)}},{photoSha256:"c".repeat(64)}]){
   mocks.rpc.mockClear();mocks.rpc.mockResolvedValue({data:{...base,...changed},error:null});expect((await call(request())).status).toBe(404);
   expect(mocks.rpc.mock.calls.some(call=>call[0]==="decide_keyless_release_v1")).toBe(false);
  }
 });
 it("requires actual material profile conflict for its coded refusal, keeping all positive-only arguments absent",async()=>{
  const conflict={...body(),decision:"refuse-release",refusalCode:"identity_profile_conflict"};
  expect((await call(request(conflict))).status).toBe(404);expect(mocks.rpc.mock.calls.some(call=>call[0]==="decide_keyless_release_v1")).toBe(false);
  const changed=sealIdentityProfile({...fields,parentNames:["Other Synthetic Parent"],consentSignatureId:id(6)}, {...profileScope,identityRevision:3});
  mocks.rpc.mockImplementation(async name=>({data:name==="read_keyless_current_review_v1"?{...base,profile:{...profileScope,identityRevision:3,
   ciphertext:changed.ciphertext.toString("hex"),wrappedKey:changed.wrappedKey.toString("hex")}}:{claimId:ID,state:"refused",reviewRevision:4},error:null}));
  expect((await call(request(conflict))).status).toBe(200);const args=mocks.rpc.mock.calls.at(-1)![1];expect(args.p_profile_set).not.toBeNull();
  for(const field of ["p_attestation","p_verified_birth","p_identity_set","p_contact","p_contact_ciphertext","p_contact_set"])expect(args[field]).toBeNull();
 });
 it("keeps real SQL EOF/ACK, revision, competing/purge, replay and provider refusals opaque and rejects unclosed success",async()=>{
  for(const code of ["42501","22023","23505","XX000"]){mocks.rpc.mockImplementation(async name=>({data:name==="read_keyless_current_review_v1"?base:null,
   error:name==="decide_keyless_release_v1"?{code}:null}));expect((await call(request())).status).toBe(code==="XX000"?503:404);}
  for(const row of [{claimId:ID,state:"release_queued",reviewRevision:3},{claimId:ID,state:"approved_pending_owner_notice",reviewRevision:4},
   {claimId:ID,state:"release_queued",reviewRevision:4,subjectId:id(90)}]){mocks.rpc.mockImplementation(async name=>({data:name==="read_keyless_current_review_v1"?base:row,error:null}));
   expect((await call(request())).status).toBe(503);}
 });
 it("refuses gate/origin/CSRF, own-session substitution, unknown selectors and alternate time at the native request",async()=>{
  mocks.open.mockReturnValue(false);expect((await call(request())).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();mocks.open.mockReturnValue(true);
  for(const req of [request(body(),{origin:"https://foreign.e2e.local"}),request(body(),{"sec-fetch-site":"cross-site"}),
   request(body(),{"x-inherit-csrf":reviewCsrf(ID,id(90),SESSION)}),request({...body(),now:new Date().toISOString()}),
   request({...body(),subjectId:id(5)}),request({...body(),attestation:human})]){mocks.rpc.mockClear();expect((await call(req)).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();}
  const stale=body();mocks.account.mockResolvedValue({user:{id:ACCOUNT},sessionId:id(90)});expect((await call(request(stale))).status).toBe(404);
 });
 it("projects the actual pending GET without ciphertext, selectors or earlier documentary proof",async()=>{
  mocks.rpc.mockImplementation(async name=>name==="read_claim_review_case_v1"?{data:null,error:{code:"42501"}}:{data:base,error:null});
  const response=await GET(new Request(`https://test.e2e.local/api/reviews/future-person/claims/${ID}`),{params:Promise.resolve({id:ID})});
  expect(response.status).toBe(200);expect(response.headers.get("x-inherit-review-operation")).toBe("claim-release");
  expect(response.headers.has("x-inherit-keyless-lookup-nonce")).toBe(false);expect(response.headers.get("x-inherit-review-nonce")).toBeTypeOf("string");
  const value=await response.json();expect(value.state).toBe("approved_pending_owner_notice");
  expect(Object.keys(value).sort()).toEqual(["case","claimId","claimant","deadline","evidence","mode","notice","reviewRevision","state"]);
  expect(JSON.stringify(value)).not.toMatch(/ciphertext|wrapped|sha256|profileId|embryoId|assignmentRevision|synthetic@/iu);
 });
 it("keeps pending lookup errors, malformed envelopes, expired and noncurrent non-release reads closed",async()=>{
  for(const changed of [{...base,deadline:new Date(Date.now()-1).toISOString()},{...base,operation:"documentary",current:false},
   {...base,comparisonCiphertext:"0".repeat(200)},{...base,otherCandidate:ID}]){
   mocks.rpc.mockImplementation(async name=>name==="read_claim_review_case_v1"?{data:null,error:{code:"42501"}}:{data:changed,error:null});
   expect((await GET(new Request(`https://test.e2e.local/api/reviews/future-person/claims/${ID}`),{params:Promise.resolve({id:ID})})).status).toBe(404);
  }
  mocks.rpc.mockResolvedValue({data:null,error:{code:"XX000"}});
  expect((await GET(new Request(`https://test.e2e.local/api/reviews/future-person/claims/${ID}`),{params:Promise.resolve({id:ID})})).status).toBe(503);
  expect(mocks.rpc.mock.calls.at(-1)![0]).toBe("read_claim_review_case_v1");
 });

});
