import {beforeEach,describe,expect,it,vi} from "vitest";
import {runTestAccountArchiveDisposal} from "./account-archive-test-disposal";
const native=vi.hoisted(()=>({cleanup:[] as unknown[],allocations:[] as unknown[],events:[] as string[],
 stopped:null as unknown,failCommit:0,commits:0,disposeFail:false,stopFail:false,readyFailAt:0,readyCount:0}));
vi.mock("./account-archive-test-capabilities",()=>({configuredTestAccountArchive:()=>({generation:{
 assertReady:async()=>{native.events.push("configuration");if(++native.readyCount===native.readyFailAt)throw new Error("synthetic private configuration failure");}
}})}));
vi.mock("./requester-statement-private-transport",()=>({configuredRequesterStatementGateway:()=>({actualConfiguredGateway:true})}));
vi.mock("./account-archive-r2",()=>({
 withAccountArchiveR2Owner:async(_env:unknown,_signal:AbortSignal,runtime:{track:unknown},work:(tx:unknown)=>Promise<unknown>)=>{
  expect(runtime.track).toBeTypeOf("function");
  const tx=async(strings:TemplateStringsArray,...args:unknown[])=>{
   const sql=strings.join("?");
   if(sql.includes("private.account_archive_test_cleanup_due_v1")){native.events.push("cleanup-due");return [{due:native.cleanup}];}
   if(sql.includes("public.export_archive_cleanup_v1('stop'")){
    native.events.push(`stop:${args[1]}`);expect(args).toEqual([id(1),id(2)]);
    if(native.stopFail)throw new Error("synthetic stop refused");return [{stopped:native.stopped}];
   }
   if(sql.includes("private.account_archive_test_disposal_due_v1")){native.events.push("allocation-due");return [{due:native.allocations}];}
   throw new Error("unexpected native door");
  };
  const value=await work(tx);if(++native.commits===native.failCommit)throw new Error("synthetic unknown COMMIT");
  native.events.push("commit");return value;
 },
 disposeAccountArchiveR2Object:async(input:{attemptId:string;ordinal:number;gateway:unknown})=>{
  expect(input.gateway).toEqual({actualConfiguredGateway:true});native.events.push(`physical:${input.attemptId}:${input.ordinal}`);
  if(native.disposeFail)throw new Error("synthetic uncertain physical disposal");
 }
}));
const id=(n:number)=>`84000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const env={INHERIT_TEST_JURISDICTION:"1",INHERIT_TEST_ACCOUNT_ARCHIVE_R2:"1"};
const run=()=>runTestAccountArchiveDisposal({env,signal:new AbortController().signal});
beforeEach(()=>Object.assign(native,{cleanup:[],allocations:[],events:[],stopped:{state:"cleanup-pending",notBefore:new Date().toISOString()},
 failCommit:0,commits:0,disposeFail:false,stopFail:false,readyFailAt:0,readyCount:0}));
describe("actual account cleanup transition precedes TEST physical disposal",()=>{
 it("uses only the due native account identities, commits the original stop, then selects exact allocations",async()=>{
  native.cleanup=[{exportId:id(1),attemptId:id(2)}];native.allocations=[{attemptId:id(2),ordinal:0},{attemptId:id(2),ordinal:1}];
  expect(await run()).toEqual({completed:2});expect(native.events).toEqual(["configuration","cleanup-due",`stop:${id(2)}`,"commit",
   "allocation-due","commit","configuration",`physical:${id(2)}:0`,"configuration",`physical:${id(2)}:1`]);
 });
 it("does not stop or erase a live ready allocation absent from both real due pages",async()=>{
  expect(await run()).toEqual({completed:0});expect(native.events).toEqual(["configuration","cleanup-due","commit","allocation-due","commit"]);
 });
 it.each(["unknown-stop-commit","stop-refused","bad-stop-shape","foreign-discovery-field","duplicate-attempt","too-many-due"])("refuses %s before any physical work",async fault=>{
  native.cleanup=[{exportId:id(1),attemptId:id(2)}];native.allocations=[{attemptId:id(2),ordinal:0}];
  if(fault==="unknown-stop-commit")native.failCommit=1;
  if(fault==="stop-refused")native.stopFail=true;
  if(fault==="bad-stop-shape")native.stopped={state:"ready",notBefore:new Date().toISOString()};
  if(fault==="foreign-discovery-field")native.cleanup=[{exportId:id(1),attemptId:id(2),claimId:id(3)}];
  if(fault==="duplicate-attempt")native.cleanup.push(native.cleanup[0]);
  if(fault==="too-many-due")native.cleanup=Array.from({length:17},(_,n)=>({exportId:id(1),attemptId:id(n+2)}));
  await expect(run()).rejects.toThrow();expect(native.events).not.toContain("allocation-due");
  expect(native.events.some(value=>value.startsWith("physical:"))).toBe(false);
 });
 it.each(["unknown-discovery-commit","duplicate-allocation","bad-ordinal","foreign-allocation-field"])("refuses %s without deletion or adoption",async fault=>{
  native.allocations=[{attemptId:id(2),ordinal:0}];
  if(fault==="unknown-discovery-commit")native.failCommit=2;
  if(fault==="duplicate-allocation")native.allocations.push(native.allocations[0]);
  if(fault==="bad-ordinal")native.allocations=[{attemptId:id(2),ordinal:-1}];
  if(fault==="foreign-allocation-field")native.allocations=[{attemptId:id(2),ordinal:0,objectKey:"unselected"}];
  await expect(run()).rejects.toThrow();expect(native.events.some(value=>value.startsWith("physical:"))).toBe(false);
 });
 it("stops on uncertain physical disposal and does not retry or continue with the next allocation",async()=>{
  native.allocations=[{attemptId:id(2),ordinal:0},{attemptId:id(2),ordinal:1}];native.disposeFail=true;
  await expect(run()).rejects.toThrow();expect(native.events.filter(value=>value.startsWith("physical:"))).toEqual([`physical:${id(2)}:0`]);
 });
 it("keeps ordinary configuration closed before native discovery",async()=>{
  await expect(runTestAccountArchiveDisposal({env:{},signal:new AbortController().signal})).rejects.toThrow();expect(native.events).toEqual([]);
 });
 it.each([1,2,3])("rechecks native/provider TEST configuration before discovery and each object, refusing check %i",async position=>{
  native.allocations=[{attemptId:id(2),ordinal:0},{attemptId:id(2),ordinal:1}];native.readyFailAt=position;
  await expect(run()).rejects.toThrow();
  expect(native.events.filter(value=>value.startsWith("physical:"))).toHaveLength(Math.max(0,position-2));
  if(position===1)expect(native.events).toEqual(["configuration"]);
 });
});
