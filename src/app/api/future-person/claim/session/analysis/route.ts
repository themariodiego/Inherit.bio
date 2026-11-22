import {claimantMutation,claimantNotFound as notFound,claimantResponse as closedResponse} from "@/lib/future-person/rights";
import {createAdminClient} from "@/lib/supabase/admin";
import {readRightsCsrfSession,withPurposeCsrf} from "@/lib/security/session-csrf";
/** The rights session's one-time X-Inherit-CSRF token is verified and spent
 * before this runs (G8.5); the nonce in X-Inherit-Operation-Nonce is checked
 * as before. */
export const DELETE=withPurposeCsrf("api.future-person-analysis-stop",readRightsCsrfSession,handleDelete);
async function handleDelete(request:Request) {
  if(request.body!==null||request.headers.has("transfer-encoding")||Number(request.headers.get("content-length")??0)!==0)return notFound();
  const authority=claimantMutation(request,request.headers.get("x-inherit-operation-nonce")??"","future-person-analysis-stop");
  if(!authority)return notFound();
  const {data,error}=await createAdminClient().rpc("stop_future_person_analysis_v1",{p_session_hash:authority.sessionHash,p_nonce:authority.nonce});
  if(error||typeof data!=="string"||!Number.isFinite(new Date(data).getTime()))return notFound();
  return closedResponse("api.future-person-analysis-stop",["status","effectiveAt"],{status:"analysis_stopped",effectiveAt:new Date(data).toISOString()},200);
}
