import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { appealCaseContext, appealCaseDecisionBody, mintAppealCaseReviewNonce, publicAppealCaseReviewBody, readAppealCaseReviewNonce, sealAppealCaseReason } from "@/lib/future-person/public-appeal-case-decision";
import { isCanonicalId, mintReviewNonce, reviewCsrf, reviewCsrfMatches } from "@/lib/future-person/review";
import { mintReceiptOpenNonce } from "@/lib/future-person/review-receipt";
import { createClient } from "@/lib/supabase/server";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { closedResponse } from "@/lib/embryos/guards";
/** Own JWT + current named MFA assignment before opening any working field;
 * recheck the exact current native row before returning the closed DTO. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
 const { id } = await context.params;
 if (!testAppealIntakeOpen() || !isCanonicalId(id) || new URL(request.url).search || request.headers.get("sec-fetch-site") !== "same-origin") return notFound();
 const account = await getSensitiveAccountContext(); if (!account) return notFound();
 const own = await createClient(); const { data, error } = await own.rpc("read_public_appeal_case_context_v1", { p_case: id }).retry(false).abortSignal(request.signal);
 if (error) return error.code === "42501" ? notFound() : unavailable();
 const row = appealCaseContext.safeParse(data); const body = publicAppealCaseReviewBody(data);
 if (!row.success || row.data.caseId !== id || !body || Date.parse(row.data.deadline) <= Date.now()) return notFound();
 const fresh = await own.rpc("read_public_appeal_case_context_v1", { p_case: id }).retry(false).abortSignal(request.signal);
 if (fresh.error || JSON.stringify(fresh.data) !== JSON.stringify(data)) return fresh.error?.code === "42501" ? notFound() : unavailable();
 const tokens = Object.fromEntries(row.data.documents.filter(doc => row.data.documentDecisionsAvailable && doc.decision === null).map(doc => [doc.documentId, {
  receipt: mintReceiptOpenNonce(doc.documentId, account.user.id, account.sessionId),
  decision: mintReviewNonce(doc.documentId, account.user.id, account.sessionId),
 }]));
 return sensitiveJson(body, 200, { "Referrer-Policy": "no-referrer", "x-inherit-csrf": reviewCsrf(id, account.user.id, account.sessionId),
  "x-inherit-document-nonces": JSON.stringify(tokens), "x-inherit-case-review-nonce": mintAppealCaseReviewNonce({ caseId: id,
    accountId: account.user.id, sessionId: account.sessionId, reviewRevision: row.data.reviewRevision, evidenceRevision: row.data.evidenceRevision }),
  "x-inherit-case-decisions": JSON.stringify(row.data.allowedDecisions) });
}

/** The registered final-rejection branch has no target effects. Other final
 * branches remain opaque until their native authority producers exist. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
 const { id } = await context.params; const url = new URL(request.url);
 if (!testAppealIntakeOpen() || !isCanonicalId(id) || url.search || request.headers.get("origin") !== url.origin
  || request.headers.get("sec-fetch-site") !== "same-origin"
  || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return notFound();
 const account = await getSensitiveAccountContext(); if (!account) return notFound();
 const parsed = appealCaseDecisionBody.safeParse(await readBoundedJson(request, 16 * 1024)); if (!parsed.success) return notFound();
 const own = await createClient(); const current = await own.rpc("read_public_appeal_case_context_v1", { p_case: id }).retry(false).abortSignal(request.signal);
 if (current.error) return current.error.code === "42501" ? notFound() : unavailable();
 const row = appealCaseContext.safeParse(current.data);
 if (!row.success || row.data.caseId !== id || Date.parse(row.data.deadline) <= Date.now()
  || parsed.data.reviewRevision !== row.data.reviewRevision || !reviewCsrfMatches(request.headers.get("x-inherit-csrf"), id, account.user.id, account.sessionId)) return notFound();
 const nonce = readAppealCaseReviewNonce(parsed.data.nonce, { caseId: id, accountId: account.user.id, sessionId: account.sessionId,
  reviewRevision: row.data.reviewRevision, evidenceRevision: row.data.evidenceRevision });
 if (!nonce) return notFound();
 const nonceHash = sha256Hex(nonce);
 let reasonCiphertext: string;
 try { reasonCiphertext = sealAppealCaseReason(parsed.data.reason, row.data.wrappedCaseKeyHex, id, nonceHash); }
 catch { return unavailable(); }
 const result = await own.rpc("decide_public_appeal_case_v1", { p_case: id, p_decision: parsed.data.decision,
  p_review_revision: row.data.reviewRevision, p_evidence_revision: row.data.evidenceRevision, p_nonce_hash: nonceHash,
  p_reason_ciphertext: reasonCiphertext,
 }).retry(false).abortSignal(request.signal);
 if (result.error) return ["42501", "23505", "22023"].includes(result.error.code ?? "") ? notFound() : unavailable();
 const value = result.data as Record<string, unknown> | null;
 if (!value || value.caseId !== id || value.state !== "resolved" || value.outcome !== "rejected"
  || value.reviewRevision !== row.data.reviewRevision + 1 || Object.keys(value).sort().join("|") !== "caseId|outcome|reviewRevision|state") return unavailable();
 const response = await closedResponse("api.appeal-review", ["caseId", "state", "outcome", "reviewRevision"], value, 200);
 response.headers.set("Referrer-Policy", "no-referrer"); return response;
}
