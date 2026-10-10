import crypto from "node:crypto";
import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({getUser:vi.fn(),getClaims:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:m.getUser,getClaims:m.getClaims},rpc:m.rpc})}));
vi.stubEnv("BYOK_ENCRYPTION_KEY",crypto.randomBytes(32).toString("base64"));vi.stubEnv("INHERIT_TEST_JURISDICTION","1");
const {mintBindingNonce,readBindingNonce,bindingRequestHash,loadAccountBinding}=await import("./account-binding");
const {claimantCsrf}=await import("./rights");
const {RIGHTS_COOKIE_NAME}=await import("../embryos/rights-session");
const {POST}=await import("../../app/api/future-person/claim/session/account/route");
const secret=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(secret).digest("hex");
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const context={authorized:true as const,account_auth_session_revision:1,session_revision:1,accountId:id(1),sessionId:id(2),rightsSessionId:id(3),
 claimantPrincipalId:id(4),claimId:id(5),claimantRevision:1,releaseRevision:1,subjectId:id(6),subjectBindingRevision:1,subjectLifecycleRevision:1};
const cookie=`${RIGHTS_COOKIE_NAME}=${secret}`;
function request(body:unknown,headers:Record<string,string>={},path="/api/future-person/claim/session/account") {
 return new Request(`https://example.test${path}`,{method:"POST",headers:{cookie,origin:"https://example.test","sec-fetch-site":"same-origin",
  "content-type":"application/json","x-inherit-csrf":claimantCsrf(hash),...headers},body:JSON.stringify(body)});
}
beforeEach(()=>{vi.clearAllMocks();m.getUser.mockResolvedValue({data:{user:{id:id(1)}},error:null});
 m.getClaims.mockResolvedValue({data:{claims:{sub:id(1),session_id:id(2),role:"authenticated"}},error:null});
 m.rpc.mockImplementation(async(name:string)=>({data:name==="future_person_binding_context_v1"?context:true,error:null}));});
afterAll(()=>vi.unstubAllEnvs());
describe("claimant account binding requires both current independent credentials",()=>{
 it("binds the real control to every immutable claimant/account/session revision",()=>{
  const token=mintBindingNonce(hash,context);expect(readBindingNonce(token,hash,context)).not.toBeNull();
  for(const key of ["accountId","sessionId","rightsSessionId","claimantPrincipalId","claimId","subjectId"] as const)
   expect(readBindingNonce(token,hash,{...context,[key]:id(99)})).toBeNull();
  for(const key of ["account_auth_session_revision","session_revision","claimantRevision","releaseRevision","subjectBindingRevision","subjectLifecycleRevision"] as const)
   expect(readBindingNonce(token,hash,{...context,[key]:2})).toBeNull();
  expect(readBindingNonce(token,"a".repeat(64),context)).toBeNull();expect(readBindingNonce(token,hash,context,Date.now()+601000)).toBeNull();
 });
 it("refuses bad browser transport and duplicate cookies before a service or authenticated RPC",async()=>{
  for(const headers of ([{origin:"https://foreign.test"},{"sec-fetch-site":"cross-site"},{"x-inherit-csrf":"0".repeat(64)},
   {cookie:`${cookie}; ${cookie}`},{"content-type":"text/plain"}] as Record<string,string>[])){
   expect(bindingRequestHash(request({},headers))).toBeNull();expect((await POST(request({},headers))).status).toBe(404);
  }
  expect((await POST(request({}, {},"/api/future-person/claim/session/account?claimId=x"))).status).toBe(404);
  expect(m.rpc).not.toHaveBeenCalled();expect(m.getUser).not.toHaveBeenCalled();
 });
 it("refuses all unregistered body identifiers before resolving any account",async()=>{
  for(const body of [{},{nonce:"x",accountId:id(1)},{nonce:"x",subjectId:id(6)},{nonce:"x",ownerId:id(1)},{nonce:"x",claimId:id(5)},{nonce:"x",parentId:id(1)}])
   expect((await POST(request(body))).status).toBe(404);
  expect(m.rpc).not.toHaveBeenCalled();expect(m.getUser).not.toHaveBeenCalled();
 });
 it("requires getUser/getClaims agreement before the scoped reader",async()=>{
  m.getClaims.mockResolvedValue({data:{claims:{sub:id(9),session_id:id(2),role:"authenticated"}},error:null});
  expect(await loadAccountBinding(new Request("https://example.test/withdraw/session",{headers:{cookie}}))).toBeNull();
  expect(m.rpc).not.toHaveBeenCalled();
 });
 it("refuses stale context and incomplete/mismatched RPC results without a mutation",async()=>{
  const token=mintBindingNonce(hash,context);
  m.rpc.mockResolvedValue({data:{...context,subjectBindingRevision:2},error:null});
  expect((await POST(request({nonce:token}))).status).toBe(404);expect(m.rpc).toHaveBeenCalledTimes(1);
  m.rpc.mockResolvedValue({data:{...context,sessionId:id(9)},error:null});
  expect((await POST(request({nonce:token}))).status).toBe(404);
 });
 it("sends only exact signed context plus one nonce through the current user's client",async()=>{
  const token=mintBindingNonce(hash,context);const nonce=readBindingNonce(token,hash,context);
  const response=await POST(request({nonce:token}));expect(response.status).toBe(200);
  expect(await response.json()).toEqual({status:"account_bound"});expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(m.rpc).toHaveBeenLastCalledWith("bind_future_person_account_v1",{p_rights_session_hash:hash,p_nonce:nonce,p_expected:context});
 });
 it("does not report success for refused or unexpected DB output",async()=>{
  m.rpc.mockImplementation(async(name:string)=>({data:name==="future_person_binding_context_v1"?context:{status:"account_bound",subjectId:id(6)},error:null}));
  expect((await POST(request({nonce:mintBindingNonce(hash,context)}))).status).toBe(404);
 });
});
