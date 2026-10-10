import {randomUUID,createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createRequesterStatementGateway,type RequesterStatementGatewayNamespace} from "./requester-statement-r2-gateway";
import {r2AllocationDigest,type R2CurrentReservation,type R2CurrentMarker} from "./archive-r2-current-fence";
import {createRequesterStatementRuntime} from "./requester-statement-runtime";

const env={INHERIT_TEST_JURISDICTION:"1",INHERIT_TEST_REQUESTER_STATEMENTS:"1"};
function fixture(){
 const now=Date.now(),exportId=randomUUID(),attemptId=randomUUID(),authorityReceipt="a".repeat(64),runtime=createRequesterStatementRuntime();
 const configuration={bucket:"inherit-export-test",bindingSha256:"b".repeat(64),protocol:"r2-current-object-qualified-all-writer-gateway-v1" as const};
 const locator={provider:"archive-r2-current-object-v1" as const,bucket:configuration.bucket,objectKey:`export/${randomUUID()}`,
  byteCount:3,sha256:createHash("sha256").update(new Uint8Array([1,2,3])).digest("hex")};
 const allocationSha256=r2AllocationDigest(locator.bucket,locator.objectKey);
 const binding:R2CurrentReservation={version:"archive-r2-current-cleanup-reservation-v1",exportId,attemptId,ordinal:0,
  authorityReceipt,reservationSha256:"c".repeat(64),locator,writeBindingSha256:"d".repeat(64),allocationSha256,
  cleanupNotBefore:new Date(now-1).toISOString(),claimExpiresAt:new Date(now+25_000).toISOString(),
  writeIdentity:{purpose:"inherit-export-reservation-v1",exportId,attemptId,ordinal:0,offset:0,byteCount:3,sha256:locator.sha256,
   logicalKey:`${"e".repeat(64)}/${exportId}/${attemptId}-0.part`,reservedAt:new Date(now-1_000).toISOString(),authorityReceipt,locator}};
 const marker:R2CurrentMarker={kind:"permanent-empty-fence",objectKey:locator.objectKey,version:"v1",etag:"e1",byteCount:0,
  allocationSha256,writeBindingSha256:null};
 const events:string[]=[],stop=new AbortController();
 type Stub=ReturnType<RequesterStatementGatewayNamespace["get"]>;
 const describe=vi.fn(async()=>{events.push("configuration");return configuration;});
 const begin=vi.fn<Stub["beginCleanup"]>(async()=>{events.push("terminal-claim");return true;});
 const end=vi.fn<Stub["endCleanup"]>(async()=>{events.push("release-claim");return true;});
 const erase=vi.fn<NonNullable<Stub["deleteCurrent"]>>(async()=>{events.push("physical-delete");return {terminal:true,absent:true};});
 const stub:Stub={describeConfiguration:describe,beginCleanup:begin,endCleanup:end,deleteCurrent:erase,
  createPayload:async()=>{throw new Error("unit-not-selected");},readPayload:async()=>{throw new Error("unit-not-selected");},
  head:async()=>{throw new Error("unit-not-selected");},get:async()=>{throw new Error("unit-not-selected");},putEmpty:async()=>{throw new Error("unit-not-selected");}};
 const named=vi.fn((name:string)=>name),get=vi.fn(()=>stub),namespace:RequesterStatementGatewayNamespace={idFromName:named,get};
 const gateway=createRequesterStatementGateway(namespace,configuration,env,runtime);
 return {configuration,binding,marker,events,stop,runtime,stub,describe,begin,end,erase,named,get,gateway};
}
// Real adapter logic with explicit synthetic service seams. Actual DO durable
// writer exclusion, private transport and provider absence need Root's TEST run.
describe("account-only physical current-object gateway",()=>{
 it("inspects genuine selected configuration without granting an allocation or content operation",async()=>{
  const f=fixture();await f.gateway.assertConfiguration(f.configuration,f.stop.signal);
  expect(f.named).toHaveBeenCalledExactlyOnceWith(f.configuration.bindingSha256);expect(f.describe).toHaveBeenCalledOnce();
  expect(f.begin).not.toHaveBeenCalled();expect(f.erase).not.toHaveBeenCalled();expect(f.end).not.toHaveBeenCalled();
  await f.runtime.settle(Date.now()+5_000);f.runtime.assertSettled();
 });
 it("requires the terminal claim and exact marker and returns only the complete current-object absence frame after release",async()=>{
  const f=fixture(),actual=await f.gateway.eraseCurrent(f.binding,f.marker,f.stop.signal);
  expect(actual).toEqual({version:"account-archive-r2-object-absent-v1",reservationSha256:f.binding.reservationSha256,
   allocationSha256:f.binding.allocationSha256,disposition:"current-object-absent",historyScope:"current-object-only",terminal:true,absent:true});
  expect(f.events).toEqual(["configuration","terminal-claim","physical-delete","configuration","release-claim"]);
  expect(f.named).toHaveBeenCalledExactlyOnceWith(f.binding.allocationSha256);
  const claim=f.begin.mock.calls[0][0];expect(claim).toEqual({allocationSha256:f.binding.allocationSha256,token:expect.stringMatching(/^[a-f0-9]{64}$/u),
   expiresAt:Date.parse(f.binding.claimExpiresAt)});
  expect(f.erase).toHaveBeenCalledExactlyOnceWith(claim,f.binding.locator.objectKey,f.marker);
  expect(f.end).toHaveBeenCalledExactlyOnceWith(claim);await f.runtime.settle(Date.now()+5_000);f.runtime.assertSettled();
 });
 it.each(["wrong-key","wrong-allocation","payload","expired","aborted","missing-delete"])("refuses %s before physical deletion",async fault=>{
  const f=fixture();let marker:unknown=f.marker;
  if(fault==="wrong-key")f.marker.objectKey=`export/${randomUUID()}`;
  if(fault==="wrong-allocation")f.marker.allocationSha256="f".repeat(64);
  if(fault==="payload")marker={...f.marker,kind:"owned-payload",byteCount:3,writeBindingSha256:f.binding.writeBindingSha256};
  if(fault==="expired")f.binding.claimExpiresAt=new Date(Date.now()-1).toISOString();
  if(fault==="aborted")f.stop.abort();if(fault==="missing-delete")delete f.stub.deleteCurrent;
  await expect(f.gateway.eraseCurrent(f.binding,marker as R2CurrentMarker,f.stop.signal)).rejects.toThrow();
  expect(f.begin).not.toHaveBeenCalled();expect(f.erase).not.toHaveBeenCalled();expect(f.end).not.toHaveBeenCalled();
  await f.runtime.settle(Date.now()+5_000);f.runtime.assertSettled();
 });
 it.each(["bucket","bindingSha256","protocol"] as const)("refuses a changed native/service %s before content or terminal claim",async key=>{
  const f=fixture();f.describe.mockResolvedValue({...f.configuration,[key]:key==="bucket"?"inherit-export-foreign":key==="protocol"?"foreign-protocol":"f".repeat(64)} as typeof f.configuration);
  await expect(f.gateway.assertConfiguration(f.configuration,f.stop.signal)).rejects.toThrow();
  await expect(f.gateway.eraseCurrent(f.binding,f.marker,f.stop.signal)).rejects.toThrow();
  expect(f.begin).not.toHaveBeenCalled();expect(f.erase).not.toHaveBeenCalled();await f.runtime.settle(Date.now()+5_000);f.runtime.assertSettled();
 });
 it("retains an uncertain terminal claim without submitting a deletion or claiming release",async()=>{
  const f=fixture();f.begin.mockRejectedValue(new Error("synthetic unknown terminal claim"));
  await expect(f.gateway.eraseCurrent(f.binding,f.marker,f.stop.signal)).rejects.toThrow();
  expect(f.begin).toHaveBeenCalledOnce();expect(f.erase).not.toHaveBeenCalled();expect(f.end).not.toHaveBeenCalled();
  await f.runtime.settle(Date.now()+5_000);f.runtime.assertSettled();
 });
 it.each(["false-terminal","false-absence","extra-output","unknown-delete","changed-after-delete","release-refused","aborted-after-delete"])(
  "does not return acceptance for %s or resubmit the physical operation",async fault=>{
   const f=fixture();
   if(fault==="false-terminal")f.erase.mockResolvedValue({terminal:false,absent:true});
   if(fault==="false-absence")f.erase.mockResolvedValue({terminal:true,absent:false});
   if(fault==="extra-output")f.erase.mockResolvedValue({terminal:true,absent:true,provider:"private-output"});
   if(fault==="unknown-delete")f.erase.mockRejectedValue(new Error("synthetic unknown delete response"));
   if(fault==="changed-after-delete")f.describe.mockResolvedValueOnce(f.configuration).mockResolvedValue({...f.configuration,bindingSha256:"f".repeat(64)});
   if(fault==="release-refused")f.end.mockResolvedValue(false);
   if(fault==="aborted-after-delete")f.erase.mockImplementation(async()=>{f.stop.abort();return {terminal:true,absent:true};});
   await expect(f.gateway.eraseCurrent(f.binding,f.marker,f.stop.signal)).rejects.toThrow();
   expect(f.begin).toHaveBeenCalledOnce();expect(f.erase).toHaveBeenCalledOnce();expect(f.end).toHaveBeenCalledOnce();
   await f.runtime.settle(Date.now()+5_000);f.runtime.assertSettled();
  });
 it("refuses overlapping cleanup while an actual deletion remains unsettled",async()=>{
  const f=fixture(),entered=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
  f.erase.mockImplementation(async()=>{entered.resolve();await finish.promise;return {terminal:true,absent:true};});
  const first=f.gateway.eraseCurrent(f.binding,f.marker,f.stop.signal);await entered.promise;
  await expect(f.gateway.eraseCurrent(f.binding,f.marker,f.stop.signal)).rejects.toThrow();expect(f.erase).toHaveBeenCalledOnce();
  finish.resolve();await first;expect(f.end).toHaveBeenCalledOnce();await f.runtime.settle(Date.now()+5_000);f.runtime.assertSettled();
 });
});
