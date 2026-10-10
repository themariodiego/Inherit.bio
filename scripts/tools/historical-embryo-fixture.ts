import {z} from "zod";
import {readEmbryoOperation,verifyEmbryoOperation} from "../../src/lib/embryos/operation-token";

const input=z.object({embryoId:z.uuid(),parents:z.tuple([
  z.object({accountId:z.uuid(),token:z.string().min(1).max(4096)}).strict(),
  z.object({accountId:z.uuid(),token:z.string().min(1).max(4096)}).strict(),
])}).strict();

/** Tooling only. Tokens come from actual current native parent controls;
 * SQL rechecks their own real Auth sessions and complete current matrix.
 * A caller cannot set an effective clock or manufacture the inner nonce. */
export function verifiedHistoricalPair(value:unknown){
  const parsed=input.parse(value);
  if(parsed.parents[0].accountId===parsed.parents[1].accountId)throw new Error("Historical fixture unavailable");
  const parents=parsed.parents.map(parent=>{
    const read=readEmbryoOperation(parent.token);
    if(!read)throw new Error("Historical fixture unavailable");
    const claims=verifyEmbryoOperation(parent.token,{accountId:parent.accountId,sessionId:read.sessionId,
      operation:"embryo_disposition",targetKind:"embryo",targetId:parsed.embryoId});
    if(!claims||!z.uuid().safeParse(claims.sessionId).success||!/^[A-Za-z0-9_-]{32}$/u.test(claims.nonce))
      throw new Error("Historical fixture unavailable");
    return {accountId:parent.accountId,sessionId:claims.sessionId,nonce:claims.nonce};
  });
  if(parents[0].sessionId===parents[1].sessionId||parents[0].nonce===parents[1].nonce)
    throw new Error("Historical fixture unavailable");
  return {embryoId:parsed.embryoId,parents};
}
