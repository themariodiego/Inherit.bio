import {createHash,randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createEmbryoFixtureSigner,createEmbryoFragmentGateway,EMBRYO_FIXTURE_ORIGIN,
 EMBRYO_FIXTURE_BUCKET,EMBRYO_FIXTURE_SUPABASE_URL} from "../../../scripts/ci-browser/embryo-fragment-fixture";
import {copyRelocation,disposeRelocation,type RelocationTarget} from "./relocation-transport";
const m=vi.hoisted(()=>({getUser:vi.fn(),getClaims:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:m.getUser,getClaims:m.getClaims},rpc:m.rpc})}));
import {readBoundFuturePersonCanonicalSource,boundSourceManifestSchema} from "./bound-source-reader";
const sha=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex"),signal=()=>new AbortController().signal;
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});beforeEach(()=>vi.clearAllMocks());
async function fixture(){
 const signer=createEmbryoFixtureSigner(),gateway=createEmbryoFragmentGateway(signer.publicJwk);
 vi.stubEnv("INHERIT_TEST_JURISDICTION","1");vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK",JSON.stringify(signer.privateJwk));
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",EMBRYO_FIXTURE_SUPABASE_URL);
 vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN",EMBRYO_FIXTURE_ORIGIN);vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET",EMBRYO_FIXTURE_BUCKET);
 const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>gateway.fetch(input instanceof Request?input:new Request(input,init)));
 vi.stubGlobal("fetch",fetch);const accountId=randomUUID(),sessionId=randomUUID(),subjectId=randomUUID(),bindingId=randomUUID();
 const expiresAt=new Date(Date.now()+25000).toISOString(),bytes=[new TextEncoder().encode("# exact synthetic part1\n"),new TextEncoder().encode("1\t12\tA\tG\n")];
 const parts=[];
 for(const [sequence,data] of bytes.entries()){
  const oldKey=`embryo/${randomUUID()}`,stored=(await gateway.binding.put(oldKey,data,{sha256:sha(data)}))!,attemptId=randomUUID();
  const target:RelocationTarget={bindingId,relocationId:randomUUID(),attemptId,accountId,bucket:EMBRYO_FIXTURE_BUCKET,
   oldKey,oldVersion:stored.version,oldEtag:stored.etag,newKey:`claimant/${accountId}/${attemptId}`,
   byteCount:data.length,sha256:sha(data),expiresAt};
  const identity=await copyRelocation(target,signal());await disposeRelocation(target,"old",signal(),identity);
  parts.push({sequence,partId:randomUUID(),target,identity});
 }
 const manifest={version:"bound-future-person-canonical-source-v1",purpose:"approved-future-person-export-v1",
  actor:{accountId,sessionId,accountAuthSessionRevision:1,sessionRevision:1},bindingId,claimId:randomUUID(),claimantPrincipalId:randomUUID(),
  claimantRevision:1,releaseRevision:1,principalRevision:1,subjectId,subjectBindingRevision:1,subjectLifecycleRevision:1,
  fileId:randomUUID(),sourceSha256:sha(bytes[0]),membershipSha256:sha(bytes[1]),publicationRevision:1,
  byteCount:bytes.reduce((sum,p)=>sum+p.length,0),partCount:2,expiresAt,parts};
 m.getUser.mockResolvedValue({data:{user:{id:accountId}},error:null});
 m.getClaims.mockResolvedValue({data:{claims:{sub:accountId,role:"authenticated",session_id:sessionId}},error:null});
 const checks:unknown[]=[];
 m.rpc.mockImplementation((name:string,args:unknown)=>({abortSignal:async()=>{
  if(name==="future_person_bound_source_manifest_v1")return {data:manifest,error:null};
  expect(name).toBe("check_future_person_bound_source_v1");checks.push(args);return {data:true,error:null};
 }}));fetch.mockClear();return {gateway,manifest,bytes,fetch,checks,subjectId};
}
describe("closed bound own-source reader with real relocated gateway bytes and synthetic Auth/RPC boundaries",()=>{
 it("reads only the exact moved versions to EOF and rechecks the whole authority before releasing any bytes",async()=>{
  const f=await fixture(),result=await readBoundFuturePersonCanonicalSource(f.subjectId,signal());
  expect(result.parts.map(p=>p.bytes)).toEqual(f.bytes);expect(result.manifest).toEqual(f.manifest);
  expect(f.checks).toHaveLength(5);expect(f.checks.every(v=>JSON.stringify(v)===JSON.stringify({p_subject:f.subjectId,p_expected:f.manifest}))).toBe(true);
  expect(f.fetch).toHaveBeenCalledTimes(2);
  for(const [input,init] of f.fetch.mock.calls){
   const req=input instanceof Request?input:new Request(input,init);expect(new URL(req.url).pathname).toBe("/relocation");
   const claim=JSON.parse(Buffer.from(req.headers.get("authorization")!.split(".")[1],"base64url").toString());
   expect(claim.aud).toBe("inherit-subject-relocation-v1");expect(claim.operation).toBe("get");expect(claim.accountId).toBe(f.manifest.actor.accountId);
  }
  expect(f.manifest.parts.every(p=>f.gateway.values.get(p.target.oldKey)?.bytes.length===0)).toBe(true);
 });
 it("requires matching genuine own Auth API results before any source RPC",async()=>{
  const f=await fixture();m.getClaims.mockResolvedValue({data:{claims:{sub:randomUUID(),role:"authenticated",session_id:f.manifest.actor.sessionId}},error:null});
  await expect(readBoundFuturePersonCanonicalSource(f.subjectId,signal())).rejects.toThrow("bound_future_person_source_unavailable");
  expect(m.rpc).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
 });
 it.each(["absent","foreign","partial","extra","crossed","duplicate","purpose"])("refuses %s source proof before provider reads",async failure=>{
  const f=await fixture();let value:unknown=f.manifest;
  if(failure==="absent")value=null;if(failure==="foreign")value={...f.manifest,subjectId:randomUUID()};
  if(failure==="partial")value={...f.manifest,parts:f.manifest.parts.slice(0,1)};
  if(failure==="extra")value={...f.manifest,parentSource:"forbidden"};
  if(failure==="crossed")value={...f.manifest,parts:f.manifest.parts.map(p=>({...p,target:{...p.target,bindingId:randomUUID()}}))};
  if(failure==="duplicate")value={...f.manifest,parts:[f.manifest.parts[0],f.manifest.parts[0]]};
  if(failure==="purpose")value={...f.manifest,purpose:"embryo.analysis"};
  m.rpc.mockReturnValue({abortSignal:async()=>({data:value,error:null})});
  await expect(readBoundFuturePersonCanonicalSource(f.subjectId,signal())).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();
 });
 it.each([1,2,3,4,5])("releases no partial bytes when checkpoint %s is revoked",async checkpoint=>{
  const f=await fixture();let count=0;
  m.rpc.mockImplementation((name:string)=>({abortSignal:async()=>({data:name==="future_person_bound_source_manifest_v1"?
   f.manifest:++count!==checkpoint,error:null})}));
  await expect(readBoundFuturePersonCanonicalSource(f.subjectId,signal())).rejects.toThrow();
  expect(f.fetch.mock.calls.length).toBe(Math.floor(checkpoint/2));
 });
 it("refuses replaced Auth sessions after readback without returning the buffered source",async()=>{
  const f=await fixture();m.getClaims.mockResolvedValueOnce({data:{claims:{sub:f.manifest.actor.accountId,role:"authenticated",session_id:f.manifest.actor.sessionId}},error:null});
  m.getClaims.mockResolvedValueOnce({data:{claims:{sub:f.manifest.actor.accountId,role:"authenticated",session_id:f.manifest.actor.sessionId}},error:null});
  m.getClaims.mockResolvedValue({data:{claims:{sub:f.manifest.actor.accountId,role:"authenticated",session_id:randomUUID()}},error:null});
  await expect(readBoundFuturePersonCanonicalSource(f.subjectId,signal())).rejects.toThrow();expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it("requires unexpired closed current receipts and refuses a provider-version mismatch",async()=>{
  const f=await fixture(),p=f.manifest.parts[0];p.identity.providerVersion="0".repeat(32);
  await expect(readBoundFuturePersonCanonicalSource(f.subjectId,signal())).rejects.toThrow();expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(boundSourceManifestSchema.safeParse({...f.manifest,actor:{...f.manifest.actor,serviceRole:true}}).success).toBe(false);
  f.manifest.expiresAt=new Date(Date.now()-1000).toISOString();f.manifest.parts.forEach(p=>p.target.expiresAt=f.manifest.expiresAt);f.fetch.mockClear();
  await expect(readBoundFuturePersonCanonicalSource(f.subjectId,signal())).rejects.toThrow();expect(f.fetch).not.toHaveBeenCalled();
 });
});
