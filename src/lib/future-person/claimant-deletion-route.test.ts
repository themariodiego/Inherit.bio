import crypto from "node:crypto";
import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
const service=vi.hoisted(()=>({configured:vi.fn(),complete:vi.fn(),rpc:vi.fn(),ready:vi.fn()}));
vi.mock("./claimant-deletion-test",()=>({configuredTestClaimantDeletion:service.configured}));
vi.mock("./claimant-deletion",()=>({completeClaimantDeletion:service.complete}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:service.rpc})}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
const {RIGHTS_COOKIE_NAME,rightsSessionHash}=await import("@/lib/embryos/rights-session");
const {mintPublicFormToken,readPublicFormToken}=await import("@/lib/embryos/operation-token");
const {claimantCsrf}=await import("./rights");
const {DELETE}=await import("@/app/api/future-person/claim/session/route");
const {presentClaimantDeletion}=await import("./claimant-deletion-presentation");
const secret=crypto.randomBytes(32).toString("base64url"),hash=rightsSessionHash(secret),cookie=`${RIGHTS_COOKIE_NAME}=${secret}`;
const execution={assertReady:service.ready};
const nonce=()=>mintPublicFormToken("future-person-delete",Date.now(),hash);
function request(headers:Record<string,string>={},path="/api/future-person/claim/session",body?:string){
 return new Request(`https://example.test${path}`,{method:"DELETE",headers:{cookie,origin:"https://example.test","sec-fetch-site":"same-origin",
  "x-inherit-csrf":claimantCsrf(hash),"x-inherit-operation-nonce":nonce(),...headers},...(body===undefined?{}:{body})});
}
beforeEach(()=>{
 vi.clearAllMocks();service.configured.mockReturnValue(execution);service.ready.mockResolvedValue(undefined);
 service.complete.mockResolvedValue({status:"deletion_accepted"});
 service.rpc.mockResolvedValue({data:{safeClaimedSubjectLabel:"Your claimed record",lifecycleState:"claimed_unbound",retentionMaximumDays:null,allowedActionIds:["delete"]},error:null});
});
afterAll(()=>vi.unstubAllEnvs());
describe("registered one-use claimant DELETE and presentation",()=>{
 it("uses only the verified claimant hash/native nonce and waits for exact full executor completion",async()=>{
  const token=nonce(),r=request({"x-inherit-operation-nonce":token});let release!:(value:unknown)=>void;
  service.complete.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));let returned=false;
  const pending=DELETE(r).then(value=>{returned=true;return value;});for(let turn=0;turn<5;turn++)await Promise.resolve();
  expect(returned).toBe(false);expect(service.complete).toHaveBeenCalledTimes(1);
  expect(service.complete.mock.calls[0][0]).toEqual({execution,sessionHash:hash,nonce:readPublicFormToken(token,"future-person-delete",Date.now(),hash)!.nonce,
   operationNonce:readPublicFormToken(token,"future-person-delete",Date.now(),hash)!.nonce,signal:r.signal});
  release({status:"deletion_accepted"});const result=await pending;expect(result.status).toBe(202);expect(await result.json()).toEqual({status:"deletion_accepted"});
  expect(result.headers.get("cache-control")).toBe("private, no-store");expect(result.headers.get("referrer-policy")).toBe("no-referrer");
 });
 it.each([{cookie:""},{cookie:`${cookie}; ${cookie}`},{cookie:`${RIGHTS_COOKIE_NAME}=${crypto.randomBytes(32).toString("base64url")}`},
  {origin:"https://foreign.test"},{"sec-fetch-site":"cross-site"},{"x-inherit-csrf":"c".repeat(64)},
  {"x-inherit-operation-nonce":mintPublicFormToken("future-person-analysis-stop",Date.now(),hash)},
  {"x-inherit-operation-nonce":"x".repeat(2049)}])("refuses crossed/missing destructive control %j before service discovery",async headers=>{
  expect((await DELETE(request(headers))).status).toBe(404);expect(service.configured).not.toHaveBeenCalled();expect(service.complete).not.toHaveBeenCalled();
 });
 it.each([request({},"/api/future-person/claim/session?subjectId=forbidden"),request({},undefined,"{}"),request({"content-length":"1"}),request({"transfer-encoding":"chunked"})])("refuses query/body/declared bytes/transfer encoding without any deletion work",async r=>{
  expect((await DELETE(r)).status).toBe(404);expect(service.configured).not.toHaveBeenCalled();expect(service.complete).not.toHaveBeenCalled();
 });
 it("closed capability never prepares or accepts",async()=>{
  service.configured.mockReturnValue(null);expect((await DELETE(request())).status).toBe(404);expect(service.complete).not.toHaveBeenCalled();
 });
 it("unknown disposal/native completion remains a value-free refusal with no retry/notice",async()=>{
  service.complete.mockRejectedValue(new Error("PRIVATE_NATIVE_ERROR"));const response=await DELETE(request());
  expect(response.status).toBe(404);expect(await response.text()).not.toContain("PRIVATE_NATIVE_ERROR");expect(service.complete).toHaveBeenCalledTimes(1);
 });
 it("presents only a current strict claimed-unbound delete action and bound operation token",async()=>{
  const r=new Request("https://example.test/withdraw/session",{headers:{cookie}}),control=await presentClaimantDeletion(r);
  expect(control?.csrf).toBe(claimantCsrf(hash));expect(readPublicFormToken(control!.nonce,"future-person-delete",Date.now(),hash)).not.toBeNull();
  expect(readPublicFormToken(control!.nonce,"future-person-analysis-stop",Date.now(),hash)).toBeNull();
  expect(service.rpc).toHaveBeenCalledExactlyOnceWith("future_person_rights_view_v1",{p_session_hash:hash});
  expect(service.ready).toHaveBeenCalledExactlyOnceWith(r.signal);expect(service.complete).not.toHaveBeenCalled();
 });
 it.each([null,{safeClaimedSubjectLabel:"Your claimed record",lifecycleState:"claimed_unbound",retentionMaximumDays:null,allowedActionIds:[]},
  {safeClaimedSubjectLabel:"Your claimed record",lifecycleState:"claimed_unbound",retentionMaximumDays:null,allowedActionIds:["delete"],genotype:"private"}])("does not present a control for absent/denied/malformed native authority %j",async view=>{
  service.rpc.mockResolvedValue({data:view,error:null});expect(await presentClaimantDeletion(new Request("https://example.test/withdraw/session",{headers:{cookie}}))).toBeNull();
  expect(service.ready).not.toHaveBeenCalled();expect(service.complete).not.toHaveBeenCalled();
 });
 it("does not mint a delete control before actual readiness has returned",async()=>{
  service.ready.mockRejectedValue(new Error("private-provider-refusal"));expect(await presentClaimantDeletion(new Request("https://example.test/withdraw/session",{headers:{cookie}}))).toBeNull();expect(service.complete).not.toHaveBeenCalled();
 });
});
