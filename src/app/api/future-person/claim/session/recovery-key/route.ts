import crypto from "node:crypto";
import {RECORD_KEY_ALPHABET} from "@/lib/embryos/record-key-cards";
import {readBoundedJson} from "@/lib/future-person/bounded-body";
import {sha256Hex} from "@/lib/future-person/claim-session";
import {claimantMutation,recoveryRequest,claimantNotFound as notFound,claimantResponse as closedResponse} from "@/lib/future-person/rights";
import {createAdminClient} from "@/lib/supabase/admin";
export async function POST(request:Request) {
  if(request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json")return notFound();
  const parsed=recoveryRequest.safeParse(await readBoundedJson(request,4096));if(!parsed.success)return notFound();
  const authority=claimantMutation(request,parsed.data.nonce,"future-person-recovery-key");if(!authority)return notFound();
  const random=crypto.randomBytes(20);let key="";
  try {
    for(const byte of random)key+=RECORD_KEY_ALPHABET[byte&31];
    const {data,error}=await createAdminClient().rpc("issue_future_person_recovery_key_v1",{
      p_session_hash:authority.sessionHash,p_nonce:authority.nonce,p_key_hash:sha256Hex(key)});
    if(error||typeof data!=="string"||!/^\d{4}-\d{2}-\d{2}$/u.test(data))return notFound();
    return closedResponse("api.future-person-recovery-key",["recoveryKey","contactMaterialExpiresOn","reverificationBinding","recordRetention"],{
      recoveryKey:key,contactMaterialExpiresOn:data,reverificationBinding:"retained-until-account-binding-key-rotation-or-claimant-deletion",
      recordRetention:"claimed-record-is-not-deleted-by-temporary-contact-expiry"},201);
  } finally{random.fill(0);key="";}
}
