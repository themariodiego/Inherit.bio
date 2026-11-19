import {createHash,randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createEmbryoFragmentGateway,createEmbryoFixtureSigner,EMBRYO_FIXTURE_BUCKET,EMBRYO_FIXTURE_ORIGIN,EMBRYO_FIXTURE_SUPABASE_URL} from "../../../scripts/ci-browser/embryo-fragment-fixture";
import type {EmbryoFragmentRpc} from "@/lib/embryos/fragment-storage";
import {completeClaimantDeletion,maintainClaimantDeletion,type ClaimantDeletionExecution} from "./claimant-deletion";
const manifestId=randomUUID(),sessionHash="a".repeat(64),operationNonce="claimant-delete-nonce-aaaaaaaa";
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
let gateway:ReturnType<typeof createEmbryoFragmentGateway>;
beforeEach(async()=>{
 const signer=await createEmbryoFixtureSigner();gateway=createEmbryoFragmentGateway(signer.publicJwk);
 vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK",JSON.stringify(signer.privateJwk));vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",EMBRYO_FIXTURE_SUPABASE_URL);
 vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN",EMBRYO_FIXTURE_ORIGIN);vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET",EMBRYO_FIXTURE_BUCKET);
 vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>gateway.fetch(new Request(url,init))));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function fixture(mode="complete"){
 const row={version:"future-person-source-disposal-v1",manifestId,ordinal:1,bucket:EMBRYO_FIXTURE_BUCKET,
  objectKey:`embryo/${randomUUID()}`,byteCount:8,sha256:sha("payload!"),claimExpiresAt:new Date(Date.now()+50_000).toISOString()};
 let acknowledged=false,claimToken:string|undefined;const operations:string[]=[];
 // The sealed plan's own identity objects and original upload copies. The
 // default plan has none left, as after the ordinary retention removal.
 const identity=mode==="identity-documents"||mode==="identity-remove-fails"||mode==="identity-left-over"
  ?[`${randomUUID()}/${randomUUID()}/${randomUUID()}`,`${randomUUID()}/${randomUUID()}/${randomUUID()}`]:[];
 const unwindId=randomUUID();let copies=mode==="original-copies"||mode==="original-copies-held"?1:0;
 const cleanup:string[]=[];const removed:string[][]=[];
 const documents={remove:vi.fn(async(keys:readonly string[])=>{
  cleanup.push("remove");if(mode==="identity-remove-fails")throw new Error("private-provider-refusal");removed.push([...keys]);})};
 const sealedDoor=(name:string,args:Record<string,unknown>)=>{
  cleanup.push(name==="future_person_deletion_objects_v1"?String(args.p_operation):name);
  if(name!=="future_person_deletion_objects_v1"){
   expect(args.p_unwind_id).toBe(unwindId);
   if(name==="claim_embryo_ingest_object_disposals_v1")return {data:{status:"idle"},error:null};
   if(name==="confirm_embryo_ingest_unwind_storage_v1")return {data:{status:mode==="original-copies-held"?"storage_pending":"storage_confirmed"},error:null};
   if(name==="complete_embryo_ingest_unwind_v1"){copies=0;return {data:{status:"complete"},error:null};}
   return {data:null,error:{code:"42501"}};
  }
  expect(args.p_manifest).toBe(manifestId);expect(args.p_claim_token_hash).toBe(claimToken);expect(acknowledged).toBe(true);
  if(args.p_operation==="documents")return {data:{status:"documents",manifestId,
   objectKeys:mode==="identity-left-over"||removed.length===0?identity:[]},error:null};
  if(args.p_operation==="confirm-documents"){expect(args.p_object_keys).toEqual(identity);
   return {data:{status:"documents_confirmed",manifestId,remaining:0},error:null};}
  return {data:{status:"unwind",manifestId,unwindId:copies?unwindId:null,state:copies?"storage_pending":null},error:null};
 };
 const parts:EmbryoFragmentRpc=(name,args)=>({abortSignal:async()=>{
  if(name!=="future_person_deletion_parts_v1")return sealedDoor(name,args);
  operations.push(String(args.p_operation));
  if(args.p_operation==="claim"){claimToken=String(args.p_claim_token_hash);return {data:{status:"claimed",manifestId,objects:[row]},error:null};}
  if(args.p_operation==="acknowledge"){
   expect(args.p_expected).toEqual(row);expect(args.p_claim_token_hash).toBe(claimToken);
   expect(gateway.values.get(row.objectKey)?.tombstone).toBe(true);expect(gateway.values.get(row.objectKey)?.bytes.byteLength).toBe(0);
   acknowledged=mode!=="lost-ack"&&mode!=="contradictory-ack";
   return {data:{status:"tombstone_acknowledged",manifestId,ordinal:1},error:acknowledged?null:{code:"42501"}};
  }
  return {data:{status:(mode==="contradictory-ack"||acknowledged&&mode!=="pending")?"source_tombstoned":"source_pending"},error:null};
 }});
 const execution:ClaimantDeletionExecution={assertReady:vi.fn(async()=>{if(mode==="not-ready")throw new Error("closed");}),
  prepare:vi.fn(async()=>manifestId),parts,documents,due:vi.fn(async()=>[{manifestId}]),
  finish:vi.fn(async(id,token)=>{
   expect(id).toBe(manifestId);expect(token).toBe(claimToken);expect(acknowledged).toBe(true);expect(operations.at(-1)).toBe("proof");
   cleanup.push("finish");
   if(mode==="graph-held"||mode==="unknown-commit")throw new Error("closed");
   return mode==="extra-receipt"?{status:"deleted",subjectId:randomUUID()}:mode==="false-terminal"?{status:"source_tombstoned"}:{status:"deleted"};
  })};
 return {row,execution,operations,cleanup,removed,identity,documents};
}
const run=(execution:ClaimantDeletionExecution)=>completeClaimantDeletion({execution,sessionHash,operationNonce,signal:new AbortController().signal});
describe("complete claimed-subject deletion boundary",()=>{
 it("accepts only after real provider empty-marker/ACK and exact whole native terminal",async()=>{
  const f=fixture();await gateway.binding.put(f.row.objectKey,new TextEncoder().encode("payload!"),{});
  expect(await run(f.execution)).toEqual({status:"deletion_accepted"});expect(f.execution.prepare).toHaveBeenCalledTimes(1);expect(f.execution.finish).toHaveBeenCalledTimes(1);
  expect(f.operations).toEqual(["claim","acknowledge","proof"]);
 });
 it.each(["lost-ack","contradictory-ack","pending","graph-held","unknown-commit","extra-receipt","false-terminal"])("%s never accepts or retries a request/finisher",async mode=>{
  const f=fixture(mode);await gateway.binding.put(f.row.objectKey,new TextEncoder().encode("payload!"),{});await expect(run(f.execution)).rejects.toThrow();expect(f.execution.prepare).toHaveBeenCalledTimes(1);
  expect(f.execution.finish).toHaveBeenCalledTimes(mode==="lost-ack"||mode==="contradictory-ack"||mode==="pending"?0:1);
 });
 it("removes the plan's own identity objects and confirms exactly those keys before the final transaction",async()=>{
  const f=fixture("identity-documents");await gateway.binding.put(f.row.objectKey,new TextEncoder().encode("payload!"),{});
  expect(await run(f.execution)).toEqual({status:"deletion_accepted"});
  expect(f.removed).toEqual([f.identity]);expect(f.operations).toEqual(["claim","acknowledge","proof"]);
  expect(f.cleanup).toEqual(["documents","remove","confirm-documents","documents","unwind","finish"]);
  expect(f.execution.prepare).toHaveBeenCalledTimes(1);expect(f.execution.finish).toHaveBeenCalledTimes(1);
 });
 it("completes the source session's original published cleanup through the existing doors before the final transaction",async()=>{
  const f=fixture("original-copies");await gateway.binding.put(f.row.objectKey,new TextEncoder().encode("payload!"),{});
  expect(await run(f.execution)).toEqual({status:"deletion_accepted"});expect(f.documents.remove).not.toHaveBeenCalled();
  expect(f.cleanup).toEqual(["documents","unwind","claim_embryo_ingest_object_disposals_v1","confirm_embryo_ingest_unwind_storage_v1",
   "complete_embryo_ingest_unwind_v1","unwind","finish"]);
 });
 it.each(["identity-remove-fails","identity-left-over","original-copies-held"])("%s refuses before the final transaction and never accepts",async mode=>{
  const f=fixture(mode);await gateway.binding.put(f.row.objectKey,new TextEncoder().encode("payload!"),{});
  await expect(run(f.execution)).rejects.toThrow();expect(f.execution.prepare).toHaveBeenCalledTimes(1);
  expect(f.execution.finish).not.toHaveBeenCalled();expect(f.cleanup).not.toContain("finish");
  if(mode==="identity-remove-fails"){expect(f.cleanup).toEqual(["documents","remove"]);expect(f.removed).toEqual([]);}
  if(mode==="identity-left-over")expect(f.removed).toHaveLength(5);
  if(mode==="original-copies-held")expect(f.cleanup.filter(step=>step==="complete_embryo_ingest_unwind_v1")).toEqual([]);
 });
 it("sealed maintenance runs the same object cleanup without a new request or rights nonce",async()=>{
  const f=fixture("identity-documents");await gateway.binding.put(f.row.objectKey,new TextEncoder().encode("payload!"),{});
  expect(await maintainClaimantDeletion({execution:f.execution,signal:new AbortController().signal})).toEqual({completed:1});
  expect(f.removed).toEqual([f.identity]);expect(f.execution.prepare).not.toHaveBeenCalled();expect(f.execution.assertReady).not.toHaveBeenCalled();
  expect(f.cleanup.at(-1)).toBe("finish");
 });
 it("closed readiness prevents preparation, source contact and completion",async()=>{
  const f=fixture("not-ready");await expect(run(f.execution)).rejects.toThrow();expect(f.execution.prepare).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(f.execution.finish).not.toHaveBeenCalled();
 });
 it("an already-aborted request cannot prepare or contact a provider",async()=>{
  const f=fixture(),stop=new AbortController();stop.abort();
  await expect(completeClaimantDeletion({execution:f.execution,sessionHash,operationNonce,signal:stop.signal})).rejects.toThrow();
  expect(f.execution.assertReady).not.toHaveBeenCalled();expect(f.execution.prepare).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it("a real native-selected pending manifest can finish after revocation without preparing or reusing its rights nonce",async()=>{
  const f=fixture();await gateway.binding.put(f.row.objectKey,new TextEncoder().encode("payload!"),{});expect(await maintainClaimantDeletion({execution:f.execution,signal:new AbortController().signal})).toEqual({completed:1});
  expect(f.execution.due).toHaveBeenCalledTimes(1);expect(f.execution.prepare).not.toHaveBeenCalled();expect(f.execution.assertReady).not.toHaveBeenCalled();expect(f.execution.finish).toHaveBeenCalledTimes(1);
 });
 it("empty native discovery performs no source or finish operation",async()=>{
  const f=fixture();f.execution={...f.execution,due:vi.fn(async()=>[])};
  expect(await maintainClaimantDeletion({execution:f.execution,signal:new AbortController().signal})).toEqual({completed:0});
  expect(fetch).not.toHaveBeenCalled();expect(f.execution.finish).not.toHaveBeenCalled();
 });
 it.each([[[{manifestId},{manifestId}]],[[{manifestId,subjectId:randomUUID()}]],[[{manifestId:"missing"}]]])("refuses malformed or oversized discovery %j before any provider bytes",async rows=>{
  const f=fixture();f.execution={...f.execution,due:vi.fn(async()=>rows)};
  await expect(maintainClaimantDeletion({execution:f.execution,signal:new AbortController().signal})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();expect(f.execution.finish).not.toHaveBeenCalled();
 });
});
