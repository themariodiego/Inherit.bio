import "server-only";
import {z} from "zod";
import {appealCaseScope,openNewAppealDeliveryContact} from "./appeal-case-envelope";
import type {Json} from "@/lib/supabase/types";

const unavailable=()=>new Error("appeal_mail_unavailable");
const selected=z.object({scope:appealCaseScope,caseContactId:z.uuid(),
 wrappedCaseKeyHex:z.string().regex(/^[0-9a-f]{144}$/u),
 contactCiphertextHex:z.string().regex(/^(?:[0-9a-f]{2}){29,282}$/u)}).strict();
type Native={rpc(name:"read_new_public_appeal_mail_contact_v1",args:{p_outbox_id:string;p_attempt_ordinal:number}):{
 retry(value:false):{abortSignal(signal:AbortSignal):PromiseLike<{data:Json|null;error:unknown}>}
}};
/** A claimed mail row selects neither an account nor arbitrary ciphertext.
 * Read the current case's original envelope from its dedicated native door;
 * compare it to the actual claimed contact before unwrap. The existing mail
 * worker then rechecks native submission authority immediately before send. */
export async function readNewPublicAppealMailContact(native:Native,outboxId:string,attempt:number,
 claimedCiphertextHex:string,signal:AbortSignal){
 if(signal.aborted||!z.uuid().safeParse(outboxId).success||!Number.isSafeInteger(attempt)||attempt<1||attempt>10)throw unavailable();
 const result=await native.rpc("read_new_public_appeal_mail_contact_v1",{
  p_outbox_id:outboxId,p_attempt_ordinal:attempt}).retry(false).abortSignal(signal);
 const projection=selected.safeParse(result.data);
 if(signal.aborted||result.error!==null||!projection.success
  ||projection.data.contactCiphertextHex!==claimedCiphertextHex)throw unavailable();
 return openNewAppealDeliveryContact(projection.data.scope,projection.data.wrappedCaseKeyHex,projection.data.contactCiphertextHex);
}
