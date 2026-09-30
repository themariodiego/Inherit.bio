import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintPublicFormToken,readPublicFormToken } from "@/lib/embryos/operation-token";
import { readRightsSessionHash,RIGHTS_COOKIE_NAME } from "@/lib/embryos/rights-session";
import { notFound } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";

/** Claimant credentials and one-time keys use the registered closed headers. */
export function claimantNotFound():Response {
  const response=notFound();response.headers.set("referrer-policy","no-referrer");return response;
}
export async function claimantResponse<T extends Record<string,unknown>>(operation:string,keys:readonly(keyof T)[],value:T,status:number) {
  const response=await closedResponse(operation,keys,value,status);
  response.headers.set("referrer-policy","no-referrer");return response;
}

export const claimantRightsView=z.object({safeClaimedSubjectLabel:z.literal("Your claimed record"),
  lifecycleState:z.literal("claimed_unbound"),retentionMaximumDays:z.null(),
  allowedActionIds:z.array(z.enum(["export","delete","correct","analysis-stop","bind-account","create-recovery-key"]))}).strict();
export function claimantSessionHash(request:Request):string|null {
  const cookies=(request.headers.get("cookie")??"").split(";").filter(x=>x.trim().split("=")[0]===RIGHTS_COOKIE_NAME);
  return cookies.length===1?readRightsSessionHash(request):null;
}
export function claimantCsrf(sessionHash:string):string{return hmacSecret(sessionHash,"future-person-rights-csrf-v1");}
export async function loadClaimantRights(request:Request) {
  const hash=claimantSessionHash(request);if(!hash)return null;
  const {data,error}=await createAdminClient().rpc("future_person_rights_view_v1",{p_session_hash:hash});
  const parsed=claimantRightsView.safeParse(data);if(error||!parsed.success)return null;
  return {view:parsed.data,csrf:claimantCsrf(hash),recoveryNonce:mintPublicFormToken("future-person-recovery-key",Date.now(),hash),
    analysisNonce:mintPublicFormToken("future-person-analysis-stop",Date.now(),hash)};
}
export function claimantMutation(request:Request,token:string,operation:"future-person-recovery-key"|"future-person-analysis-stop") {
  const url=new URL(request.url);const hash=claimantSessionHash(request);const csrf=request.headers.get("x-inherit-csrf");
  if(!hash||url.search!==""||request.headers.get("origin")!==url.origin||request.headers.get("sec-fetch-site")!=="same-origin"
    ||!csrf||!/^[0-9a-f]{64}$/u.test(csrf)||!crypto.timingSafeEqual(Buffer.from(csrf),Buffer.from(claimantCsrf(hash))))return null;
  if(token.length>2048)return null;
  const claims=readPublicFormToken(token,operation,Date.now(),hash);
  return claims?{sessionHash:hash,nonce:claims.nonce}:null;
}
export const recoveryRequest=z.object({nonce:z.string().min(1).max(2048),acknowledgedWillSaveOffline:z.literal(true)}).strict();
