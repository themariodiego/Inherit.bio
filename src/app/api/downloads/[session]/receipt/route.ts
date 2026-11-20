import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { downloadCookieHash, isCanonicalId } from "@/lib/future-person/review";
import { mintReceiptAckNonce, readReceiptOpenNonce } from "@/lib/future-person/review-receipt";
import { withReviewerCsrf } from "@/lib/security/session-csrf";
import { createClient } from "@/lib/supabase/server";

const body = z.object({ nonce: z.string().min(1).max(2048) }).strict();
const receipt = z.object({ session: z.uuid(), chunks: z.array(z.object({
  sequence: z.number().int().min(0).max(4), challenge: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()).min(1).max(5) }).strict();

/** POST only: create the challenge after the live reviewer and page nonce authorize it.
 * The reviewer's one-time X-Inherit-CSRF token for this route is spent before
 * the handler runs, and the answer's X-Inherit-CSRF is its successor (G8.5, the
 * migration stage). Each acknowledgement carries the page's own token for
 * api.claim-review-chunk-acknowledgement; this answer no longer hands over a
 * receipt digest for them. */
export const POST = withReviewerCsrf("api.claim-review-receipt", async (request: Request, context: { params: Promise<{ session: string }> }) => {
  const { session } = await context.params;
  const url = new URL(request.url);
  if (!(futurePersonClaimsOpen() || testAppealIntakeOpen()) || !isCanonicalId(session) || url.search !== ""
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
  const target = grant as { documentId?: unknown; reviewId?: unknown; transport?: unknown } | null;
  if (!target || typeof target.documentId !== "string" || typeof target.reviewId !== "string") return unavailable();
  if ((target.transport !== undefined && target.transport !== "appeal") || (target.transport === "appeal" ? !testAppealIntakeOpen() : !futurePersonClaimsOpen())) return notFound();
  const nonce = readReceiptOpenNonce(parsed.data.nonce,target.documentId,account.user.id,account.sessionId);
  if (!nonce) return notFound();
  const { data,error } = await client.rpc("open_claim_review_receipt_v1",{
    p_session_id:session,p_cookie_hash:cookie,p_nonce_hash:sha256Hex(nonce),
  });
  if (error) return ["42501","23505","22023"].includes(error.code ?? "") ? notFound() : unavailable();
  const result = receipt.safeParse(data);
  if (!result.success || result.data.session !== session
    || result.data.chunks.some((chunk,index)=>chunk.sequence !== index)) return unavailable();
  return sensitiveJson({ session, chunks:result.data.chunks.map((chunk)=>({...chunk,
    nonce:mintReceiptAckNonce(session,chunk.sequence,cookie,account.user.id,account.sessionId),
  })) },201,{ "Referrer-Policy":"no-referrer" });
});
