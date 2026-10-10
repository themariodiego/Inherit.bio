import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls=vi.hoisted(()=>({own:vi.fn(),admin:vi.fn(),account:vi.fn()}));
vi.mock("@/lib/account-deletion",()=>({getSensitiveAccountContext:()=>calls.account()}));
vi.mock("@/lib/supabase/server",async()=>{const {createClient}=await import("@supabase/supabase-js");return {createClient:async()=>createClient("https://synthetic.invalid","own-synthetic-jwt",{
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
 const response=await calls.own(new URL(String(input)).pathname.split("/").at(-1),JSON.parse(String(init?.body)));return Response.json(response.error??response.data,{status:response.error?400:200});}}})};});
vi.mock("@/lib/supabase/admin",async()=>{const {createClient}=await import("@supabase/supabase-js");return {createAdminClient:()=>createClient("https://synthetic.invalid","service-synthetic-key",{
 auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
 const response=await calls.admin(new URL(String(input)).pathname.split("/").at(-1),JSON.parse(String(init?.body)));return Response.json(response.error??response.data,{status:response.error?400:200});}}})};});
import {GET,POST as casePOST} from "@/app/api/reviews/appeals/[id]/route";
import {POST} from "@/app/api/legal-evidence/[id]/review/route";
import {GET as noticeGET} from "@/app/api/appeals/session/decision/route";
import {sealNewAppeal} from "./appeal-case-envelope";
import {mintReviewNonce,reviewCsrf} from "./review";
import {sealAppealDecisionReference} from "./public-appeal-review";
import {mintAppealCaseReviewNonce} from "./public-appeal-case-decision";
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
const caseRow=()=>({...row(),contextVersion:"appeal-case-final-context-v1",documentDecisionsAvailable:true,allowedDecisions:["reject"]});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("BYOK_ENCRYPTION_KEY",Buffer.alloc(32,83).toString("base64"));vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS","1");calls.account.mockResolvedValue(account);});
afterEach(()=>vi.unstubAllEnvs());
const read=()=>new Request(`https://inherit.bio/api/reviews/appeals/${id(1)}`,{headers:{"sec-fetch-site":"same-origin"}});
function decide(extra:Record<string,unknown>={},headers:Record<string,string>={}){return new Request(`https://inherit.bio/api/legal-evidence/${id(4)}/review`,{method:"POST",headers:{
 origin:"https://inherit.bio","sec-fetch-site":"same-origin","content-type":"application/json","x-inherit-csrf":reviewCsrf(id(1),id(8),id(9)),...headers},body:JSON.stringify({
 decision:"rejected",documentSha256:"b".repeat(64),reviewRevision:1,nonce:mintReviewNonce(id(4),id(8),id(9)),reason:"The original whole document does not establish the claimed source control.",...extra})});}
describe("named own-JWT documentary review routes",()=>{
 it("checks the native exact row twice and serializes no wrapped key or target authority",async()=>{
 const r=caseRow();calls.own.mockResolvedValue({data:r,error:null});const response=await GET(read(),{params:Promise.resolve({id:id(1)})});
 expect(response.status).toBe(200);const body=await response.json();expect(body.targetBinding.state).toBe("unresolved");expect(JSON.stringify(body)).not.toContain(r.wrappedCaseKeyHex);
 expect(calls.own.mock.calls.map(c=>c[0])).toEqual(["read_public_appeal_case_context_v1","read_public_appeal_case_context_v1"]);expect(calls.admin).not.toHaveBeenCalled();
 expect(response.headers.get("x-inherit-document-nonces")).toBeTruthy();
 });
 it("refuses revocation during decryption instead of returning stale case fields",async()=>{
 calls.own.mockResolvedValueOnce({data:caseRow(),error:null}).mockResolvedValueOnce({data:null,error:{code:"42501"}});
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
describe("registered own-JWT final case rejection",()=>{
 function request(extra:Record<string,unknown>={},headers:Record<string,string>={}){return new Request(`https://inherit.bio/api/reviews/appeals/${id(1)}`,{
  method:"POST",headers:{origin:"https://inherit.bio","sec-fetch-site":"same-origin","content-type":"application/json",
   "x-inherit-csrf":reviewCsrf(id(1),id(8),id(9)),...headers},body:JSON.stringify({decision:"reject",reviewRevision:1,
   reason:"The current available record does not establish the claimed source control.",nonce:mintAppealCaseReviewNonce({caseId:id(1),accountId:id(8),sessionId:id(9),reviewRevision:1,evidenceRevision:1}),...extra})});}
 const receipt=()=>({caseId:id(1),state:"resolved",outcome:"rejected",reviewRevision:2});
 it("serves a current incomplete case for rejection without minting document approval controls",async()=>{
  calls.own.mockResolvedValue({data:{...caseRow(),documents:[],documentDecisionsAvailable:false},error:null});
  const response=await GET(read(),{params:Promise.resolve({id:id(1)})});expect(response.status).toBe(200);
  expect((await response.json()).evidence).toEqual([]);expect(response.headers.get("x-inherit-document-nonces")).toBe("{}");
  expect(response.headers.get("x-inherit-case-decisions")).toBe('["reject"]');expect(response.headers.get("x-inherit-case-review-nonce")).toBeTruthy();
 });
 it("passes only current native case/revisions and encrypted reason through the reviewer's own JWT",async()=>{
  calls.own.mockResolvedValueOnce({data:{...caseRow(),documents:[],documentDecisionsAvailable:false},error:null})
   .mockResolvedValueOnce({data:receipt(),error:null});
  const response=await casePOST(request(),{params:Promise.resolve({id:id(1)})});expect(response.status).toBe(200);expect(await response.json()).toEqual(receipt());
  expect(calls.own.mock.calls.map(call=>call[0])).toEqual(["read_public_appeal_case_context_v1","decide_public_appeal_case_v1"]);
  const args=calls.own.mock.calls[1]![1];expect(Object.keys(args).sort()).toEqual(["p_case","p_decision","p_evidence_revision","p_nonce_hash","p_reason_ciphertext","p_review_revision"]);
  expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/u);expect(args.p_reason_ciphertext).toMatch(/^\\x[0-9a-f]+$/u);
  expect(JSON.stringify(args)).not.toContain("available record");expect(calls.admin).not.toHaveBeenCalled();
 });
 it.each([{targetId:id(5)},{decision:"approve-access"},{decision:"needs-more-information"},{reviewRevision:2},{reason:"short"},{nonce:"foreign-bound-token"}])(
  "refuses broader/stale/wrong-purpose final input %j",async extra=>{
   calls.own.mockResolvedValue({data:caseRow(),error:null});expect((await casePOST(request(extra),{params:Promise.resolve({id:id(1)})})).status).toBe(404);
   expect(calls.own.mock.calls.some(call=>call[0]==="decide_public_appeal_case_v1")).toBe(false);expect(calls.admin).not.toHaveBeenCalled();
  });
 it("refuses a form issued before the native evidence revision changed",async()=>{
  calls.own.mockResolvedValue({data:{...caseRow(),evidenceRevision:2},error:null});
  expect((await casePOST(request(),{params:Promise.resolve({id:id(1)})})).status).toBe(404);expect(calls.own).toHaveBeenCalledTimes(1);
 });
 it.each<Record<string,string>>([{origin:"https://foreign.example.test"},{"x-inherit-csrf":"foreign"},{"sec-fetch-site":"cross-site"},{"content-type":"text/plain"}])(
  "refuses a foreign transport before any decision %j",async headers=>{
   calls.own.mockResolvedValue({data:caseRow(),error:null});expect((await casePOST(request({},headers),{params:Promise.resolve({id:id(1)})})).status).toBe(404);
   expect(calls.own.mock.calls.some(call=>call[0]==="decide_public_appeal_case_v1")).toBe(false);
  });
 it.each(["42501","23505"])("preserves native %s refusal without a success receipt or automatic retry",async code=>{
  calls.own.mockResolvedValueOnce({data:caseRow(),error:null}).mockResolvedValueOnce({data:null,error:{code,message:"appeal unavailable"}});
  expect((await casePOST(request(),{params:Promise.resolve({id:id(1)})})).status).toBe(404);expect(calls.own).toHaveBeenCalledTimes(2);
 });
 it("does not adopt an expanded or wrong-revision native completion",async()=>{
  calls.own.mockResolvedValueOnce({data:caseRow(),error:null}).mockResolvedValueOnce({data:{...receipt(),targetId:id(5)},error:null});
  expect((await casePOST(request(),{params:Promise.resolve({id:id(1)})})).status).toBe(503);
 });
 it("keeps final disposition disabled before parsing or RPC",async()=>{
  vi.stubEnv("INHERIT_TEST_REQUESTER_STATEMENTS","0");expect((await casePOST(request(),{params:Promise.resolve({id:id(1)})})).status).toBe(404);expect(calls.own).not.toHaveBeenCalled();
 });
});

describe("native current prior decision uphold", () => {
 function currentPrior() {
  const nextScope = { ...scope, intakeKind: "access-or-review-appeal" };
  const encrypted = sealNewAppeal(nextScope, { kind: "access-or-review-appeal", claimantName: "Synthetic Claimant",
   contactEmail: "synthetic@example.test", decisionReference: "synthetic genuine prior reference",
   statement: "This original request asks for review of an actual earlier documentary choice.", affirmed: true });
  const { format, ...sealed } = encrypted; void format;
  return { ...caseRow(), caseKind: "access-or-review-appeal", scope: nextScope, ...sealed,
   priorDecision: { decisionId: id(11), sourceCaseId: id(12), decisionRevision: 3, evidenceRevision: 1,
    sourceReviewerPrincipalId: id(13), decisionReferenceHash: "c".repeat(64), requiredAuthorityKind: "appeal-subject-source-control",
    decisionKind: "subject-source-control-review-rejection", sourceDeadline: scope.originalDeadline },
   allowedDecisions: ["reject", "uphold"], documents: [...row().documents.map(doc => ({ ...doc, decision: "approved" })),
    { documentId: id(5), documentKind: "appeal-decision-notice", sha256: "c".repeat(64), decision: "approved" }] };
 }
 function request(extra: Record<string, unknown> = {}) {
  return new Request(`https://inherit.bio/api/reviews/appeals/${id(1)}`, { method: "POST", headers: {
   origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
   "x-inherit-csrf": reviewCsrf(id(1), id(8), id(9)) }, body: JSON.stringify({ decision: "uphold", reviewRevision: 1,
   reason: "The full current record supports keeping the earlier documentary choice.", nonce: mintAppealCaseReviewNonce({
    caseId: id(1), accountId: id(8), sessionId: id(9), reviewRevision: 1, evidenceRevision: 1 }), ...extra }) });
 }
 it("returns the closed upheld receipt through own JWT with no client prior/target selector", async () => {
  calls.own.mockResolvedValueOnce({ data: currentPrior(), error: null }).mockResolvedValueOnce({ data: {
   caseId: id(1), state: "resolved", outcome: "upheld", reviewRevision: 2 }, error: null });
  const response = await casePOST(request(), { params: Promise.resolve({ id: id(1) }) });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ caseId: id(1), state: "resolved", outcome: "upheld", reviewRevision: 2 });
  expect(calls.own.mock.calls[1]![0]).toBe("decide_public_appeal_case_v1");
  const args = calls.own.mock.calls[1]![1]; expect(args.p_decision).toBe("uphold");
  expect(Object.keys(args).sort()).toEqual(["p_case", "p_decision", "p_evidence_revision", "p_nonce_hash", "p_reason_ciphertext", "p_review_revision"]);
  expect(JSON.stringify(args)).not.toContain("full current record"); expect(calls.admin).not.toHaveBeenCalled();
 });
 it("offers uphold only after a second equal native current-context read without exposing source details", async () => {
  calls.own.mockResolvedValue({ data: currentPrior(), error: null });
  const response = await GET(read(), { params: Promise.resolve({ id: id(1) }) });
  expect(response.status).toBe(200); expect(response.headers.get("x-inherit-case-decisions")).toBe('["reject","uphold"]');
  expect(JSON.stringify(await response.json())).not.toContain(id(11)); expect(calls.own).toHaveBeenCalledTimes(2);
 });
 it.each(["not-offered", "pending", "missing-prior", "foreign-source"])("refuses %s before any disposition", async state => {
  const raw = currentPrior(); calls.own.mockResolvedValue({ data: state === "not-offered" ? { ...raw, allowedDecisions: ["reject"] }
   : state === "pending" ? { ...raw, documents: [{ ...raw.documents[0], decision: null }, ...raw.documents.slice(1)] }
    : state === "missing-prior" ? { ...raw, priorDecision: null } : { ...raw, priorDecision: { ...raw.priorDecision, sourceCaseId: id(1) } }, error: null });
  expect((await casePOST(request(), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404);
  expect(calls.own.mock.calls.some(call => call[0] === "decide_public_appeal_case_v1")).toBe(false);
 });
 it.each(["42501", "23505"])("keeps native stale/replay %s opaque without another call", async code => {
  calls.own.mockResolvedValueOnce({ data: currentPrior(), error: null }).mockResolvedValueOnce({ data: null, error: { code } });
  expect((await casePOST(request(), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404);
  expect(calls.own).toHaveBeenCalledTimes(2); expect(calls.admin).not.toHaveBeenCalled();
 });
 it.each([{ priorDecisionId: id(11) }, { targetId: id(12) }, { decision: "reverse-prior-decision" }, { decision: "approve-access" }])(
  "refuses client retargeting or an unimplemented disposition %j", async extra => {
   calls.own.mockResolvedValue({ data: currentPrior(), error: null });
   expect((await casePOST(request(extra), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404); expect(calls.own).not.toHaveBeenCalled();
  });
});
describe("native append-only prior correction", () => {
 function currentReversal() {
  const nextScope = { ...scope, intakeKind: "access-or-review-appeal" };
  const encrypted = sealNewAppeal(nextScope, { kind: "access-or-review-appeal", claimantName: "Synthetic Claimant",
   contactEmail: "synthetic@example.test", decisionReference: "synthetic genuine prior reference",
   statement: "This original request asks for review of an actual earlier documentary choice.", affirmed: true });
  const { format, ...sealed } = encrypted; void format;
  return { ...caseRow(), caseKind: "access-or-review-appeal", scope: nextScope, ...sealed,
   priorDecision: { decisionId: id(11), sourceCaseId: id(12), decisionRevision: 3, evidenceRevision: 1,
    sourceReviewerPrincipalId: id(13), decisionReferenceHash: "c".repeat(64), requiredAuthorityKind: "appeal-subject-source-control",
    decisionKind: "subject-source-control-review-rejection", sourceDeadline: scope.originalDeadline },
   allowedDecisions: ["reject", "uphold", "reverse-prior-decision", "needs-more-information"], documents: [...row().documents.map(doc => ({ ...doc, decision: "approved" })),
    { documentId: id(5), documentKind: "appeal-decision-notice", sha256: "c".repeat(64), decision: "approved" }] };
 }
 function request(extra: Record<string, unknown> = {}) {
  return new Request(`https://inherit.bio/api/reviews/appeals/${id(1)}`, { method: "POST", headers: {
   origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
   "x-inherit-csrf": reviewCsrf(id(1), id(8), id(9)) }, body: JSON.stringify({ decision: "reverse-prior-decision", priorDecisionRevision: 3, evidenceRevision: 1, reviewRevision: 1,
   reason: "The full current record supports changing only the earlier documentary choice.", nonce: mintAppealCaseReviewNonce({
    caseId: id(1), accountId: id(8), sessionId: id(9), reviewRevision: 1, evidenceRevision: 1 }), ...extra }) });
 }
 it("returns the exact correction receipt through own JWT with only registered revision fields", async () => {
  calls.own.mockResolvedValueOnce({ data: currentReversal(), error: null }).mockResolvedValueOnce({ data: {
   caseId: id(1), state: "resolved", outcome: "prior_decision_reversed", reviewRevision: 2 }, error: null });
  const response = await casePOST(request(), { params: Promise.resolve({ id: id(1) }) });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ caseId: id(1), state: "resolved", outcome: "prior_decision_reversed", reviewRevision: 2 });
  expect(calls.own.mock.calls[1]![0]).toBe("reverse_public_appeal_prior_decision_v1");
  const args = calls.own.mock.calls[1]![1]; expect(args.p_decision).toBeUndefined();
  expect(Object.keys(args).sort()).toEqual(["p_case", "p_evidence_revision", "p_nonce_hash", "p_prior_decision_revision", "p_reason_ciphertext", "p_review_revision"]);
  expect(JSON.stringify(args)).not.toContain("full current record"); expect(calls.admin).not.toHaveBeenCalled();
 });
 it("offers correction only after a second equal native current-context read without exposing source details", async () => {
  calls.own.mockResolvedValue({ data: currentReversal(), error: null });
  const response = await GET(read(), { params: Promise.resolve({ id: id(1) }) });
  expect(response.status).toBe(200); expect(response.headers.get("x-inherit-case-reversal")).toBe('{"priorDecisionRevision":3,"evidenceRevision":1}'); expect(response.headers.get("x-inherit-case-decisions")).toBe('["reject","uphold","reverse-prior-decision","needs-more-information"]');
  expect(JSON.stringify(await response.json())).not.toContain(id(11)); expect(calls.own).toHaveBeenCalledTimes(2);
 });
 it.each(["not-offered", "pending", "missing-prior", "foreign-source"])("refuses %s before any disposition", async state => {
  const raw = currentReversal(); calls.own.mockResolvedValue({ data: state === "not-offered" ? { ...raw, allowedDecisions: ["reject"] }
   : state === "pending" ? { ...raw, documents: [{ ...raw.documents[0], decision: null }, ...raw.documents.slice(1)] }
    : state === "missing-prior" ? { ...raw, priorDecision: null } : { ...raw, priorDecision: { ...raw.priorDecision, sourceCaseId: id(1) } }, error: null });
  expect((await casePOST(request(), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404);
  expect(calls.own.mock.calls.some(call => call[0] === "reverse_public_appeal_prior_decision_v1")).toBe(false);
 });
 it.each(["42501", "23505"])("keeps native stale/replay %s opaque without another call", async code => {
  calls.own.mockResolvedValueOnce({ data: currentReversal(), error: null }).mockResolvedValueOnce({ data: null, error: { code } });
  expect((await casePOST(request(), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404);
  expect(calls.own).toHaveBeenCalledTimes(2); expect(calls.admin).not.toHaveBeenCalled();
 });
 it.each([{ priorDecisionId: id(11) }, { targetId: id(12) }, { recipient: "foreign@example.test" }, { decision: "approve-access" }])(
  "refuses client retargeting or an unimplemented disposition %j", async extra => {
   calls.own.mockResolvedValue({ data: currentReversal(), error: null });
   expect((await casePOST(request(extra), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404); expect(calls.own).not.toHaveBeenCalled();
  });
 it.each([{ priorDecisionRevision: 4 }, { evidenceRevision: 2 }, { priorDecisionRevision: undefined }, { evidenceRevision: undefined }])(
  "refuses a stale or missing registered source/evidence revision %j", async extra => {
   calls.own.mockResolvedValue({ data: currentReversal(), error: null });
   expect((await casePOST(request(extra), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404);
   expect(calls.own.mock.calls.some(call => call[0] === "reverse_public_appeal_prior_decision_v1")).toBe(false);
  });
 it("does not adopt an expanded or target-authorizing native correction receipt", async () => {
  calls.own.mockResolvedValueOnce({ data: currentReversal(), error: null }).mockResolvedValueOnce({ data: {
   caseId: id(1), state: "resolved", outcome: "prior_decision_reversed", reviewRevision: 2, revivedKey: "forbidden" }, error: null });
  expect((await casePOST(request(), { params: Promise.resolve({ id: id(1) }) })).status).toBe(503);
 });
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

describe("nonfinal information request through own current review authority", () => {
 function request(extra: Record<string, unknown> = {}) {
  return new Request(`https://inherit.bio/api/reviews/appeals/${id(1)}`, { method: "POST", headers: {
   origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
   "x-inherit-csrf": reviewCsrf(id(1), id(8), id(9)), }, body: JSON.stringify({ decision: "needs-more-information", reviewRevision: 1,
    reason: "The available files do not yet show the required original source control.", nonce: mintAppealCaseReviewNonce({ caseId: id(1),
     accountId: id(8), sessionId: id(9), reviewRevision: 1, evidenceRevision: 1 }), ...extra }) });
 }
 const current = () => ({ ...caseRow(), documents: [], documentDecisionsAvailable: false, allowedDecisions: ["reject", "needs-more-information"] });
 const receipt = () => ({ caseId: id(1), state: "more_information_required", outcome: "more_information_required", reviewRevision: 2 });
 it("uses the same native case/revisions and seals the reason without sending recipient/target/deadline selectors", async () => {
  calls.own.mockResolvedValueOnce({ data: current(), error: null }).mockResolvedValueOnce({ data: receipt(), error: null });
  const response = await casePOST(request(), { params: Promise.resolve({ id: id(1) }) });expect(response.status).toBe(200);
  expect(await response.json()).toEqual(receipt());expect(calls.admin).not.toHaveBeenCalled();
  const [name, args] = calls.own.mock.calls[1]!;expect(name).toBe("decide_public_appeal_case_v1");
  expect(Object.keys(args).sort()).toEqual(["p_case", "p_decision", "p_evidence_revision", "p_nonce_hash", "p_reason_ciphertext", "p_review_revision"]);
  expect(args.p_decision).toBe("needs-more-information");expect(args.p_reason_ciphertext).toMatch(/^\\x[0-9a-f]+$/u);
  expect(JSON.stringify(args)).not.toContain("available files");
 });
 it.each([{ reviewRevision: 2 }, { nonce: "foreign-current-form" }, { recipient: "foreign@example.test" }, { deadline: scope.originalDeadline }, { targetId: id(5) }])(
  "refuses stale or client-selected authority %j before native mutation", async extra => {
   calls.own.mockResolvedValue({ data: current(), error: null });
   expect((await casePOST(request(extra), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404);
   expect(calls.own.mock.calls.some(call => call[0] === "decide_public_appeal_case_v1")).toBe(false);
  });
 it("refuses an expired original case even when a request form was just rendered", async () => {
  const expired = new Date(Date.now() - 1000).toISOString();
  calls.own.mockResolvedValue({ data: { ...current(), deadline: expired, scope: { ...scope, originalDeadline: expired } }, error: null });
  expect((await casePOST(request(), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404);
  expect(calls.own.mock.calls.some(call => call[0] === "decide_public_appeal_case_v1")).toBe(false);
 });
 it.each(["42501", "23505"])("retains native %s failure with no retry or issued receipt", async code => {
  calls.own.mockResolvedValueOnce({ data: current(), error: null }).mockResolvedValueOnce({ data: null, error: { code } });
  expect((await casePOST(request(), { params: Promise.resolve({ id: id(1) }) })).status).toBe(404);expect(calls.own).toHaveBeenCalledTimes(2);
 });
 it("does not adopt a final/expanded or wrong-state receipt for this nonfinal branch", async () => {
  calls.own.mockResolvedValueOnce({ data: current(), error: null }).mockResolvedValueOnce({ data: { ...receipt(), state: "resolved" }, error: null });
  expect((await casePOST(request(), { params: Promise.resolve({ id: id(1) }) })).status).toBe(503);
 });
});
