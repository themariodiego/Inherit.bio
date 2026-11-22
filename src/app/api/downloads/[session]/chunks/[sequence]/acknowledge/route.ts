import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { SENSITIVE_HEADERS, notFound, unavailable } from "@/lib/embryos/api";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { downloadCookieHash,isCanonicalId } from "@/lib/future-person/review";
import { readReceiptAckNonce } from "@/lib/future-person/review-receipt";
import { withReviewerOrAccountCsrf, type CsrfSession } from "@/lib/security/session-csrf";
import { createClient } from "@/lib/supabase/server";
import {acknowledgeAccountArchiveChunk,accountArchiveChunkDependencies} from "@/lib/exports/account-archive-chunk-http";

const body=z.object({ proof:z.string().regex(/^[0-9a-f]{64}$/u),nonce:z.string().min(1).max(2048) }).strict();
type Path={ params:Promise<{session:string;sequence:string}> };
/** A complete proof settles once, under current MFA, assignment, session and clean-document authority.
 * X-Inherit-CSRF is a one-time session token of the signed-in reviewer, checked
 * first, or of the signed-in account, checked second (owner decision of 22
 * November 2026, "G8.5: the reviewer chunk-acknowledgement address accepts
 * either kind of session"). It is spent before anything else, the answer
 * carries its successor, and only the admitted principal's branch runs: a
 * reviewer token reaches the reviewer's acknowledgement alone, and an account
 * token the TEST account archive's alone. The acknowledgements of one
 * download go one after another, so each carries the previous answer's
 * successor (not a chunk stream, principle 3). Each branch keeps its own
 * one-time value: the reviewer's acknowledgement nonce in body.nonce, and the
 * archive's per-chunk acknowledgement proof in X-Inherit-Operation-Proof
 * (principle 2), where X-Inherit-CSRF carried it before. */
export const POST=withReviewerOrAccountCsrf("api.claim-review-chunk-acknowledgement",
  async (request:Request,session:CsrfSession|null,context:Path)=>{
    const {session:download,sequence}=await context.params;
    if(session?.kind==="authenticated"){
      // A target that is not a TEST account archive never falls to the reviewer's branch.
      return await acknowledgeAccountArchiveChunk(request,{session:download,sequence},accountArchiveChunkDependencies())??notFound();
    }
    if(session?.kind!=="reviewer")return notFound();
    return acknowledge(request,download,sequence);
  });

async function acknowledge(request:Request,session:string,sequence:string):Promise<Response> {
  const url=new URL(request.url);
  if (!(futurePersonClaimsOpen() || testAppealIntakeOpen()) || !isCanonicalId(session) || !/^(0|[1-4])$/u.test(sequence) || url.search!==""
    || request.headers.get("origin")!==url.origin || request.headers.get("sec-fetch-site")!=="same-origin"
    || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()!=="application/json") return notFound();
  const cookie=downloadCookieHash(request);
  const account=cookie?await getSensitiveAccountContext():null;
  if (!cookie || !account) return notFound();
  const parsed=body.safeParse(await readBoundedJson(request,4096));
  if (!parsed.success) return notFound();
  const nonce=readReceiptAckNonce(parsed.data.nonce,session,Number(sequence),cookie,account.user.id,account.sessionId);
  if (!nonce) return notFound();
  const own=await createClient();
  const {data:grant,error:denied}=await own.rpc("authorize_claim_review_chunk_v1",{p_session_id:session,p_cookie_hash:cookie,p_sequence:Number(sequence)}).retry(false).abortSignal(request.signal);
  if(denied)return denied.code==="42501"?notFound():unavailable();
  const transport=(grant as {transport?:unknown}|null)?.transport;
  if(!grant || (transport!==undefined&&transport!=="appeal") || (transport==="appeal"?!testAppealIntakeOpen():!futurePersonClaimsOpen()))return notFound();
  const { error }=await own.rpc("acknowledge_claim_review_chunk_v1",{
    p_session_id:session,p_cookie_hash:cookie,p_sequence:Number(sequence),p_proof:parsed.data.proof,p_nonce_hash:sha256Hex(nonce),
  });
  if (error) return ["42501","23505","22023"].includes(error.code ?? "")?notFound():unavailable();
  return new Response(null,{status:204,headers:{...SENSITIVE_HEADERS,"Referrer-Policy":"no-referrer"}});
}
