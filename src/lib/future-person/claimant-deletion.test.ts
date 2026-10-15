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
 const parts:EmbryoFragmentRpc=(_name,args)=>({abortSignal:async()=>{
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
  prepare:vi.fn(async()=>manifestId),parts,due:vi.fn(async()=>[{manifestId}]),
  finish:vi.fn(async(id,token)=>{
   expect(id).toBe(manifestId);expect(token).toBe(claimToken);expect(acknowledged).toBe(true);expect(operations.at(-1)).toBe("proof");
   if(mode==="graph-held"||mode==="unknown-commit")throw new Error("closed");
   return mode==="extra-receipt"?{status:"deleted",subjectId:randomUUID()}:mode==="false-terminal"?{status:"source_tombstoned"}:{status:"deleted"};
  })};
 return {row,execution,operations};
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
 it.each([[{manifestId},{manifestId}],[{manifestId,subjectId:randomUUID()}],[{manifestId:"missing"}]])("refuses malformed or oversized discovery %j before any provider bytes",async rows=>{
  const f=fixture();f.execution={...f.execution,due:vi.fn(async()=>rows)};
  await expect(maintainClaimantDeletion({execution:f.execution,signal:new AbortController().signal})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();expect(f.execution.finish).not.toHaveBeenCalled();
 });
});
