import {claimantMutation,claimantNotFound,claimantResponse} from "@/lib/future-person/rights";
import {completeClaimantDeletion} from "@/lib/future-person/claimant-deletion";
import {configuredTestClaimantDeletion} from "@/lib/future-person/claimant-deletion-test";

/** Registered exact accountless DELETE. This candidate remains unactivated.
 * No body/target/account/Record Key can replace current native claimant rights.
 * The response is emitted only after actual provider ACK + full native finish
 * and actual owner transport cleanup. Failure never sends a success notice. */
export async function DELETE(request:Request){
 if(request.body!==null||request.headers.has("transfer-encoding")||Number(request.headers.get("content-length")??0)!==0)return claimantNotFound();
 const authority=claimantMutation(request,request.headers.get("x-inherit-operation-nonce")??"","future-person-delete");
 if(!authority)return claimantNotFound();const execution=configuredTestClaimantDeletion();if(!execution)return claimantNotFound();
 try{
  const value=await completeClaimantDeletion({execution,...authority,operationNonce:authority.nonce,signal:request.signal});
  return claimantResponse("api.future-person-delete",["status"],value,202);
 }catch{return claimantNotFound();}
}
