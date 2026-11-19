import {randomUUID} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {EmbryoFragmentRpc} from "@/lib/embryos/fragment-storage";
import {disposeClaimantObjects} from "./claimant-object-cleanup";

// Pure protocol controls over explicit native doubles: what the sealed door
// lists is the only thing removed, and every unexpected answer refuses.
const manifestId=randomUUID(),claimTokenHash="c".repeat(64),unwindId=randomUUID();
const key=()=>`${randomUUID()}/${randomUUID()}/${randomUUID()}`,duplicate=key();
let answers:Record<string,unknown[]>,calls:{name:string;args:Record<string,unknown>}[];
const rpc:EmbryoFragmentRpc=(name,args)=>({abortSignal:async()=>{
 calls.push({name,args});const operation=name==="future_person_deletion_objects_v1"?String(args.p_operation):name;
 const queue=answers[operation];if(!queue?.length)throw new Error(`unexpected ${operation}`);
 return {data:queue.shift(),error:null};
}});
const documents={remove:vi.fn<(keys:readonly string[])=>Promise<void>>(async()=>{})};
const none={status:"unwind",manifestId,unwindId:null,state:null};
const run=(signal=new AbortController().signal)=>disposeClaimantObjects({rpc,documents,manifestId,claimTokenHash,signal});
beforeEach(()=>{vi.clearAllMocks();calls=[];answers={};});
describe("sealed claimant object cleanup",()=>{
 it("removes exactly the listed identity keys, confirms those keys and reaches no cleanup door when none is outstanding",async()=>{
  const keys=[key(),key()].sort();
  answers={documents:[{status:"documents",manifestId,objectKeys:keys},{status:"documents",manifestId,objectKeys:[]}],
   "confirm-documents":[{status:"documents_confirmed",manifestId,remaining:0}],unwind:[none]};
  await run();expect(documents.remove).toHaveBeenCalledExactlyOnceWith(keys);
  expect(calls.map(call=>call.name==="future_person_deletion_objects_v1"?call.args.p_operation:call.name))
   .toEqual(["documents","confirm-documents","documents","unwind"]);
  expect(calls[1].args).toEqual({p_operation:"confirm-documents",p_manifest:manifestId,p_claim_token_hash:claimTokenHash,p_object_keys:keys});
  for(const call of calls)expect(call.args.p_claim_token_hash).toBe(claimTokenHash);
 });
 it.each([
  ["a non-registered key shape",{status:"documents",manifestId,objectKeys:["../escape"]}],
  ["another plan",{status:"documents",manifestId:randomUUID(),objectKeys:[]}],
  ["a duplicated key",{status:"documents",manifestId,objectKeys:[duplicate,duplicate]}],
  ["an extra field",{status:"documents",manifestId,objectKeys:[],subjectId:randomUUID()}],
  ["more than one hundred keys",{status:"documents",manifestId,objectKeys:Array.from({length:101},key)}],
 ])("refuses a listing with %s before any removal or confirmation",async(_label,value)=>{
  answers={documents:[value],unwind:[none]};
  await expect(run()).rejects.toThrow();expect(documents.remove).not.toHaveBeenCalled();
  expect(calls.map(call=>call.args.p_operation)).toEqual(["documents"]);
 });
 it("never confirms when the actual provider removal fails",async()=>{
  documents.remove.mockRejectedValueOnce(new Error("private-provider-refusal"));
  answers={documents:[{status:"documents",manifestId,objectKeys:[key()]}]};
  await expect(run()).rejects.toThrow("private-provider-refusal");
  expect(calls.map(call=>call.args.p_operation)).toEqual(["documents"]);
 });
 it("refuses a confirmation that names another plan",async()=>{
  answers={documents:[{status:"documents",manifestId,objectKeys:[key()]}],
   "confirm-documents":[{status:"documents_confirmed",manifestId:randomUUID(),remaining:0}]};
  await expect(run()).rejects.toThrow();expect(calls.some(call=>call.args.p_operation==="unwind")).toBe(false);
 });
 it("drives only the named outstanding cleanup through the existing doors until it is complete",async()=>{
  answers={documents:[{status:"documents",manifestId,objectKeys:[]}],
   unwind:[{status:"unwind",manifestId,unwindId,state:"storage_confirmed"},none],
   complete_embryo_ingest_unwind_v1:[{status:"complete"}]};
  await run();
  expect(calls.filter(call=>call.name!=="future_person_deletion_objects_v1")).toEqual([
   {name:"complete_embryo_ingest_unwind_v1",args:{p_unwind_id:unwindId}}]);
 });
 it.each([
  [{status:"unwind",manifestId,unwindId,state:"planned"}],
  [{status:"unwind",manifestId,unwindId,state:null}],
  [{status:"unwind",manifestId,unwindId:null,state:"storage_pending"}],
  [{status:"unwind",manifestId:randomUUID(),unwindId:null,state:null}],
  [{status:"unwind",manifestId,unwindId,state:"storage_pending",cohortId:randomUUID()}],
 ])("refuses an unready, malformed or crossed cleanup selector %j without any cleanup door",async value=>{
  answers={documents:[{status:"documents",manifestId,objectKeys:[]}],unwind:[value]};
  await expect(run()).rejects.toThrow();
  expect(calls.filter(call=>call.name!=="future_person_deletion_objects_v1")).toEqual([]);
 });
 it("an outstanding cleanup that never confirms is a bounded refusal, never completion",async()=>{
  const pending={status:"unwind",manifestId,unwindId,state:"storage_pending"};
  answers={documents:[{status:"documents",manifestId,objectKeys:[]}],unwind:Array(9).fill(pending),
   claim_embryo_ingest_object_disposals_v1:Array(8).fill({status:"idle"}),
   confirm_embryo_ingest_unwind_storage_v1:Array(8).fill({status:"storage_pending"})};
  await expect(run()).rejects.toThrow("claimant_cleanup_unavailable");
  expect(calls.filter(call=>call.name==="complete_embryo_ingest_unwind_v1")).toEqual([]);
  expect(calls.filter(call=>call.name==="claim_embryo_ingest_object_disposals_v1")).toHaveLength(8);
 });
 it("an already-aborted continuation reaches no door and removes nothing",async()=>{
  const stop=new AbortController();stop.abort();await expect(run(stop.signal)).rejects.toThrow();
  expect(calls).toEqual([]);expect(documents.remove).not.toHaveBeenCalled();
 });
});
