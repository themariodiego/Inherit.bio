import "server-only";
import {z} from "zod";
import {drainClaimantSource} from "./erasure-storage";
import type {EmbryoFragmentRpc} from "@/lib/embryos/fragment-storage";

const hash=z.string().regex(/^[0-9a-f]{64}$/u),nonce=z.string().regex(/^[A-Za-z0-9_-]{16,256}$/u);
const deleted=z.object({status:z.literal("deleted")}).strict();
const unavailable=()=>new Error("claimant_deletion_unavailable");
/** This service capability owns the real existing native prepare/finish doors.
 * The source adapter owns only sealed source-part provider ACKs. Neither a
 * Boolean, preparation, a tombstone alone nor a supplied receipt is completion. */
export type ClaimantDeletionExecution=Readonly<{
 assertReady(signal:AbortSignal):Promise<void>;
 prepare(sessionHash:string,operationNonce:string,signal:AbortSignal):Promise<unknown>;
 parts:EmbryoFragmentRpc;
 finish(manifestId:string,claimTokenHash:string,signal:AbortSignal):Promise<unknown>;
 due(signal:AbortSignal):Promise<unknown>;
}>;
export async function completeClaimantDeletion(input:{execution:ClaimantDeletionExecution;
 sessionHash:string;operationNonce:string;signal:AbortSignal}){
 hash.parse(input.sessionHash);nonce.parse(input.operationNonce);input.signal.throwIfAborted();
 await input.execution.assertReady(input.signal);input.signal.throwIfAborted();
 // One real request, no replay on an unknown COMMIT. The native request fixes
 // the original seven/thirty-day clocks and revokes capabilities atomically.
 const manifestId=z.uuid().parse(await input.execution.prepare(input.sessionHash,input.operationNonce,input.signal));
 input.signal.throwIfAborted();
 await finishSealedClaimantDeletion({execution:input.execution,manifestId,signal:input.signal});
 return Object.freeze({status:"deletion_accepted" as const});
}

/** Service continuation for a genuinely already sealed plan. It does not create
 * a second request, renew original retention clocks or reactivate rights. The
 * native claim selects only still-pending keys after its original lease expires;
 * an uncertain finish that committed is no longer returned by due(). */
async function finishSealedClaimantDeletion(input:{execution:ClaimantDeletionExecution;manifestId:string;signal:AbortSignal}){
 const manifestId=z.uuid().parse(input.manifestId);let finished=false;
 const source=await drainClaimantSource({rpc:input.execution.parts,manifestId,signal:input.signal,
  finish:async(id,claimTokenHash,signal)=>{
   if(id!==manifestId||finished)throw unavailable();
   hash.parse(claimTokenHash);signal.throwIfAborted();
   deleted.parse(await input.execution.finish(id,claimTokenHash,signal));
   signal.throwIfAborted();finished=true;
  }});
 if(!finished||source.status!=="source_tombstoned"||source.failed!==0||input.signal.aborted)throw unavailable();
}
export async function maintainClaimantDeletion(input:{execution:ClaimantDeletionExecution;signal:AbortSignal}){
 input.signal.throwIfAborted();
 const due=z.array(z.object({manifestId:z.uuid()}).strict()).max(1).parse(await input.execution.due(input.signal));
 input.signal.throwIfAborted();
 if(due.length===0)return Object.freeze({completed:0 as const});
 await finishSealedClaimantDeletion({...input,manifestId:due[0].manifestId});
 return Object.freeze({completed:1 as const});
}
