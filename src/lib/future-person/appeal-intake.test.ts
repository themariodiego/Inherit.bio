import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const admin=vi.hoisted(()=>({rpc:vi.fn()}));
const own=vi.hoisted(()=>({rpc:vi.fn()}));
// Keep the original native-result fixtures and every original assertion.
// Execute the real installed Supabase/PostgREST cold builder, retry setting,
// AbortSignal forwarding and JSON wire shape against this local fetch seam.
// This is not native ownership/currentness or a real authenticated JWT proof.
vi.mock("@/lib/supabase/admin",async()=>{
 const {createClient}=await import("@supabase/supabase-js");
 return {createAdminClient:()=>createClient("https://synthetic.invalid","synthetic-key",{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
   const result=await admin.rpc(new URL(String(input)).pathname.split("/").at(-1),JSON.parse(String(init?.body)));
   return Response.json(result.error??result.data,{status:result.error?400:200});
  }}})};
});
vi.mock("@/lib/supabase/server",async()=>{
 const {createClient}=await import("@supabase/supabase-js");
 return {createClient:async()=>createClient("https://synthetic.invalid","synthetic-own-jwt",{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
   const result=await own.rpc(new URL(String(input)).pathname.split("/").at(-1),JSON.parse(String(init?.body)));
   return Response.json(result.error??result.data,{status:result.error?400:200});
  }}})};
});
vi.mock("@/lib/rate-limit-keys",()=>({networkBucketDigests:()=>({"1":"c".repeat(64)})}));
import {postNewAppeal} from "./appeal-intake";
import {mintAppealForm} from "./appeal-form";
import {appealKeyedDigests} from "./appeal-keyed-digests";
import {appealIntakeBody,appealIntakeDigest,openNewAppealForReviewer} from "./appeal-case-envelope";
const id=(n:number)=>`84000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const base={kind:"subject-objection",claimantName:"Synthetic Claimant",contactEmail:"synthetic@example.test",
 statement:"This is a synthetic own appeal statement for the test service.",affirmed:true};
function request(body:unknown){const form=mintAppealForm();return new Request("https://inherit.example.test/api/appeals",{method:"POST",
 headers:{origin:"https://inherit.example.test","sec-fetch-site":"same-origin","content-type":"application/json",
  "x-inherit-csrf":form.formToken,cookie:form.setCookie.split(";")[0]!},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,83).toString("base64"));
 vi.stubEnv("NEXT_PUBLIC_APP_URL","https://inherit.example.test");vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS","1");
 vi.stubEnv("INHERIT_HMAC_KEYRING","");});afterEach(()=>vi.unstubAllEnvs());
// Real route/parser/crypto executes; native currentness and transaction writes
// are deliberately not claimed by the local RPC transport seam.
describe("NEW public appeal POST uses one closed encrypted intake transaction",()=>{
 it.each(["subject-objection","genetic-parent-objection","access-or-review-appeal"])("seals the complete original %s package without target lookup",async kind=>{
  const body=appealIntakeBody.parse({...base,kind,...(kind==="access-or-review-appeal"?{decisionReference:"a".repeat(48)}:{})});let scope:unknown;
  admin.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==="prepare_new_public_appeal_v1"){
    const now=new Date(),deadline=new Date(now.getTime()+30*86400_000);
    scope={version:1,caseKind:"appeal",caseId:id(1),originalAuthorPrincipalId:id(2),initialStatementRevision:1,
     originalSubmittedAt:now.toISOString(),originalDeadline:deadline.toISOString(),intakeKind:kind};
    return {error:null,data:{frame:{version:"new-appeal-public-intake-native-v1",scope,
     reviewer:{principalId:id(3),principalRevision:2,purposeRevision:4},assignmentRevision:1,prepareExpiresAt:new Date(now.getTime()+30_000).toISOString(),
     caseContactId:id(4),payloadDigest:appealIntakeDigest(body),formNonceHash:args.p_form_nonce_hash,
     contactDigests:appealKeyedDigests("contact",body.kind==="contradiction-suspension-appeal"?"":body.contactEmail),
     identifierDigests:appealKeyedDigests("rate-limit",`api.subject-access-request|normalized-identifier|${base.contactEmail}`),
     networkDigests:{"1":"c".repeat(64)},...(kind==="access-or-review-appeal"?{underlyingDecision:{decisionId:id(5),sourceCaseId:id(6),decisionRevision:2,evidenceRevision:2,
      sourceReviewerPrincipalId:id(7),decisionReferenceHash:await import("node:crypto").then(({default:c})=>c.createHash("sha256").update("a".repeat(48)).digest("hex")),
      requiredAuthorityKind:"appeal-subject-source-control",decisionKind:"subject-source-control-review-rejection",sourceDeadline:deadline.toISOString()}}:{})},signature:"d".repeat(64)}};
   }
   if(name==="commit_new_public_appeal_v1")return {error:null,data:true};throw new Error("unexpected operation");
  });
  const response=await postNewAppeal(request(body));expect(response.status).toBe(202);expect(await response.json()).toEqual({status:"received"});
  expect(admin.rpc.mock.calls.map(call=>call[0])).toEqual(["prepare_new_public_appeal_v1","commit_new_public_appeal_v1"]);expect(own.rpc).not.toHaveBeenCalled();
  const commit=admin.rpc.mock.calls[1]![1] as Record<string,string>;
  const decode=(key:string)=>{expect(commit[key]?.slice(0,2)).toBe("\\x");return commit[key]!.slice(2);};
  expect(openNewAppealForReviewer(scope,{format:"reviewer-only-case-statement-v1",wrappedCaseKeyHex:decode("p_wrapped_key"),
   statementCiphertextHex:decode("p_statement"),workingCiphertextHex:decode("p_working"),contactCiphertextHex:decode("p_contact")}))
   .toEqual({version:1,intake:body,recipient:base.contactEmail});
  expect(JSON.stringify(commit)).not.toContain(base.statement);expect(JSON.stringify(commit)).not.toContain(base.contactEmail);
 });
 it.each(["absent","foreign-reference","same-reviewer","expired","wrong-kind","extra-authority"])("refuses %s underlying decision before encrypted commit",async defect=>{
  const body=appealIntakeBody.parse({...base,kind:"access-or-review-appeal",decisionReference:"a".repeat(48)});
  admin.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name!=="prepare_new_public_appeal_v1")throw new Error("unexpected commit");
   const now=new Date(),deadline=new Date(now.getTime()+30*86400_000).toISOString();
   const underlying:Record<string,unknown>={decisionId:id(5),sourceCaseId:id(6),decisionRevision:2,evidenceRevision:2,
    sourceReviewerPrincipalId:id(7),decisionReferenceHash:await import("node:crypto").then(({default:c})=>c.createHash("sha256").update("a".repeat(48)).digest("hex")),
    requiredAuthorityKind:"appeal-subject-source-control",decisionKind:"subject-source-control-review-rejection",sourceDeadline:deadline};
   if(defect==="foreign-reference")underlying.decisionReferenceHash="b".repeat(64);
   if(defect==="same-reviewer")underlying.sourceReviewerPrincipalId=id(3);
   if(defect==="expired")underlying.sourceDeadline=new Date(now.getTime()-1000).toISOString();
   if(defect==="wrong-kind")underlying.decisionKind="genetic-parent-authority-review-rejection";
   if(defect==="extra-authority")underlying.targetAccountId=id(8);
   return {error:null,data:{signature:"d".repeat(64),frame:{version:"new-appeal-public-intake-native-v1",
    scope:{version:1,caseKind:"appeal",caseId:id(1),originalAuthorPrincipalId:id(2),initialStatementRevision:1,
     originalSubmittedAt:now.toISOString(),originalDeadline:deadline,intakeKind:body.kind},reviewer:{principalId:id(3),principalRevision:2,purposeRevision:4},
    assignmentRevision:1,prepareExpiresAt:new Date(now.getTime()+30_000).toISOString(),caseContactId:id(4),payloadDigest:appealIntakeDigest(body),
    formNonceHash:args.p_form_nonce_hash,contactDigests:{"1":"c".repeat(64)},identifierDigests:{"1":"c".repeat(64)},networkDigests:{"1":"c".repeat(64)},
    ...(defect==="absent"?{}:{underlyingDecision:underlying})}}};
  });
  const response=await postNewAppeal(request(body));expect(response.status).toBe(202);expect(await response.json()).toEqual({status:"received"});
  expect(admin.rpc.mock.calls.map(call=>call[0])).toEqual(["prepare_new_public_appeal_v1"]);expect(own.rpc).not.toHaveBeenCalled();
 });
 it("uses the caller's own JWT for suspension and creates no public case when the true origin is absent",async()=>{
  own.rpc.mockResolvedValue({error:{code:"0A000"},data:null});const response=await postNewAppeal(request({kind:"contradiction-suspension-appeal",
   claimantName:base.claimantName,statement:base.statement,affirmed:true,suspensionNoticeReference:"syntheticNoticeReference123",nonce:"synthetic-operation-token"}));
  expect(response.status).toBe(404);expect(await response.json()).toEqual({error:"not_found"});expect(admin.rpc).not.toHaveBeenCalled();
  expect(own.rpc).toHaveBeenCalledTimes(1);expect(own.rpc.mock.calls[0]![0]).toBe("prepare_new_suspension_appeal_v1");
 });
 it("refuses extra target/contact authority and performs no RPC",async()=>{
  const response=await postNewAppeal(request({...base,subjectId:id(9)}));expect(response.status).toBe(422);
  expect(admin.rpc).not.toHaveBeenCalled();expect(own.rpc).not.toHaveBeenCalled();
 });
 it("returns the identical opaque shape on missing native configuration",async()=>{
  admin.rpc.mockResolvedValue({error:{code:"55000"},data:null});const response=await postNewAppeal(request(base));
  expect(response.status).toBe(202);expect(await response.json()).toEqual({status:"received"});expect(admin.rpc).toHaveBeenCalledTimes(1);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
 });
 it("refuses the TEST-closed route before reading content or calling the database",async()=>{
  vi.stubEnv("INHERIT_TEST_JURISDICTION","0");const response=await postNewAppeal(request(base));expect(response.status).toBe(404);
  expect(admin.rpc).not.toHaveBeenCalled();expect(own.rpc).not.toHaveBeenCalled();
 });
});
