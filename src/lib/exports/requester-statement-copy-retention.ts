import "server-only";
import {z} from "zod";
import {disposeRequesterStatementR2Segment,type RequesterStatementR2Gateway} from "./requester-statement-r2";
const result=z.object({disposed:z.number().int().nonnegative().safe(),held:z.number().int().nonnegative().safe(),
 segments:z.array(z.object({attemptId:z.uuid(),ordinal:z.number().int().nonnegative().safe()}).strict()).max(25)}).strict();
type Rpc=(name:"drain_due_requester_statement_copies_v1",signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
/** Trusted scheduled composition. Its actual gateway binding is required for
 * provider work. A missing binding leaves exact durable copies held. No expiry,
 * metadata DELETE, accepted mail or process absence counts as disposal. */
export async function drainRequesterStatementCopies(rpc:Rpc,gateway:RequesterStatementR2Gateway,signal:AbortSignal){
 async function scan(){if(signal.aborted)throw new Error("statement_copy_retention_unavailable");
  const response=await rpc("drain_due_requester_statement_copies_v1",signal);
  if(response.error!==null||signal.aborted)throw new Error("statement_copy_retention_unavailable");return result.parse(response.data);}
 const before=await scan();let failed=0;
 for(const segment of before.segments){try{await disposeRequesterStatementR2Segment(segment.attemptId,segment.ordinal,gateway,signal);}
  catch{failed++;}}
 const after=await scan();return {...after,failed};
}
