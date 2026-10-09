import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, unavailable } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { appealDocumentDecisionBody, appealReviewRow, sealAppealReviewReason, sealAppealDecisionReference } from "@/lib/future-person/public-appeal-review";
import { isCanonicalId, readReviewNonce, reviewCsrfMatches } from "@/lib/future-person/review";
import { createClient } from "@/lib/supabase/server";
/** Only the appeal-document producer is implemented. No general legacy legal
 * row, future-person assignment or request-supplied target can enter it. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
 const { id } = await context.params; const url = new URL(request.url);
 if (!testAppealIntakeOpen() || !isCanonicalId(id) || url.search || request.headers.get("origin") !== url.origin
  || request.headers.get("sec-fetch-site") !== "same-origin" || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return notFound();
 const account = await getSensitiveAccountContext(); if (!account) return notFound();
 const parsed = appealDocumentDecisionBody.safeParse(await readBoundedJson(request, 16 * 1024)); if (!parsed.success) return notFound();
 const nonce = readReviewNonce(parsed.data.nonce, id, account.user.id, account.sessionId); if (!nonce) return notFound();
 const own = await createClient(); const current = await own.rpc("read_public_appeal_document_context_v1", { p_document: id }).retry(false).abortSignal(request.signal);
 if (current.error) return current.error.code === "42501" ? notFound() : unavailable();
 const row = appealReviewRow.safeParse(current.data); if (!row.success || !reviewCsrfMatches(request.headers.get("x-inherit-csrf"), row.data.caseId, account.user.id, account.sessionId)
  || parsed.data.reviewRevision !== row.data.reviewRevision || !row.data.documents.some(doc => doc.documentId === id && doc.sha256 === parsed.data.documentSha256 && doc.decision === null)) return notFound();
 const nonceHash = sha256Hex(nonce);
 const reference = sealAppealDecisionReference(row.data.wrappedCaseKeyHex, row.data.caseId, id, nonceHash);
 const result = await own.rpc("decide_public_appeal_document_v1", { p_document: id, p_sha256: parsed.data.documentSha256,
  p_review_revision: parsed.data.reviewRevision, p_decision: parsed.data.decision, p_nonce_hash: nonceHash,
  p_reason_ciphertext: sealAppealReviewReason(parsed.data.reason, row.data.wrappedCaseKeyHex, row.data.caseId, id, nonceHash),
  p_reference_hash: reference.hash, p_reference_ciphertext: reference.ciphertext,
 }).retry(false).abortSignal(request.signal);
 if (result.error) return ["42501", "23505", "22023"].includes(result.error.code ?? "") ? notFound() : unavailable();
 const value = result.data as Record<string, unknown> | null;
 if (!value || value.documentId !== id || value.decision !== parsed.data.decision || value.reviewRevision !== parsed.data.reviewRevision + 1
  || Object.keys(value).sort().join("|") !== "decision|documentId|reviewRevision") return unavailable();
 // Never return a private case/recipient/reference through a document decision.
 const response = await closedResponse("api.legal-evidence-review", ["documentId", "status", "decision", "reviewRevision"],
  { documentId: id, status: "reviewed", decision: parsed.data.decision, reviewRevision: value.reviewRevision }, 200);
 response.headers.set("Referrer-Policy", "no-referrer"); return response;
}
