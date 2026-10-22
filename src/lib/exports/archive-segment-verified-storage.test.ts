import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createVerifiedSupabaseArchiveWriter} from "./archive-segment-verified-storage";
import {approvedAccountArchiveGeneration} from "./account-archive-generation";
import {storeArchiveSegments,type ArchiveAttempt,type ArchiveSegment} from "./archive-segments";

// These authored fixtures exercise actual SDK transports with injected fetch.
// They are not live provider, cleanup/fence, account generation or READY proof.
const origin="https://example.supabase.co",key="synthetic-test-store-key";
const payload=new TextEncoder().encode("complete synthetic archive segment\n");
const hash=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
const entity=createHash("md5").update(payload).digest("hex"),receipt="b".repeat(64);
const attempt:ArchiveAttempt={version:"archive-segments-v1",bucket:"exports",principalHash:"a".repeat(64),
 exportId:"10000000-0000-4000-8000-000000000001",attemptId:"20000000-0000-4000-8000-000000000002"};
const objectId="30000000-0000-4000-8000-000000000003",version="40000000-0000-4000-8000-000000000004";
const segment:ArchiveSegment={ordinal:0,offset:0,sizeBytes:payload.length,sha256:hash(payload),
 objectKey:`${attempt.principalHash}/${attempt.exportId}/${attempt.attemptId}-0.part`};
const info=()=>({id:objectId,version,name:segment.objectKey,bucket_id:"exports",size:payload.length,
 content_type:"application/octet-stream",etag:entity});
const headers=()=>({"content-type":"application/octet-stream","content-length":String(payload.length),etag:`"${entity}"`});
const ack=()=>new Response(JSON.stringify({Id:objectId,Key:`exports/${segment.objectKey}`}));
function fixture(respond?:(url:string,init:RequestInit,nth:number)=>Response|Promise<Response>){
 let nth=0;const stop=new AbortController(),ready=vi.fn(async(_attempt:ArchiveAttempt,_segment:ArchiveSegment,signal:AbortSignal)=>{signal.throwIfAborted();});
 const transport=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input);nth++;
  return respond?respond(url,init!,nth):init!.method==="POST"?ack()
   :url.includes("/object/info/")?new Response(JSON.stringify(info())):new Response(payload,{headers:headers()});
 });
 const config={origin,serviceRoleKey:key,fetch:transport,assertCurrent:ready};
 return {stop,ready,transport,config,write:createVerifiedSupabaseArchiveWriter(config)};
}
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});

describe("generation-only verified Supabase segment adapter",()=>{
 it("does not activate generation or call a provider while constructing the explicit adapter",()=>{
  const f=fixture();expect(approvedAccountArchiveGeneration()).toBeNull();
  expect(f.transport).not.toHaveBeenCalled();expect(f.ready).not.toHaveBeenCalled();
  expect(()=>createVerifiedSupabaseArchiveWriter({...f.config,assertCurrent:null as never})).toThrow("invalid_input");
 });
 it("performs one create-only POST and exact metadata/conditional GET/metadata EOF before returning only its object ID",async()=>{
  const f=fixture();expect(await f.write(attempt,segment,payload,f.stop.signal)).toEqual({objectId});
  expect(f.transport.mock.calls.map(([input])=>String(input))).toEqual([
   `${origin}/storage/v1/object/exports/${segment.objectKey}`,
   `${origin}/storage/v1/object/info/exports/${segment.objectKey}`,
   `${origin}/storage/v1/object/exports/${segment.objectKey}`,
   `${origin}/storage/v1/object/info/exports/${segment.objectKey}`]);
  expect(f.transport.mock.calls.map(([,init])=>init!.method)).toEqual(["POST","GET","GET","GET"]);
  expect(f.ready).toHaveBeenCalledTimes(5);
  for(const [givenAttempt,givenSegment]of f.ready.mock.calls){expect(givenAttempt).toEqual(attempt);expect(givenSegment).toEqual(segment);}
  for(const [,init]of f.transport.mock.calls){
   expect(init).toMatchObject({redirect:"error",cache:"no-store"});expect(init!.signal).toBeInstanceOf(AbortSignal);
   expect(new Headers(init!.headers).get("authorization")).toBe(`Bearer ${key}`);
   expect(new Headers(init!.headers).has("range")).toBe(false);
  }
  const post=f.transport.mock.calls[0][1]!,get=f.transport.mock.calls[2][1]!;
  expect(post.body).toBe(payload);expect(new Headers(post.headers).get("x-upsert")).toBe("false");
  expect(new Headers(get.headers).get("if-match")).toBe(`"${entity}"`);
 });
 it.each([1,2,3,4,5])("refuses live readiness check %s without releasing an ACK",async failing=>{
  const f=fixture();let n=0;f.ready.mockImplementation(async()=>{if(++n===failing)throw new Error("unproved");});
  await expect(f.write(attempt,segment,payload,f.stop.signal)).rejects.toMatchObject({code:"storage",cleanupRequired:true});
  expect(f.transport).toHaveBeenCalledTimes(failing-1);
 });
 it.each(["id","name","bucket_id","size","content_type","version","etag"])("refuses wrong initial provider metadata %s",async field=>{
  const f=fixture((_url,init)=>init.method==="POST"?ack():new Response(JSON.stringify({...info(),
   [field]:field==="size"?payload.length+1:"foreign"})));
  await expect(f.write(attempt,segment,payload,f.stop.signal)).rejects.toMatchObject({cleanupRequired:true});
  expect(f.transport).toHaveBeenCalledTimes(2);
 });
 it.each(["id","name","size","version","etag"])("refuses final metadata drift %s after EOF",async field=>{
  const f=fixture((url,init,nth)=>init.method==="POST"?ack():url.includes("/object/info/")
   ?new Response(JSON.stringify({...info(),...(nth===4?{[field]:field==="size"?payload.length+1:"50000000-0000-4000-8000-000000000005"}:{})}))
   :new Response(payload,{headers:headers()}));
  await expect(f.write(attempt,segment,payload,f.stop.signal)).rejects.toMatchObject({cleanupRequired:true});
  expect(f.transport).toHaveBeenCalledTimes(4);
 });
 it.each(["short","long","digest","zero-chunk"])("refuses %s bytes despite matching metadata and headers",async fault=>{
  const f=fixture((url,init)=>init.method==="POST"?ack():url.includes("/object/info/")?new Response(JSON.stringify(info()))
   :new Response(fault==="zero-chunk"?new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array());c.close();}})
    :fault==="short"?payload.subarray(1):fault==="long"?new Uint8Array(payload.length+1):new Uint8Array(payload.length),{headers:headers()}));
  await expect(f.write(attempt,segment,payload,f.stop.signal)).rejects.toMatchObject({code:"storage",cleanupRequired:true});
  expect(f.transport.mock.calls.filter(([,init])=>init!.method==="POST")).toHaveLength(1);
 });
 it.each(["partial","compression","MIME","length","ETag"])("refuses wrong %s whole-object response headers",async fault=>{
  const changed:Record<string,string>=fault==="partial"?{"content-range":"bytes 0-1/99"}:fault==="compression"?{"content-encoding":"gzip"}
   :fault==="MIME"?{"content-type":"text/plain"}:fault==="length"?{"content-length":String(payload.length+1)}:{etag:'"00000000000000000000000000000000"'};
  const f=fixture((url,init)=>init.method==="POST"?ack():url.includes("/object/info/")?new Response(JSON.stringify(info()))
   :new Response(payload,{headers:{...headers(),...changed}}));
  await expect(f.write(attempt,segment,payload,f.stop.signal)).rejects.toMatchObject({cleanupRequired:true});expect(f.transport).toHaveBeenCalledTimes(3);
 });
 it.each(["ready","POST","initial-info","body","final-info","final-ready"])("bounds noncooperative %s in one unchanged 30-second write operation",async phase=>{
  vi.useFakeTimers();const never=()=>new Promise<Response>(()=>{}),cancel=vi.fn(()=>new Promise<void>(()=>{}));
  const f=fixture((url,init,nth)=>phase==="POST"&&nth===1||phase==="initial-info"&&nth===2||phase==="final-info"&&nth===4?never()
   :init.method==="POST"?ack():url.includes("/object/info/")?new Response(JSON.stringify(info()))
   :phase==="body"?new Response(new ReadableStream({pull:()=>new Promise<void>(()=>{}),cancel}),{headers:headers()})
   :new Response(payload,{headers:headers()}));
  let n=0;f.ready.mockImplementation(async()=>{n++;if(phase==="ready"&&n===1||phase==="final-ready"&&n===5)await new Promise<void>(()=>{});});
  const rejected=expect(f.write(attempt,segment,payload,f.stop.signal)).rejects.toMatchObject({code:"storage",cleanupRequired:true});
  await vi.advanceTimersByTimeAsync(30_001);await rejected;
  expect(f.transport.mock.calls.filter(([,init])=>init!.method==="POST")).toHaveLength(phase==="ready"?0:1);
  if(phase==="body")expect(cancel).toHaveBeenCalled();
 });
 it("pins configuration and descriptors before an awaited readiness check",async()=>{
  const f=fixture();let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});f.ready.mockImplementationOnce(async()=>held);
  const givenAttempt={...attempt},givenSegment={...segment};const running=f.write(givenAttempt,givenSegment,payload,f.stop.signal);
  f.config.origin="https://other.invalid";f.config.serviceRoleKey="changed";givenAttempt.exportId=objectId;givenSegment.objectKey="foreign";release();
  expect(await running).toEqual({objectId});expect(f.transport.mock.calls.every(([input])=>String(input).startsWith(origin))).toBe(true);
  expect(f.transport.mock.calls.every(([,init])=>new Headers(init!.headers).get("authorization")===`Bearer ${key}`)).toBe(true);
 });
 it("refuses malformed scope or local bytes before any readiness or network work",async()=>{
  for(const change of [{objectKey:"../genomes/raw"},{sizeBytes:payload.length+1},{ordinal:0.5},{sha256:"c".repeat(64)}]){
   const f=fixture();await expect(f.write(attempt,{...segment,...change},payload,f.stop.signal)).rejects.toThrow();
   expect(f.ready).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
  }
 });
 it("does not read back, retry or accept a late POST result after caller cancellation",async()=>{
  vi.useFakeTimers();let resolve!: (value:Response)=>void;const pending=new Promise<Response>(done=>{resolve=done;});
  const f=fixture(()=>pending),cancel=vi.fn();
  const rejected=expect(f.write(attempt,segment,payload,f.stop.signal)).rejects.toMatchObject({cleanupRequired:true});
  await vi.advanceTimersByTimeAsync(1);expect(f.transport).toHaveBeenCalledOnce();f.stop.abort();await rejected;
  resolve(new Response(new ReadableStream({cancel})));await vi.advanceTimersByTimeAsync(1);
  expect(cancel).toHaveBeenCalled();expect(f.transport).toHaveBeenCalledOnce();
 });
 it("retains the real core reservation and stops before ACK/page when physical readback fails",async()=>{
  const f=fixture((url,init)=>init.method==="POST"?new Response(JSON.stringify({Id:objectId,Key:url.split("/object/")[1]}))
   :url.includes("/object/info/")?new Response(JSON.stringify({...info(),name:url.split("/object/info/exports/")[1]}))
    :new Response(new Uint8Array(payload.length),{headers:headers()}));
  const reserve=vi.fn(async()=>{}),acknowledge=vi.fn(async()=>{}),appendPage=vi.fn(async()=>{});
  await expect(storeArchiveSegments({exportId:attempt.exportId,principalHash:attempt.principalHash,authorityReceipt:receipt,
   deadline:Date.now()+60_000,signal:f.stop.signal,checkAuthority:async()=>receipt,beginAttempt:async()=>{},reserve,
   acknowledge,appendPage,write:f.write,source:()=>new ReadableStream({start(c){c.enqueue(payload);c.close();}})}))
   .rejects.toMatchObject({cleanupRequired:true});
  expect(reserve).toHaveBeenCalledOnce();expect(f.transport).toHaveBeenCalledTimes(4);
  expect(acknowledge).not.toHaveBeenCalled();expect(appendPage).not.toHaveBeenCalled();
 });
});
