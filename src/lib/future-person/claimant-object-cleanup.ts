import "server-only";
import {z} from "zod";
import type {EmbryoFragmentRpc} from "@/lib/embryos/fragment-storage";
import {completeEmbryoUnwind,drainEmbryoUnwindStorage} from "@/lib/embryos/unwind-storage";
import type {ClaimObjectStore} from "./claim-objects";

const key=z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/u);
const listing=z.object({status:z.literal("documents"),manifestId:z.uuid(),objectKeys:z.array(key).max(100)}).strict()
 .refine(value=>new Set(value.objectKeys).size===value.objectKeys.length);
const confirmation=z.object({status:z.literal("documents_confirmed"),manifestId:z.uuid(),
 remaining:z.number().int().min(0).max(100)}).strict();
const cleanup=z.object({status:z.literal("unwind"),manifestId:z.uuid(),unwindId:z.uuid().nullable(),
 state:z.enum(["planned","storage_pending","storage_confirmed"]).nullable()}).strict()
 .refine(value=>(value.unwindId===null)===(value.state===null));
const confirmed=z.object({status:z.string().regex(/^[a-z_]{1,40}$/u)}).passthrough();
const unavailable=()=>new Error("claimant_cleanup_unavailable");
/** Identity objects are listed at most 100 at a time; a claimant normally has
 * two. Each round removes what SQL listed and confirms exactly those keys. */
const DOCUMENT_ROUNDS=5;
/** Each pass claims at most 25 original upload copies (the existing door). */
const CLEANUP_PASSES=8;

/** Under the live source-disposal lease, after every source part already has
 * its permanent marker: remove the plan's own sealed identity objects and
 * finish its source session's planned published cleanup through the existing
 * doors. SQL selects every key and unwind; nothing here builds or accepts one.
 * A provider error, a malformed answer or anything left over is a refusal,
 * never completion; the caller then does not invoke the final transaction. */
export async function disposeClaimantObjects(input:{rpc:EmbryoFragmentRpc;documents:Pick<ClaimObjectStore,"remove">;
 manifestId:string;claimTokenHash:string;signal:AbortSignal}):Promise<void>{
 const manifestId=z.uuid().parse(input.manifestId),claimTokenHash=z.string().regex(/^[0-9a-f]{64}$/u).parse(input.claimTokenHash);
 const call=async(operation:"documents"|"confirm-documents"|"unwind",extra:Record<string,unknown>={})=>{
  input.signal.throwIfAborted();
  const {data,error}=await input.rpc("future_person_deletion_objects_v1",{p_operation:operation,p_manifest:manifestId,
   p_claim_token_hash:claimTokenHash,...extra}).abortSignal(input.signal);
  input.signal.throwIfAborted();
  if(error)throw unavailable();
  return data;
 };
 for(let round=0;;round++){
  const listed=listing.parse(await call("documents"));
  if(listed.manifestId!==manifestId)throw unavailable();
  if(listed.objectKeys.length===0)break;
  if(round>=DOCUMENT_ROUNDS)throw unavailable();
  await input.documents.remove(listed.objectKeys);input.signal.throwIfAborted();
  const result=confirmation.parse(await call("confirm-documents",{p_object_keys:listed.objectKeys}));
  if(result.manifestId!==manifestId)throw unavailable();
 }
 for(let pass=0;;pass++){
  const current=cleanup.parse(await call("unwind"));
  if(current.manifestId!==manifestId)throw unavailable();
  if(current.unwindId===null)return;
  if(pass>=CLEANUP_PASSES||current.state==="planned")throw unavailable();
  const unwindId=current.unwindId;
  if(current.state==="storage_pending"){
   const drained=await drainEmbryoUnwindStorage({rpc:input.rpc,unwindId,signal:input.signal});
   input.signal.throwIfAborted();
   if(drained.status!=="storage_confirmed"){
    // An idle claim (nothing left to claim) still needs the original
    // confirmation; it confirms only when every object is resolved.
    const {data,error}=await input.rpc("confirm_embryo_ingest_unwind_storage_v1",{p_unwind_id:unwindId}).abortSignal(input.signal);
    input.signal.throwIfAborted();
    if(error||confirmed.parse(data).status!=="storage_confirmed")continue;
   }
  }
  const completed=await completeEmbryoUnwind({rpc:input.rpc,unwindId,signal:input.signal});
  input.signal.throwIfAborted();
  if(completed.status!=="complete")continue;
 }
}
