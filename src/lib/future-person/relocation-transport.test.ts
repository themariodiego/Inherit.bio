import {createHash,randomUUID,sign} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createEmbryoFixtureSigner,createEmbryoFragmentGateway,EMBRYO_FIXTURE_ORIGIN,
 EMBRYO_FIXTURE_BUCKET,EMBRYO_FIXTURE_SUPABASE_URL} from "../../../scripts/ci-browser/embryo-fragment-fixture";
import {mintSubjectRelocationCapability,mintEmbryoFragmentCapability} from "@/lib/uploads/storage-upload-token";
import {copyRelocation,readRelocation,disposeRelocation,type RelocationTarget} from "./relocation-transport";
const sha=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex");
const signal=()=>new AbortController().signal;
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function fixture(){
 const signer=createEmbryoFixtureSigner(),gateway=createEmbryoFragmentGateway(signer.publicJwk);
 vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK",JSON.stringify(signer.privateJwk));
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",EMBRYO_FIXTURE_SUPABASE_URL);
 vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN",EMBRYO_FIXTURE_ORIGIN);
 vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET",EMBRYO_FIXTURE_BUCKET);
 const bytes=new TextEncoder().encode("# synthetic canonical bytes\n1\t12\tA\tG\n");
 const oldKey=`embryo/${randomUUID()}`,stored=await gateway.binding.put(oldKey,bytes,{sha256:sha(bytes)});
 const accountId=randomUUID(),attemptId=randomUUID();
 const target:RelocationTarget={bindingId:randomUUID(),relocationId:randomUUID(),attemptId,accountId,
  bucket:EMBRYO_FIXTURE_BUCKET,oldKey,oldVersion:stored!.version,oldEtag:stored!.etag,
  newKey:`claimant/${accountId}/${attemptId}`,byteCount:bytes.length,sha256:sha(bytes),expiresAt:new Date(Date.now()+60000).toISOString()};
 const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const req=input instanceof Request?input:new Request(input,init);expect(new URL(req.url).origin).toBe(EMBRYO_FIXTURE_ORIGIN);
  return gateway.fetch(req);
 });vi.stubGlobal("fetch",fetch);
 return {gateway,target,bytes,fetch,signer};
}
describe("exact claimant relocation transport over the real gateway and synthetic R2 binding",()=>{
 it("copies create-only, independently reads all bytes, and leaves the old source untouched before swap",async()=>{
  const f=await fixture(),old=f.gateway.values.get(f.target.oldKey);
  const identity=await copyRelocation(f.target,signal());
  expect(await readRelocation(f.target,identity,signal())).toEqual(f.bytes);
  expect(f.gateway.values.get(f.target.oldKey)).toBe(old);
  expect(await copyRelocation(f.target,signal())).toEqual(identity);
  expect(f.gateway.values.get(f.target.newKey)?.bytes).toEqual(f.bytes);
 });
 it("refuses stale source versions and hashes without any destination write",async()=>{
  const f=await fixture();
  for(const change of [{oldVersion:"0".repeat(32)},{oldEtag:"0".repeat(32)},{sha256:"0".repeat(64)},{byteCount:f.bytes.length-1}])
   await expect(copyRelocation({...f.target,...change},signal())).rejects.toThrow("relocation_transport_unavailable");
  expect(f.gateway.values.has(f.target.newKey)).toBe(false);
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);
 });
 it("refuses existing conflicting or tombstoned destinations and preserves the original",async()=>{
  const f=await fixture();
  await f.gateway.binding.put(f.target.newKey,new Uint8Array([1]),{sha256:sha(new Uint8Array([1]))});
  await expect(copyRelocation(f.target,signal())).rejects.toThrow();
  await disposeRelocation(f.target,"new",signal());
  await expect(copyRelocation(f.target,signal())).rejects.toThrow();
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);
 });
 it("requires exact readback version, etag, byte count and complete streamed hash",async()=>{
  const f=await fixture(),identity=await copyRelocation(f.target,signal());
  for(const change of [{providerVersion:"0".repeat(32)},{etag:"0".repeat(32)},{byteCount:identity.byteCount-1}])
   await expect(readRelocation(f.target,{...identity,...change},signal())).rejects.toThrow();
  const value=f.gateway.values.get(f.target.newKey)!;value.bytes=Uint8Array.from(f.bytes);value.bytes[0]^=1;
  await expect(readRelocation(f.target,identity,signal())).rejects.toThrow();
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);
 });
 it.each(["copy","get","dispose-new"] as const)("cancels an admitted stalled %s body and refuses incomplete evidence",async operation=>{
  const f=await fixture(),identity=await copyRelocation(f.target,signal()),controller=new AbortController();
  let entered!:()=>void;const pending=new Promise<void>(resolve=>{entered=resolve;});
  const cancel=vi.fn(),body=new ReadableStream<Uint8Array>({pull(){entered();return new Promise(()=>{});},cancel});
  const headers=operation==="get"?{"content-length":String(f.target.byteCount),
   "x-inherit-object-version":identity.providerVersion,etag:`"${identity.etag}"`}:undefined;
  f.fetch.mockResolvedValueOnce(new Response(body,{headers}));
  const result=operation==="copy"?copyRelocation(f.target,controller.signal):operation==="get"?
   readRelocation(f.target,identity,controller.signal):disposeRelocation(f.target,"new",controller.signal);
  const refusal=expect(result).rejects.toThrow("relocation_transport_unavailable");
  await pending;controller.abort();await refusal;
  expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);
  expect(f.gateway.values.get(f.target.newKey)?.bytes).toEqual(f.bytes);
 });
 it("retires only the exact old payload after the committed-swap caller supplies the copied identity",async()=>{
  const f=await fixture(),identity=await copyRelocation(f.target,signal());
  await readRelocation(f.target,identity,signal());
  await expect(disposeRelocation({...f.target,oldVersion:"0".repeat(32)},"old",signal(),identity)).rejects.toThrow();
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);
  const evidence=await disposeRelocation(f.target,"old",signal(),identity);
  expect(evidence).toMatchObject({disposition:"payload-tombstoned",byteCount:0,sha256:sha(new Uint8Array())});
  expect(await disposeRelocation(f.target,"old",signal(),identity)).toEqual(evidence);
  expect(f.gateway.values.get(f.target.newKey)?.bytes).toEqual(f.bytes);
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toHaveLength(0);
 });
 it("fences an admitted destination copy when a cleanup marker commits first",async()=>{
  const f=await fixture();
  f.gateway.onBeforeCommit(async key=>{if(key!==f.target.newKey)return;f.gateway.onBeforeCommit(undefined);
   await f.gateway.binding.put(key,new Uint8Array(),{customMetadata:{state:"tombstone"}});});
  await expect(copyRelocation(f.target,signal())).rejects.toThrow();
  expect(f.gateway.values.get(f.target.newKey)?.bytes).toHaveLength(0);
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);
 });
 it("refuses malformed/cross-owner locators and expiry before transport",async()=>{
  const f=await fixture();
  for(const change of [{newKey:`claimant/${randomUUID()}/${f.target.attemptId}`},{newKey:"../x"},
   {expiresAt:new Date(Date.now()-1000).toISOString()},{extra:"x"},{byteCount:4004097}])
   await expect(copyRelocation({...f.target,...change},signal())).rejects.toThrow();
  expect(f.fetch).not.toHaveBeenCalled();
 });
 it("separates both gateway audiences and refuses body/query/method/unknown claims before R2 access",async()=>{
  const f=await fixture(),put=vi.spyOn(f.gateway.binding,"put"),get=vi.spyOn(f.gateway.binding,"get");
  const token=mintSubjectRelocationCapability({...f.target,operation:"copy"});
  for(const [path,method,body] of [["/fragment","PUT",undefined],["/relocation?x=1","PUT",undefined],
   ["/relocation","POST",undefined],["/relocation","PUT","x"]] as const){
   expect((await f.gateway.fetch(new Request(EMBRYO_FIXTURE_ORIGIN+path,{method,body,headers:{Authorization:`Bearer ${token}`}}))).status).toBe(404);
  }
  const fragmentToken=mintEmbryoFragmentCapability({operation:"get",bucket:f.target.bucket,objectKey:f.target.oldKey,
   byteCount:f.target.byteCount,sha256:f.target.sha256,expiresAt:f.target.expiresAt,
   providerVersion:f.target.oldVersion,etag:f.target.oldEtag});
  expect((await f.gateway.fetch(new Request(EMBRYO_FIXTURE_ORIGIN+"/relocation",{headers:{Authorization:`Bearer ${fragmentToken}`}}))).status).toBe(404);
  const payload=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString());
  for(const change of [{unknown:"x"},{accountId:[f.target.accountId]},{oldKey:[f.target.oldKey]},
   {sha256:[f.target.sha256]},{oldVersion:[f.target.oldVersion]},{exp:payload.iat+31}]){
   const input=token.split(".")[0]+"."+Buffer.from(JSON.stringify({...payload,...change})).toString("base64url");
   const bad=input+"."+sign("sha256",Buffer.from(input),{key:f.signer.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
   expect((await f.gateway.fetch(new Request(EMBRYO_FIXTURE_ORIGIN+"/relocation",{method:"PUT",headers:{Authorization:`Bearer ${bad}`}}))).status).toBe(404);
  }
  expect(get).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 });
});
