import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { appealReviewRow, publicAppealReviewBody } from "@/lib/future-person/public-appeal-review";
import { isCanonicalId, mintReviewNonce, reviewCsrf } from "@/lib/future-person/review";
import { mintReceiptOpenNonce } from "@/lib/future-person/review-receipt";
import { createClient } from "@/lib/supabase/server";
/** Own JWT + current named MFA assignment before opening any working field;
 * recheck the exact current native row before returning the closed DTO. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
 const { id } = await context.params;
 if (!testAppealIntakeOpen() || !isCanonicalId(id) || new URL(request.url).search || request.headers.get("sec-fetch-site") !== "same-origin") return notFound();
 const account = await getSensitiveAccountContext(); if (!account) return notFound();
 const own = await createClient(); const { data, error } = await own.rpc("read_public_appeal_review_v1", { p_case: id }).retry(false).abortSignal(request.signal);
 if (error) return error.code === "42501" ? notFound() : unavailable();
 const row = appealReviewRow.safeParse(data); const body = publicAppealReviewBody(data);
 if (!row.success || row.data.caseId !== id || !body || Date.parse(row.data.deadline) <= Date.now()) return notFound();
 const fresh = await own.rpc("read_public_appeal_review_v1", { p_case: id }).retry(false).abortSignal(request.signal);
 if (fresh.error || JSON.stringify(fresh.data) !== JSON.stringify(data)) return fresh.error?.code === "42501" ? notFound() : unavailable();
 const tokens = Object.fromEntries(row.data.documents.filter(doc => doc.decision === null).map(doc => [doc.documentId, {
  receipt: mintReceiptOpenNonce(doc.documentId, account.user.id, account.sessionId),
  decision: mintReviewNonce(doc.documentId, account.user.id, account.sessionId),
 }]));
 return sensitiveJson(body, 200, { "Referrer-Policy": "no-referrer", "x-inherit-csrf": reviewCsrf(id, account.user.id, account.sessionId),
  "x-inherit-document-nonces": JSON.stringify(tokens) });
}
