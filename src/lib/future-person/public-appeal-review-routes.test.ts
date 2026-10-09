import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls=vi.hoisted(()=>({own:vi.fn(),admin:vi.fn(),account:vi.fn()}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:()=>calls.account()}));
vi.mock("@/lib/supabase/server",async()=>{const {createClient}=await import("@supabase/supabase-js");return {createClient:async()=>createClient("https://synthetic.invalid","own-synthetic-jwt",{
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
 const response=await calls.own(new URL(String(input)).pathname.split("/").at(-1),JSON.parse(String(init?.body)));return Response.json(response.error??response.data,{status:response.error?400:200});}}})};});
vi.mock("@/lib/supabase/admin",async()=>{const {createClient}=await import("@supabase/supabase-js");return {createAdminClient:()=>createClient("https://synthetic.invalid","service-synthetic-key",{
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
 const response=await calls.admin(new URL(String(input)).pathname.split("/").at(-1),JSON.parse(String(init?.body)));return Response.json(response.error??response.data,{status:response.error?400:200});}}})};});
import {GET} from "@/app/api/reviews/appeals/[id]/route";
import {POST} from "@/app/api/legal-evidence/[id]/review/route";
import {GET as noticeGET} from "@/app/api/appeals/session/decision/route";
import {sealNewAppeal} from "./appeal-case-envelope";
import {mintReviewNonce,reviewCsrf} from "./review";
import {sealAppealDecisionReference} from "./public-appeal-review";
import {RIGHTS_COOKIE_NAME} from "@/lib/embryos/rights-session";
const id=(n:number)=>`84000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope={version:1,caseKind:"appeal",caseId:id(1),originalAuthorPrincipalId:id(2),initialStatementRevision:1,
 originalSubmittedAt:new Date().toISOString(),originalDeadline:new Date(Date.now()+30*86400000).toISOString(),intakeKind:"subject-objection"};
function row(){const e=sealNewAppeal(scope,{kind:"subject-objection",claimantName:"Synthetic Claimant",contactEmail:"synthetic@example.test",
 statement:"The complete original synthetic appeal statement is here.",affirmed:true});
 return {caseId:id(1),caseKind:"subject-objection",scope,reviewRevision:1,evidenceRevision:1,deadline:scope.originalDeadline,
 wrappedCaseKeyHex:e.wrappedCaseKeyHex,workingCiphertextHex:e.workingCiphertextHex,statementCiphertextHex:e.statementCiphertextHex,contactCiphertextHex:e.contactCiphertextHex,
 documents:[{documentId:id(3),documentKind:"appeal-photo-identity",sha256:"a".repeat(64),decision:null},{documentId:id(4),documentKind:"appeal-subject-source-control",sha256:"b".repeat(64),decision:null}]};}
const account={user:{id:id(8)},sessionId:id(9)};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,83).toString("base64"));vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS","1");calls.account.mockResolvedValue(account);});
afterEach(()=>vi.unstubAllEnvs());
const read=()=>new Request(`https://inherit.bio/api/reviews/appeals/${id(1)}`,{headers:{"sec-fetch-site":"same-origin"}});
function decide(extra:Record<string,unknown>={},headers:Record<string,string>={}){return new Request(`https://inherit.bio/api/legal-evidence/${id(4)}/review`,{method:"POST",headers:{
 origin:"https://inherit.bio","sec-fetch-site":"same-origin","content-type":"application/json","x-inherit-csrf":reviewCsrf(id(1),id(8),id(9)),...headers},body:JSON.stringify({
 decision:"rejected",documentSha256:"b".repeat(64),reviewRevision:1,nonce:mintReviewNonce(id(4),id(8),id(9)),reason:"The original whole document does not establish the claimed source control.",...extra})});}
describe("named own-JWT documentary review routes",()=>{
 it("checks the native exact row twice and serializes no wrapped key or target authority",async()=>{
 const r=row();calls.own.mockResolvedValue({data:r,error:null});const response=await GET(read(),{params:Promise.resolve({id:id(1)})});
 expect(response.status).toBe(200);const body=await response.json();expect(body.targetBinding.state).toBe("unresolved");expect(JSON.stringify(body)).not.toContain(r.wrappedCaseKeyHex);
 expect(calls.own.mock.calls.map(c=>c[0])).toEqual(["read_public_appeal_review_v1","read_public_appeal_review_v1"]);expect(calls.admin).not.toHaveBeenCalled();
 expect(response.headers.get("x-inherit-document-nonces")).toBeTruthy();
 });
 it("refuses revocation during decryption instead of returning stale case fields",async()=>{
 calls.own.mockResolvedValueOnce({data:row(),error:null}).mockResolvedValueOnce({data:null,error:{code:"42501"}});
 expect((await GET(read(),{params:Promise.resolve({id:id(1)})})).status).toBe(404);expect(calls.admin).not.toHaveBeenCalled();
 });
 it("saves a doc-bound encrypted reason/reference through own JWT and returns only the closed decision receipt",async()=>{
 calls.own.mockResolvedValueOnce({data:row(),error:null}).mockResolvedValueOnce({data:{documentId:id(4),decision:"rejected",reviewRevision:2},error:null});
 const response=await POST(decide(),{params:Promise.resolve({id:id(4)})});expect(response.status).toBe(200);
 expect(await response.json()).toEqual({documentId:id(4),status:"reviewed",decision:"rejected",reviewRevision:2});
 expect(calls.own.mock.calls[1]![0]).toBe("decide_public_appeal_document_v1");const args=calls.own.mock.calls[1]![1];
 expect(args.p_reference_hash).toMatch(/^[0-9a-f]{64}$/u);expect(args.p_reference_ciphertext).toMatch(/^\\x[0-9a-f]{152}$/u);
 expect(JSON.stringify(args)).not.toContain("original whole document");expect(calls.admin).not.toHaveBeenCalled();
 });
 it.each([{targetId:id(5)},{decision:"approve-access"},{reviewRevision:2},{documentSha256:"a".repeat(64)},{nonce:"foreign-bound-token"}])(
 "refuses broader/stale/wrong-bound decision %j",async extra=>{
 calls.own.mockResolvedValue({data:row(),error:null});expect((await POST(decide(extra),{params:Promise.resolve({id:id(4)})})).status).toBe(404);
 expect(calls.own.mock.calls.some(c=>c[0]==="decide_public_appeal_document_v1")).toBe(false);expect(calls.admin).not.toHaveBeenCalled();
 });
 it("keeps default config closed before own native read",async()=>{vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS","0");
 expect((await GET(read(),{params:Promise.resolve({id:id(1)})})).status).toBe(404);expect(calls.own).not.toHaveBeenCalled();});
});
describe("verified case notice route",()=>{
 const request=()=>new Request("https://inherit.bio/api/appeals/session/decision",{headers:{"sec-fetch-site":"same-origin",cookie:`${RIGHTS_COOKIE_NAME}=${"A".repeat(43)}`}});
 it("opens only the exact native case-bound encrypted reference and excludes notes",async()=>{
 const r=row(),nonce="d".repeat(64),reference=sealAppealDecisionReference(r.wrappedCaseKeyHex,id(1),id(4),nonce);
 calls.admin.mockResolvedValue({error:null,data:{scope,wrappedCaseKeyHex:r.wrappedCaseKeyHex,decisions:[{documentId:id(4),documentKind:"appeal-subject-source-control",decision:"rejected",nonceHash:nonce,
 referenceCiphertextHex:reference.ciphertext.slice(2),referenceHash:reference.hash}]}});
 const response=await noticeGET(request());expect(response.status).toBe(200);const body=await response.json();expect(body.decisions[0].decisionReference).toMatch(/^[0-9a-f]{48}$/u);
 expect(Object.keys(body)).toEqual(["deadline","decisions"]);expect(calls.own).not.toHaveBeenCalled();expect(response.headers.get("cache-control")).toContain("no-store");
 });
 it("does not adopt expired/foreign native authority or an expanded plaintext projection",async()=>{
 calls.admin.mockResolvedValueOnce({data:null,error:null});expect((await noticeGET(request())).status).toBe(404);
 calls.admin.mockResolvedValueOnce({data:{scope,wrappedCaseKeyHex:row().wrappedCaseKeyHex,decisions:[],reviewerNotes:"private"},error:null});
 expect((await noticeGET(request())).status).toBe(503);
 });
});
