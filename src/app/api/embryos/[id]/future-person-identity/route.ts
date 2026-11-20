import crypto from "node:crypto";
import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { invalidRequest,notFound,rpcErrorResponse,sensitiveJson,unavailable,SENSITIVE_HEADERS } from "@/lib/embryos/api";
import { originDenied, unauthenticated } from "@/lib/embryos/guards";
import { readBoundedBytes,readBoundedJson } from "@/lib/future-person/bounded-body";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { identityProfileBody,sealIdentityProfile } from "@/lib/future-person/identity-profile";
import { identityProfileContext,readIdentityProfileOperation } from "@/lib/future-person/identity-profile-operation";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAccountCsrf } from "@/lib/security/session-csrf";

const saved=z.object({status:z.literal("saved"),expiresAt:z.iso.datetime({offset:true})}).strict();
/** The optional parent matching profile, never a genetic-data writer. The
 * database rechecks the evidenced recipient and current signed artifact in
 * the subject-first mutation transaction. Production remains closed. The
 * shell's one-time X-Inherit-CSRF token for the account session is verified
 * and spent before either method runs (G8.5). The page's operation token
 * travels in X-Inherit-Operation-Nonce and its derived proof, which until
 * 19 November 2026 was X-Inherit-CSRF, in X-Inherit-Operation-Proof; both are
 * checked together as before. */
export const PUT=withAccountCsrf("api.future-person-identity-profile",async(request:Request,context:{params:Promise<{id:string}>})=>
  mutate(request,(await context.params).id,"save"));
export const DELETE=withAccountCsrf("api.future-person-identity-profile",async(request:Request,context:{params:Promise<{id:string}>})=>
  mutate(request,(await context.params).id,"delete"));
async function mutate(request:Request,id:string,operation:"save"|"delete"):Promise<Response> {
  if(!futurePersonClaimsOpen()||!z.uuid().safeParse(id).success||new URL(request.url).search)return notFound();
  const account=await getSensitiveAccountContext();if(!account)return unauthenticated();
  const denied=originDenied(request);if(denied)return denied;
  let input:z.infer<typeof identityProfileBody>|null=null;
  if(operation==="save"){
    if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")return invalidRequest(["body"]);
    const parsed=identityProfileBody.safeParse(await readBoundedJson(request,8192));
    if(!parsed.success)return invalidRequest(["body"]);input=parsed.data;
  }else{
    const body=await readBoundedBytes(request,0);
    if(body.kind!=="bytes"||body.bytes.length!==0)return invalidRequest(["body"]);
  }
  const admin=createAdminClient();
  const {data,error}=await admin.rpc("future_person_profile_context_v1",{
    p_account:account.user.id,p_session:account.sessionId,p_embryo:id,p_signature:input?.consentSignatureId??null,
  });
  if(error)return rpcErrorResponse(error);
  const parsed=identityProfileContext.safeParse(data);
  if(!parsed.success||parsed.data.embryoId!==id||parsed.data.consentSignatureId!==(input?.consentSignatureId??null))return unavailable();
  const expected=parsed.data;
  const proof=readIdentityProfileOperation(request.headers.get("x-inherit-operation-nonce"),request.headers.get("x-inherit-operation-proof"),
    {accountId:account.user.id,sessionId:account.sessionId,embryoId:id,operation},expected);
  if(!proof)return notFound();
  if(operation==="delete"){
    const result=await admin.rpc("delete_future_person_profile_v1",{p_account:account.user.id,p_session:account.sessionId,
      p_embryo:id,p_expected:expected,p_nonce:proof.nonce});
    if(result.error)return rpcErrorResponse(result.error);
    return new Response(null,{status:204,headers:SENSITIVE_HEADERS});
  }
  let sealed:ReturnType<typeof sealIdentityProfile>|undefined;
  try{
    const profileId=crypto.randomUUID();sealed=sealIdentityProfile(input!,{profileId,embryoId:id,identityRevision:expected.nextIdentityRevision});
    const result=await admin.rpc("write_future_person_profile_v1",{p_account:account.user.id,p_session:account.sessionId,p_embryo:id,
      p_signature:input!.consentSignatureId,p_expected:expected,p_profile:profileId,p_nonce:proof.nonce,
      p_ciphertext:`\\x${sealed.ciphertext.toString("hex")}`,p_wrapped_key:`\\x${sealed.wrappedKey.toString("hex")}`,p_indexes:sealed.matchIndexes});
    if(result.error)return rpcErrorResponse(result.error);
    const response=saved.safeParse(result.data);if(!response.success)return unavailable();
    if(Date.parse(response.data.expiresAt)!==Date.parse(expected.expiresAt))return unavailable();
    return sensitiveJson(response.data);
  }catch{return unavailable();}finally{sealed?.wrappedKey.fill(0);sealed?.ciphertext.fill(0);}
}
