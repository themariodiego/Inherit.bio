import {claimantMutation,claimantNotFound,claimantResponse} from "@/lib/future-person/rights";
import {completeClaimantDeletion} from "@/lib/future-person/claimant-deletion";
import {configuredTestClaimantDeletion} from "@/lib/future-person/claimant-deletion-test";
import {readRightsCsrfSession,withPurposeCsrf} from "@/lib/security/session-csrf";

/** Registered exact accountless DELETE. This candidate remains unactivated.
 * No body/target/account/Record Key can replace current native claimant rights.
 * The response is emitted only after actual provider ACK + full native finish
 * and actual owner transport cleanup. Failure never sends a success notice.
 * The rights session's one-time X-Inherit-CSRF token is verified and spent
 * before this runs (G8.5); the delete nonce in X-Inherit-Operation-Nonce is
 * checked as before. */
export const DELETE=withPurposeCsrf("api.future-person-delete",readRightsCsrfSession,handleDelete);
async function handleDelete(request:Request){
 if(request.body!==null||request.headers.has("transfer-encoding")||Number(request.headers.get("content-length")??0)!==0)return claimantNotFound();
 const authority=claimantMutation(request,request.headers.get("x-inherit-operation-nonce")??"","future-person-delete");
 if(!authority)return claimantNotFound();const execution=configuredTestClaimantDeletion();if(!execution)return claimantNotFound();
 try{
  const value=await completeClaimantDeletion({execution,...authority,operationNonce:authority.nonce,signal:request.signal});
  return claimantResponse("api.future-person-delete",["status"],value,202);
 }catch{return claimantNotFound();}
}
