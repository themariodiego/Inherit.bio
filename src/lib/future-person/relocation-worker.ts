import "server-only";
import {createHash,randomBytes} from "node:crypto";
import {z} from "zod";
import {isTestJurisdictionEnabled} from "@/lib/legal/jurisdictions";
import {createAdminClient} from "@/lib/supabase/admin";
import {copyRelocation,readRelocation,disposeRelocation,relocationTargetSchema,relocatedIdentitySchema,
 type RelocationTarget,type RelocatedIdentity} from "./relocation-transport";
export type RelocationRpc=(name:string,args:Record<string,unknown>)=>{
 abortSignal(signal:AbortSignal):PromiseLike<{data:unknown;error:unknown}>};
const uuid=z.uuid();
const workSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("copy"),relocationId:uuid}).strict(),
 z.object({kind:z.literal("expired"),relocationId:uuid,attemptId:uuid}).strict(),
 z.object({kind:z.literal("cleanup"),relocationId:uuid,attemptId:uuid}).strict()]);
const cleanupSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("old"),target:relocationTargetSchema,identity:relocatedIdentitySchema}).strict(),
 z.object({kind:z.literal("new"),target:relocationTargetSchema,identity:z.null()}).strict()]);
const token=()=>createHash("sha256").update(randomBytes(32)).digest("hex");
export type RelocationResult="idle"|"swapped"|"complete"|"cleaned"|"failure_pending";
export class RelocationWorkerError extends Error {
 constructor(){super("future_person_relocation_unavailable");this.name="RelocationWorkerError";}
}
/** One registered database-owned item. No prefix, client path or request
 * selector chooses a source. Copy and cleanup are distinct irreversible
 * dispositions, so an uncertain swap response never deletes a committed key. */
export async function runNextFuturePersonRelocation(options:{signal:AbortSignal;rpc?:RelocationRpc;
 copy?:typeof copyRelocation;read?:typeof readRelocation;dispose?:typeof disposeRelocation}):Promise<RelocationResult>{
 if(!isTestJurisdictionEnabled())throw new RelocationWorkerError();
 const rpc=options.rpc??(()=>{const admin=createAdminClient();return admin.rpc.bind(admin) as RelocationRpc;})();
 const call=async(name:string,args:Record<string,unknown>,signal=options.signal)=>{
  const result=await rpc(name,args).abortSignal(signal);if(result.error)throw new RelocationWorkerError();return result.data;
 };
 const raw=await call("future_person_relocation_work_v1",{});if(raw===null)return "idle";
 const work=workSchema.parse(raw);
 if(work.kind==="expired"){
  if(await call("fence_future_person_relocation_v1",{p_id:work.relocationId,p_token_hash:null})!==true)throw new RelocationWorkerError();
  return "failure_pending";
 }
 if(work.kind==="cleanup"){
  const hash=token(),rawReceipt=await call("claim_future_person_relocation_cleanup_v1",{p_attempt:work.attemptId,p_token_hash:hash});
  if(rawReceipt===null)return "idle";const receipt=cleanupSchema.parse(rawReceipt);
  if(receipt.target.attemptId!==work.attemptId||receipt.target.relocationId!==work.relocationId)throw new RelocationWorkerError();
  const args={p_attempt:work.attemptId,p_token_hash:hash,p_expected:receipt};
  if(await call("check_future_person_relocation_cleanup_v1",args)!==true)throw new RelocationWorkerError();
  const evidence=await (options.dispose??disposeRelocation)(receipt.target,receipt.kind,options.signal,
   receipt.identity??undefined);
  if(await call("finish_future_person_relocation_v1",{...args,p_evidence:evidence})!==true)throw new RelocationWorkerError();
  return receipt.kind==="old"?"complete":"cleaned";
 }
 const hash=token(),claim={p_id:work.relocationId,p_token_hash:hash};
 const rawTarget=await call("claim_future_person_relocation_v1",claim);if(rawTarget===null)return "idle";
 let target:RelocationTarget;
 try{
  target=relocationTargetSchema.parse(rawTarget);if(target.relocationId!==work.relocationId)throw new RelocationWorkerError();
  const current=async()=>{if(!isTestJurisdictionEnabled()||await call("check_future_person_relocation_v1",claim)!==true)
   throw new RelocationWorkerError();};
  await current();
  const identity:RelocatedIdentity=await (options.copy??copyRelocation)(target,options.signal);
  await current();
  const bytes=await (options.read??readRelocation)(target,identity,options.signal);
  const sha256=createHash("sha256").update(bytes).digest("hex");
  if(bytes.byteLength!==target.byteCount||sha256!==target.sha256)throw new RelocationWorkerError();
  await current();
  if(await call("swap_future_person_relocation_v1",{...claim,p_target:target,p_identity:identity,
   p_bytes:bytes.byteLength,p_sha256:sha256})!==true)throw new RelocationWorkerError();
  return "swapped";
 }catch{
  // This persisted fence selects ONLY an uncommitted attempt's new key. If
  // swap committed but its response was lost, SQL refuses the fence; the
  // committed current key remains intact and later work retires only the old.
  try{await call("fence_future_person_relocation_v1",claim,AbortSignal.timeout(30000));}catch{ /* expiry reaper owns unresolved claims */ }
  return "failure_pending";
 }
}
function idle(signal:AbortSignal){return new Promise<void>(resolve=>{
 if(signal.aborted){resolve();return;}
 const stop=()=>{clearTimeout(timer);signal.removeEventListener("abort",stop);resolve();};
 const timer=setTimeout(stop,5000);signal.addEventListener("abort",stop,{once:true});
 if(signal.aborted)stop();});}
export async function runFuturePersonRelocationLoop(options:{signal:AbortSignal;maximumIterations?:number;
 emit:(event:"relocation_idle"|"relocation_swapped"|"relocation_complete"|"relocation_cleaned"|"relocation_failure_pending"|"relocation_failed"|"worker_stopped")=>void;
 runNext?:typeof runNextFuturePersonRelocation}){
 if(!isTestJurisdictionEnabled()||(options.maximumIterations!==undefined&&(!Number.isSafeInteger(options.maximumIterations)
  ||options.maximumIterations<1||options.maximumIterations>1000)))throw new RelocationWorkerError();
 let count=0,hadFailure=false;
 while(!options.signal.aborted&&(options.maximumIterations===undefined||count<options.maximumIterations)){
  let worked=false;
  try{const result=await (options.runNext??runNextFuturePersonRelocation)({signal:options.signal});
   options.emit(`relocation_${result}`);worked=result!=="idle";if(result==="failure_pending")hadFailure=true;
  }catch{if(options.signal.aborted)break;hadFailure=true;options.emit("relocation_failed");}
  count++;if(options.maximumIterations!==undefined&&count>=options.maximumIterations)break;
  if(!worked)await idle(options.signal);
 }
 if(options.signal.aborted)options.emit("worker_stopped");return {hadFailure};
}
