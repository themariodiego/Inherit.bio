import {createHash,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createEmbryoFixtureSigner,createEmbryoFragmentGateway,EMBRYO_FIXTURE_ORIGIN,
 EMBRYO_FIXTURE_BUCKET,EMBRYO_FIXTURE_SUPABASE_URL} from "../../../scripts/ci-browser/embryo-fragment-fixture";
import {runNextFuturePersonRelocation,type RelocationRpc} from "./relocation-worker";
import {relocatedIdentitySchema,relocationTombstoneSchema,type RelocationTarget,type RelocatedIdentity} from "./relocation-transport";
const sha=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex");
const signal=()=>new AbortController().signal;
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
/** Real worker, signer, gateway and transport; synthetic SQL authority and R2
 * binding only. No database, network or hosted-provider proof is claimed. */
async function fixture(){
 const signer=createEmbryoFixtureSigner(),gateway=createEmbryoFragmentGateway(signer.publicJwk);
 vi.stubEnv("INHERIT_TEST_JURISDICTION","1");
 vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK",JSON.stringify(signer.privateJwk));
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",EMBRYO_FIXTURE_SUPABASE_URL);
 vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN",EMBRYO_FIXTURE_ORIGIN);
 vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET",EMBRYO_FIXTURE_BUCKET);
 const bytes=new TextEncoder().encode("# synthetic canonical source\n1\t12\tA\tG\n"),oldKey=`embryo/${randomUUID()}`;
 const stored=(await gateway.binding.put(oldKey,bytes,{sha256:sha(bytes)}))!,accountId=randomUUID(),attemptId=randomUUID();
 const target:RelocationTarget={bindingId:randomUUID(),relocationId:randomUUID(),attemptId,accountId,
  bucket:EMBRYO_FIXTURE_BUCKET,oldKey,oldVersion:stored.version,oldEtag:stored.etag,
  newKey:`claimant/${accountId}/${attemptId}`,byteCount:bytes.length,sha256:sha(bytes),expiresAt:new Date(Date.now()+60000).toISOString()};
 let state:"copy"|"failed"|"swapped"|"complete"|"cleaned"="copy",current=true,lostSwap=false;
 let identity:RelocatedIdentity|undefined,hash:string|undefined,cleanupHash:string|undefined;
 const calls:string[]=[],operations:string[]=[];
 const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=input instanceof Request?input:new Request(input,init);
  expect(new URL(request.url).origin).toBe(EMBRYO_FIXTURE_ORIGIN);
  const payload=JSON.parse(Buffer.from(request.headers.get("authorization")!.split(".")[1],"base64url").toString());
  operations.push(payload.operation);return gateway.fetch(request);
 });vi.stubGlobal("fetch",fetch);
 const receipt=()=>({kind:state==="swapped"?"old":"new",target,identity:state==="swapped"?identity:null});
 const rpc:RelocationRpc=(name,args)=>({abortSignal:async signal=>{
  if(signal.aborted)return {data:null,error:new Error("synthetic aborted RPC")};
  calls.push(name);let data:unknown=null;
  if(name==="future_person_relocation_work_v1")data=state==="copy"?{kind:"copy",relocationId:target.relocationId}:
   state==="failed"||state==="swapped"?{kind:"cleanup",relocationId:target.relocationId,attemptId}:null;
  else if(name==="claim_future_person_relocation_v1"){
   expect(state).toBe("copy");expect(args.p_id).toBe(target.relocationId);hash=args.p_token_hash as string;data=target;
  }else if(name==="check_future_person_relocation_v1"){
   expect(args).toEqual({p_id:target.relocationId,p_token_hash:hash});data=current&&state==="copy";
  }else if(name==="swap_future_person_relocation_v1"){
   expect(current).toBe(true);expect(state).toBe("copy");expect(args.p_target).toEqual(target);
   expect(args.p_token_hash).toBe(hash);expect(args.p_bytes).toBe(bytes.length);expect(args.p_sha256).toBe(sha(bytes));
   identity=relocatedIdentitySchema.parse(args.p_identity);expect(identity.byteCount).toBe(bytes.length);
   expect(gateway.values.get(target.newKey)).toMatchObject({bytes,version:identity.providerVersion,etag:identity.etag});
   state="swapped";if(lostSwap)return {data:null,error:new Error("synthetic lost committed response")};data=true;
  }else if(name==="fence_future_person_relocation_v1"){
   expect(args).toEqual({p_id:target.relocationId,p_token_hash:hash});data=state==="copy";if(data)state="failed";
  }else if(name==="claim_future_person_relocation_cleanup_v1"){
   expect(args.p_attempt).toBe(attemptId);cleanupHash=args.p_token_hash as string;data=receipt();
  }else if(name==="check_future_person_relocation_cleanup_v1"){
   expect(args).toEqual({p_attempt:attemptId,p_token_hash:cleanupHash,p_expected:receipt()});data=current||state==="failed";
  }else if(name==="finish_future_person_relocation_v1"){
   expect(args).toMatchObject({p_attempt:attemptId,p_token_hash:cleanupHash,p_expected:receipt()});
   const evidence=relocationTombstoneSchema.parse(args.p_evidence),key=state==="swapped"?target.oldKey:target.newKey;
   expect(gateway.values.get(key)).toMatchObject({tombstone:true,bytes:new Uint8Array(),version:evidence.providerVersion,etag:evidence.etag});
   state=state==="swapped"?"complete":"cleaned";data=true;
  }else throw new Error(`unexpected RPC ${name}`);
  return {data,error:null};
 }});
 return {gateway,target,bytes,calls,operations,fetch,rpc,setCurrent(v:boolean){current=v;},loseSwap(){lostSwap=true;},
  get state(){return state;},get identity(){return identity;}};
}
describe("composed registered relocation with real gateway and synthetic authority/provider boundaries",()=>{
 it("commits full independent readback with the exact copied version and then ACKs only old cleanup",async()=>{
  const f=await fixture(),original=f.gateway.values.get(f.target.oldKey);
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("swapped");
  expect(f.operations).toEqual(["copy","get"]);expect(f.gateway.values.get(f.target.oldKey)).toBe(original);
  expect(f.identity?.providerVersion).toBe(f.gateway.values.get(f.target.newKey)?.version);
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("complete");
  expect(f.operations).toEqual(["copy","get","dispose-old"]);expect(f.gateway.values.get(f.target.newKey)?.bytes).toEqual(f.bytes);
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toHaveLength(0);expect(f.state).toBe("complete");
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("idle");
 });
 it("recovers a lost committed-swap reply without selecting or tombstoning the current key",async()=>{
  const f=await fixture();f.loseSwap();
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("failure_pending");
  expect(f.state).toBe("swapped");expect(f.operations).toEqual(["copy","get"]);
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("complete");
  expect(f.operations).toEqual(["copy","get","dispose-old"]);expect(f.gateway.values.get(f.target.newKey)?.bytes).toEqual(f.bytes);
 });
 it("refuses a revoked claim immediately after actual copy and cleans only that failed new key",async()=>{
  const f=await fixture();f.gateway.onBeforeCommit(key=>{if(key===f.target.newKey)f.setCurrent(false);});
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("failure_pending");
  expect(f.operations).toEqual(["copy"]);expect(f.calls).not.toContain("swap_future_person_relocation_v1");
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("cleaned");
  expect(f.operations).toEqual(["copy","dispose-new"]);expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);
  expect(f.gateway.values.get(f.target.newKey)?.bytes).toHaveLength(0);
 });
 it("refuses corrupted copied bytes before swap and preserves the old source through temporary ACK",async()=>{
  const f=await fixture(),original=f.gateway.binding.get,get=vi.spyOn(f.gateway.binding,"get");
  get.mockImplementation(async key=>{
   if(key===f.target.newKey){const stored=f.gateway.values.get(key)!;stored.bytes=Uint8Array.from(stored.bytes);stored.bytes[0]^=1;}
   return original(key);
  });
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("failure_pending");
  expect(f.operations).toEqual(["copy","get"]);
  expect(f.calls).not.toContain("swap_future_person_relocation_v1");
  get.mockRestore();
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("cleaned");
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);expect(f.gateway.values.get(f.target.newKey)?.bytes).toHaveLength(0);
 });
 it("refuses old cleanup when current bound authority changes after a committed swap",async()=>{
  const f=await fixture();expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("swapped");f.setCurrent(false);
  await expect(runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).rejects.toThrow("future_person_relocation_unavailable");
  expect(f.operations).toEqual(["copy","get"]);expect(f.calls).not.toContain("finish_future_person_relocation_v1");
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);expect(f.gateway.values.get(f.target.newKey)?.bytes).toEqual(f.bytes);
 });
 it("rechecks authority after the complete actual readback and refuses swap after revocation",async()=>{
  const f=await fixture(),original=f.gateway.binding.get,get=vi.spyOn(f.gateway.binding,"get");
  get.mockImplementation(async key=>{if(key===f.target.newKey)f.setCurrent(false);return original(key);});
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("failure_pending");
  expect(f.operations).toEqual(["copy","get"]);expect(f.calls).not.toContain("swap_future_person_relocation_v1");
  get.mockRestore();expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("cleaned");
  expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);expect(f.gateway.values.get(f.target.newKey)?.bytes).toHaveLength(0);
 });
 it("cancels stalled readback, persists its fence with a live independent signal and later ACKs only temporary cleanup",async()=>{
  const f=await fixture(),controller=new AbortController(),transport=f.fetch.getMockImplementation()!;
  let entered!:()=>void;const pending=new Promise<void>(resolve=>{entered=resolve;});const cancel=vi.fn();
  let body!:ReadableStream<Uint8Array>;
  f.fetch.mockImplementation(async(input,init)=>{
   const response=await transport(input,init);if(init?.method!=="GET")return response;
   body=new ReadableStream<Uint8Array>({pull(){entered();return new Promise(()=>{});},cancel});
   await response.body?.cancel();return new Response(body,{headers:response.headers});
  });
  const run=runNextFuturePersonRelocation({signal:controller.signal,rpc:f.rpc});
  await pending;controller.abort();expect(await run).toBe("failure_pending");
  expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);expect(f.state).toBe("failed");
  expect(f.calls.at(-1)).toBe("fence_future_person_relocation_v1");expect(f.calls).not.toContain("swap_future_person_relocation_v1");
  f.fetch.mockImplementation(transport);
  expect(await runNextFuturePersonRelocation({signal:signal(),rpc:f.rpc})).toBe("cleaned");
  expect(f.operations).toEqual(["copy","get","dispose-new"]);expect(f.gateway.values.get(f.target.oldKey)?.bytes).toEqual(f.bytes);
  expect(f.gateway.values.get(f.target.newKey)?.bytes).toHaveLength(0);
 });
});
