import {createHash,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {downloadAccountArchive} from "./account-archive-download";
import type {AccountExportDownload} from "./account-export-delivery-contract";

afterEach(()=>vi.useRealTimers());
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function fixture(){
 const bytes=Uint8Array.from({length:4_000_017},(_,index)=>index%251),session=randomUUID(),events:string[]=[];
 const download:AccountExportDownload={session,filename:"inherit-account-export.zip",sizeBytes:bytes.length,sha256:sha(bytes),
  chunkBytes:4_000_000,chunkCount:2,chunkRoute:`/api/downloads/${session}/chunks/{sequence}`};
 const written:Uint8Array[]=[],sink={write:vi.fn(async(value:Uint8Array)=>{events.push("write");written.push(value.slice());}),
  close:vi.fn(async()=>{events.push("close");}),abort:vi.fn(async()=>{events.push("abort");})};
 const transport=vi.fn(async(url:string,init:RequestInit)=>{
  events.push(init.method!);const number=Number(url.match(/\/chunks\/(\d+)/u)?.[1]);
  expect(url).toBe(`/api/downloads/${session}/chunks/${number}${init.method==="POST"?"/acknowledge":""}`);
  expect(init).toMatchObject({cache:"no-store",credentials:"same-origin",redirect:"error"});
  if(init.method==="POST"){
   expect(init.headers).toEqual({"Content-Type":"application/json","X-Inherit-CSRF":"c".repeat(64)});
   expect(JSON.parse(String(init.body))).toEqual({receipt:Buffer.alloc(32,number+1).toString("base64url"),
    sha256:sha(bytes.slice(number*4_000_000,(number+1)*4_000_000)),sizeBytes:Math.min(4_000_000,bytes.length-number*4_000_000)});
   return new Response(null,{status:204});
  }
  const chunk=bytes.slice(number*4_000_000,(number+1)*4_000_000);
  return new Response(chunk,{headers:{"Content-Type":"application/octet-stream","Content-Encoding":"identity","Content-Length":String(chunk.length),
   "X-Inherit-Chunk-Sha256":sha(chunk),"X-Inherit-Chunk-Receipt":Buffer.alloc(32,number+1).toString("base64url"),"X-Inherit-CSRF":"c".repeat(64)}});
 });
 return {bytes,download,sink,written,events,transport,signal:new AbortController().signal};
}
describe("one complete streaming account download",()=>{
 it("verifies every actual chunk and sink write before its receipt, then exact total SHA before one close",async()=>{
  const f=fixture();expect(await downloadAccountArchive(f)).toEqual({sizeBytes:f.bytes.length,sha256:f.download.sha256});
  expect(f.events).toEqual(["GET","write","POST","GET","write","POST","close"]);
  expect(Buffer.concat(f.written).equals(Buffer.from(f.bytes))).toBe(true);expect(f.sink.abort).not.toHaveBeenCalled();
 });
 it.each(["truncated","overrun","hash","encoding","missing-receipt","missing-csrf","redirect","ack-refusal","total-hash"])("aborts %s without a successful file or sequence retry",async fault=>{
  const f=fixture(),base=f.transport.getMockImplementation()!;
  if(fault==="total-hash")f.download.sha256="f".repeat(64);
  f.transport.mockImplementation(async(url,init)=>{
   if(init.method==="POST"&&fault==="ack-refusal")return new Response(null,{status:404});
   const value=await base(url,init);if(init.method!=="GET")return value;
   if(fault==="redirect")return new Response(null,{status:302});
   if(fault==="truncated"||fault==="overrun")return new Response(f.bytes.slice(0,fault==="truncated"?3:4_000_001),{headers:value.headers});
   if(fault==="hash")value.headers.set("x-inherit-chunk-sha256","0".repeat(64));
   if(fault==="encoding")value.headers.set("content-encoding","gzip");
   if(fault==="missing-receipt")value.headers.delete("x-inherit-chunk-receipt");
   if(fault==="missing-csrf")value.headers.delete("x-inherit-csrf");return value;
  });
  await expect(downloadAccountArchive(f)).rejects.toThrow();expect(f.sink.close).not.toHaveBeenCalled();expect(f.sink.abort).toHaveBeenCalledTimes(1);
  const calls=f.transport.mock.calls.map(([url,init])=>`${init.method}:${url}`);expect(new Set(calls).size).toBe(calls.length);
 });
 it("refuses forged route/count metadata before any transport and aborts the explicit partial sink",async()=>{
  const f=fixture();f.download.chunkRoute="https://foreign.e2e.local/private";
  await expect(downloadAccountArchive(f)).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();expect(f.sink.close).not.toHaveBeenCalled();
 });
 it("bounds a stalled chunk at the original30 seconds and never creates a second request",async()=>{
  vi.useFakeTimers();const f=fixture();f.transport.mockImplementation(()=>new Promise<Response>(()=>{}));
  const pending=downloadAccountArchive(f),refused=expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30_001);await refused;expect(f.transport).toHaveBeenCalledTimes(1);expect(f.sink.abort).toHaveBeenCalledTimes(1);
 });
 it("does not ACK canceled bytes while an actual sink write is still using them",async()=>{
  const f=fixture(),controller=new AbortController(),entered=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
  let retained:Uint8Array|undefined;
  f.sink.write.mockImplementation(async bytes=>{retained=bytes;entered.resolve();await finish.promise;});
  const pending=downloadAccountArchive({...f,signal:controller.signal}),refused=expect(pending).rejects.toThrow();
  await entered.promise;controller.abort();
  expect(Buffer.from(retained!).equals(Buffer.from(f.bytes.subarray(0,4_000_000)))).toBe(true);
  finish.resolve();await refused;
  expect(retained!.every(byte=>byte===0)).toBe(true);
  expect(f.transport.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(0);
  expect(f.sink.close).not.toHaveBeenCalled();expect(f.sink.abort).toHaveBeenCalledTimes(1);
 });
 it("refuses an unsettled sink abort at five seconds without claiming completion",async()=>{
  vi.useFakeTimers();const f=fixture(),controller=new AbortController();controller.abort();
  f.sink.abort.mockImplementation(()=>new Promise<void>(()=>{}));
  const pending=downloadAccountArchive({...f,signal:controller.signal}),refused=expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5_001);await refused;
  expect(f.sink.abort).toHaveBeenCalledTimes(1);expect(f.sink.close).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
 });
 it("cannot turn a timed-out final file close into a successful archive",async()=>{
  vi.useFakeTimers();const f=fixture(),entered=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
  f.sink.close.mockImplementation(async()=>{entered.resolve();await finish.promise;});
  const pending=downloadAccountArchive(f),refused=expect(pending).rejects.toThrow();await entered.promise;
  await vi.advanceTimersByTimeAsync(30_001);finish.resolve();await refused;
  expect(f.sink.close).toHaveBeenCalledTimes(1);expect(f.sink.abort).toHaveBeenCalledTimes(1);
  expect(f.transport.mock.calls.filter(([,init])=>init.method==="POST")).toHaveLength(2);
 });
});
