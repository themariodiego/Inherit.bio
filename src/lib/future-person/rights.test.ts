import crypto from "node:crypto";
import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));
const {RIGHTS_COOKIE_NAME,rightsSessionHash}=await import("@/lib/embryos/rights-session");
const {mintPublicFormToken}=await import("@/lib/embryos/operation-token");
const {claimantMutation,claimantCsrf,loadClaimantRights}=await import("./rights");
const {POST}=await import("@/app/api/future-person/claim/session/recovery-key/route");
const {DELETE}=await import("@/app/api/future-person/claim/session/analysis/route");
afterAll(()=>vi.unstubAllEnvs());beforeEach(()=>mocks.rpc.mockReset());
const secret=crypto.randomBytes(32).toString("base64url");const hash=rightsSessionHash(secret);
const cookie=`${RIGHTS_COOKIE_NAME}=${secret}`;
function request(path:string,method:string,body?:unknown,extra:Record<string,string>={}) {
 return new Request(`https://example.test${path}`,{method,headers:{cookie,origin:"https://example.test","sec-fetch-site":"same-origin",
  "x-inherit-csrf":claimantCsrf(hash),...(body?{"content-type":"application/json"}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
}
describe("claimant controls bind each operation and current cookie without account authority",()=>{
 it("refuses changed operations, cookies, origin, site and CSRF before any RPC",()=>{
  const token=mintPublicFormToken("future-person-recovery-key",Date.now(),hash);
  expect(claimantMutation(request("/api/future-person/claim/session/recovery-key","POST"),token,"future-person-recovery-key")).toMatchObject({sessionHash:hash});
  expect(claimantMutation(request("/api/future-person/claim/session/recovery-key","POST"),token,"future-person-analysis-stop")).toBeNull();
  const refusedHeaders:Record<string,string>[]=[{cookie:`${cookie}; ${cookie}`},{cookie:`${RIGHTS_COOKIE_NAME}=${crypto.randomBytes(32).toString("base64url")}`},
   {origin:"https://other.test"},{"sec-fetch-site":"cross-site"},{"x-inherit-csrf":"a".repeat(64)}];
  for(const headers of refusedHeaders)
   expect(claimantMutation(request("/api/future-person/claim/session/recovery-key","POST",undefined,headers),token,"future-person-recovery-key")).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("loads exactly one safe projection and creates no database nonce on page read",async()=>{
  mocks.rpc.mockResolvedValue({data:{safeClaimedSubjectLabel:"Your claimed record",lifecycleState:"claimed_unbound",retentionMaximumDays:null,
   allowedActionIds:["create-recovery-key","analysis-stop"]},error:null});
  const loaded=await loadClaimantRights(new Request("https://example.test/withdraw/session",{headers:{cookie}}));
  expect(loaded?.view.safeClaimedSubjectLabel).toBe("Your claimed record");
  expect(mocks.rpc.mock.calls).toEqual([["future_person_rights_view_v1",{p_session_hash:hash}]]);
  expect(loaded?.csrf).not.toBe(loaded?.recoveryNonce);expect(loaded?.recoveryNonce).not.toBe(loaded?.analysisNonce);
  mocks.rpc.mockResolvedValue({data:{...loaded?.view,genotype:"forbidden"},error:null});
  expect(await loadClaimantRights(new Request("https://example.test/withdraw/session",{headers:{cookie}}))).toBeNull();
 });
 it("returns one format-valid Recovery Key and persists only its exact hash",async()=>{
  mocks.rpc.mockResolvedValue({data:"2028-09-30",error:null});
  const nonce=mintPublicFormToken("future-person-recovery-key",Date.now(),hash);
  const response=await POST(request("/api/future-person/claim/session/recovery-key","POST",{nonce,acknowledgedWillSaveOffline:true}));
  expect(response.status).toBe(201);const body=await response.json();
  expect(Object.keys(body).sort()).toEqual(["contactMaterialExpiresOn","recordRetention","recoveryKey","reverificationBinding"]);
  expect(body.recoveryKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/u);
  const [name,args]=mocks.rpc.mock.calls[0];expect(name).toBe("issue_future_person_recovery_key_v1");
  expect(args.p_session_hash).toBe(hash);expect(args.p_key_hash).toBe(crypto.createHash("sha256").update(body.recoveryKey).digest("hex"));
  expect(JSON.stringify(args)).not.toContain(body.recoveryKey);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
 });
 it("refuses a key without offline acknowledgement, crossed nonce, extra selector or database authority",async()=>{
  const nonce=mintPublicFormToken("future-person-recovery-key",Date.now(),hash);
  for(const body of [{nonce,acknowledgedWillSaveOffline:false},{nonce,acknowledgedWillSaveOffline:true,subjectId:"forbidden"},
   {nonce:mintPublicFormToken("future-person-analysis-stop",Date.now(),hash),acknowledgedWillSaveOffline:true}]){
   expect((await POST(request("/api/future-person/claim/session/recovery-key","POST",body))).status).toBe(404);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();mocks.rpc.mockResolvedValue({data:null,error:{code:"42501"}});
  const refused=await POST(request("/api/future-person/claim/session/recovery-key","POST",{nonce,acknowledgedWillSaveOffline:true}));
  expect(refused.status).toBe(404);expect(await refused.text()).not.toMatch(/[0-9A-HJKMNP-TV-Z]{20}/u);
 });
 it("stops analysis only through the exact destructive header control",async()=>{
  const nonce=mintPublicFormToken("future-person-analysis-stop",Date.now(),hash);
  mocks.rpc.mockResolvedValue({data:"2026-09-30T12:00:00+00:00",error:null});
  const response=await DELETE(request("/api/future-person/claim/session/analysis","DELETE",undefined,{"x-inherit-operation-nonce":nonce}));
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:"analysis_stopped",effectiveAt:"2026-09-30T12:00:00.000Z"});
  expect(mocks.rpc).toHaveBeenCalledWith("stop_future_person_analysis_v1",expect.objectContaining({p_session_hash:hash}));
  mocks.rpc.mockClear();expect((await DELETE(request("/api/future-person/claim/session/analysis","DELETE",{subjectId:"forbidden"},
   {"x-inherit-operation-nonce":nonce}))).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
