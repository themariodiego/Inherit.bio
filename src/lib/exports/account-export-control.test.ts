import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {requestAccountExport,type AccountExportControl} from "./account-export-control";

afterEach(()=>vi.useRealTimers());
const control:AccountExportControl={available:true,create:{operation:"create",nonce:"synthetic-action-proof",csrf:"synthetic-csrf-proof"}};
const signal=()=>new AbortController().signal;
describe("settings complete export transport",()=>{
 it("uses the genuine presented pair for one POST, then cookie-only GET with the same returned identity",async()=>{
  const exportId=randomUUID(),transport=vi.fn<(url:string,init:RequestInit)=>Promise<Response>>(async()=>Response.json({status:"preparing",exportId},{status:202}));
  const created=await requestAccountExport({operation:"create",control,expectedExportId:null,signal:signal(),transport});
  expect(created).toEqual({status:"preparing",exportId});
  const [url,post]=transport.mock.calls[0];expect(url).toBe("/api/export");
  expect(post).toMatchObject({method:"POST",cache:"no-store",credentials:"same-origin",redirect:"error",
   headers:{"Content-Type":"application/json","X-Inherit-CSRF":"synthetic-csrf-proof"},
   body:'{"operation":"create","nonce":"synthetic-action-proof"}'});
  expect(Object.keys(post).sort()).toEqual(["body","cache","credentials","headers","method","redirect","signal"]);
  const polled=await requestAccountExport({operation:"check",control:{available:false},expectedExportId:exportId,signal:signal(),transport});
  expect(polled).toEqual(created);expect(transport.mock.calls).toHaveLength(2);
  expect(transport.mock.calls[1][1]).toMatchObject({method:"GET",cache:"no-store",credentials:"same-origin",redirect:"error"});
  expect(Object.keys(transport.mock.calls[1][1]).sort()).toEqual(["cache","credentials","method","redirect","signal"]);
 });
 it("refuses a closed or canceled create without a request",async()=>{
  const transport=vi.fn(),cancel=new AbortController();cancel.abort();
  await expect(requestAccountExport({operation:"create",control:{available:false},expectedExportId:null,signal:signal(),transport})).rejects.toThrow();
  await expect(requestAccountExport({operation:"create",control,expectedExportId:null,signal:cancel.signal,transport})).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
 });
 it.each(["ready","foreign-job","unknown-field","invalid-id","error","redirect","mime","oversize","invalid-utf8"])
  ("refuses %s without treating it as READY or retrying",async fault=>{
   const exportId=randomUUID();let response=Response.json({status:"preparing",exportId},{status:202});
   if(fault==="ready")response=Response.json({status:"ready",exportId,url:"https://foreign.e2e.local/private"},{status:200});
   if(fault==="unknown-field")response=Response.json({status:"preparing",exportId,authorityReceipt:"withheld"},{status:202});
   if(fault==="invalid-id")response=Response.json({status:"preparing",exportId:"foreign"},{status:202});
   if(fault==="error")response=Response.json({error:"unavailable"},{status:503});
   if(fault==="redirect")response=new Response(null,{status:302,headers:{location:"/api/export"}});
   if(fault==="mime")response=new Response(JSON.stringify({status:"preparing",exportId}),{status:202,headers:{"content-type":"text/plain"}});
   if(fault==="oversize")response=new Response(" ".repeat(4097),{status:202,headers:{"content-type":"application/json"}});
   if(fault==="invalid-utf8")response=new Response(new Uint8Array([0xc3,0x28]),{status:202,headers:{"content-type":"application/json"}});
   const transport=vi.fn(async()=>response);
   await expect(requestAccountExport({operation:"check",control,expectedExportId:fault==="foreign-job"?randomUUID():exportId,signal:signal(),transport})).rejects.toThrow();
   expect(transport).toHaveBeenCalledTimes(1);
  });
 it("bounds a stalled native response/body and honors cancellation without a second create",async()=>{
  vi.useFakeTimers();const transport=vi.fn(()=>new Promise<Response>(()=>{}));
  const refused=expect(requestAccountExport({operation:"create",control,expectedExportId:null,signal:signal(),transport})).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30001);await refused;expect(transport).toHaveBeenCalledTimes(1);
  const controller=new AbortController();let canceled=false;
  const body=new ReadableStream<Uint8Array>({cancel(){canceled=true;}});
  const stalled=expect(requestAccountExport({operation:"check",control,expectedExportId:null,signal:controller.signal,
   transport:async()=>new Response(body,{status:202,headers:{"content-type":"application/json"}})})).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);controller.abort();await stalled;await Promise.resolve();expect(canceled).toBe(true);
 });
});
