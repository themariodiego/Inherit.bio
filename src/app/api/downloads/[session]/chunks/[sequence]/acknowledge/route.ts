import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { SENSITIVE_HEADERS, notFound, unavailable } from "@/lib/embryos/api";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { downloadCookieHash,isCanonicalId } from "@/lib/future-person/review";
import { readReceiptAckNonce } from "@/lib/future-person/review-receipt";
import { requireReviewerCsrf } from "@/lib/security/session-csrf";
import { createClient } from "@/lib/supabase/server";
import {acknowledgeAccountArchiveChunk,accountArchiveChunkDependencies} from "@/lib/exports/account-archive-chunk-http";

const body=z.object({ proof:z.string().regex(/^[0-9a-f]{64}$/u),nonce:z.string().min(1).max(2048) }).strict();
/** A complete proof settles once, under current MFA, assignment, session and clean-document authority.
 * The reviewer's branch spends the reviewer's one-time X-Inherit-CSRF token for
 * this route before anything else, and its answer carries the successor (G8.5,
 * the migration stage); it was a receipt digest, the same for every chunk.
 * The acknowledgements of one download go one after another, so each carries
 * the previous answer's successor. A TEST account archive's acknowledgement
 * is answered first, with that branch's own per-chunk value. */
export async function POST(request:Request,context:{ params:Promise<{session:string;sequence:string}> }) {
  const {session,sequence}=await context.params;
  const archive=await acknowledgeAccountArchiveChunk(request,{session,sequence},accountArchiveChunkDependencies());
  if(archive)return archive;
  const admitted=await requireReviewerCsrf(request,"api.claim-review-chunk-acknowledgement");
  if(admitted instanceof Response)return admitted;
  return admitted.rotate(await acknowledge(request,session,sequence));
}

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
