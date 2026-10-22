import "server-only";
import {mintPublicFormToken} from "@/lib/embryos/operation-token";
import {claimantSessionHash,loadClaimantRights} from "./rights";
import {configuredTestClaimantDeletion} from "./claimant-deletion-test";

/** Only a current native claimed-unbound rights view and genuine configured
 * TEST service may present this one-use control. No key/account/parent target
 * is sent to the client. Presentation never prepares a deletion or emits an
 * acceptance. The independently current native mutation still decides it. */
export async function presentClaimantDeletion(request:Request){
 const execution=configuredTestClaimantDeletion();if(!execution)return null;
 const sessionHash=claimantSessionHash(request);if(!sessionHash)return null;
 try{
  const current=await loadClaimantRights(request);
  if(!current?.view.allowedActionIds.includes("delete"))return null;
  await execution.assertReady(request.signal);request.signal.throwIfAborted();
  return Object.freeze({csrf:current.csrf,nonce:mintPublicFormToken("future-person-delete",Date.now(),sessionHash)});
 }catch{return null;}
}
