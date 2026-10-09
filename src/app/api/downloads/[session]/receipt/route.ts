import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { downloadCookieHash, isCanonicalId, reviewCsrfMatches } from "@/lib/future-person/review";
import { mintReceiptAckNonce, readReceiptOpenNonce, receiptCsrf } from "@/lib/future-person/review-receipt";
import { createClient } from "@/lib/supabase/server";

const body = z.object({ nonce: z.string().min(1).max(2048) }).strict();
const receipt = z.object({ session: z.uuid(), chunks: z.array(z.object({
  sequence: z.number().int().min(0).max(4), challenge: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()).min(1).max(5) }).strict();

/** POST only: create the challenge after the live reviewer and page nonce authorize it. */
export async function POST(request: Request, context: { params: Promise<{ session: string }> }) {
  const { session } = await context.params;
  const url = new URL(request.url);
  if (!futurePersonClaimsOpen() || !isCanonicalId(session) || url.search !== ""
    || request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return notFound();
  const cookie = downloadCookieHash(request);
  const account = cookie ? await getSensitiveAccountContext() : null;
  if (!cookie || !account) return notFound();
  const parsed = body.safeParse(await readBoundedJson(request,4096));
  if (!parsed.success) return notFound();
  const client = await createClient();
  const { data: grant, error: denied } = await client.rpc("authorize_claim_review_chunk_v1",{
    p_session_id: session,p_cookie_hash:cookie,p_sequence:0,
  });
  if (denied) return denied.code === "42501" ? notFound() : unavailable();
  const target = grant as { documentId?: unknown; reviewId?: unknown } | null;
  if (!target || typeof target.documentId !== "string" || typeof target.reviewId !== "string") return unavailable();
  const nonce = readReceiptOpenNonce(parsed.data.nonce,target.documentId,account.user.id,account.sessionId);
  if (!nonce || !reviewCsrfMatches(request.headers.get("x-inherit-csrf"),target.reviewId,account.user.id,account.sessionId)) return notFound();
  const { data,error } = await client.rpc("open_claim_review_receipt_v1",{
    p_session_id:session,p_cookie_hash:cookie,p_nonce_hash:sha256Hex(nonce),
  });
  if (error) return ["42501","23505","22023"].includes(error.code ?? "") ? notFound() : unavailable();
  const result = receipt.safeParse(data);
  if (!result.success || result.data.session !== session
    || result.data.chunks.some((chunk,index)=>chunk.sequence !== index)) return unavailable();
  return sensitiveJson({ session, chunks:result.data.chunks.map((chunk)=>({...chunk,
    nonce:mintReceiptAckNonce(session,chunk.sequence,cookie,account.user.id,account.sessionId),
  })) },201,{ "Referrer-Policy":"no-referrer",
    "x-inherit-csrf":receiptCsrf(session,cookie,account.user.id,account.sessionId),
  });
}
