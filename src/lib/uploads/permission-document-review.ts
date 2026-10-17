import "server-only";

import { z } from "zod";
import { encryptSecret } from "@/lib/crypto";
import { closedResponse } from "@/lib/embryos/guards";
import { notFound, unavailable } from "@/lib/embryos/api";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { readReviewNonce, reviewCsrfMatches } from "@/lib/future-person/review";

/**
 * api.legal-evidence-review for the subject-draft target case: one
 * adult-signed permission document of a reviewed-document Path B draft.
 *
 * Only the database decides who may decide: the named claim reviewer the
 * database owner assigned to this document, in a live session stepped up with
 * MFA in the last 15 minutes, who read every chunk of the exact bytes through
 * their own review session. The route checks the shape, the CSRF and the
 * one-time nonce the review session issued, seals the reason, and asks.
 *
 * `rejected-documentary-conflict` must dispatch contradiction-v1, which no
 * producer implements yet; it is answered as an unknown resource and records
 * nothing. Approval is never automatic and never a consent on anyone's behalf.
 */

export const permissionDocumentDecisionBody = z.object({
  decision: z.enum(["approved", "rejected", "rejected-documentary-conflict"]),
  reason: z.string().max(8000).transform(value => value.normalize("NFC").trim())
    .refine(value => [...value].length >= 20 && [...value].length <= 2000
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)),
  documentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  reviewRevision: z.number().int().positive().safe(),
  nonce: z.string().min(1).max(2048),
}).strict();

const context = z.object({ documentId: z.uuid(), sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  reviewRevision: z.number().int().positive().safe(), documentKind: z.literal("adult-signed-permission") }).strict();
const decided = z.object({ documentId: z.uuid(), decision: z.enum(["approved", "rejected"]),
  reviewRevision: z.number().int().positive().safe() }).strict();

type Rpc = (name: string, args: Record<string, unknown>) => {
  retry(enabled: false): { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: { code?: string } | null }> };
};

/** Null when the document is not a permission document, so the appeal branch keeps its own path. */
export async function permissionReviewContext(rpc: Rpc, id: string, signal: AbortSignal):
  Promise<{ kind: "none" } | { kind: "denied" } | { kind: "unavailable" } | { kind: "permission"; value: z.infer<typeof context> }> {
  const result = await rpc("permission_document_review_context_v1", { p_document: id }).retry(false).abortSignal(signal);
  if (result.error) return result.error.code === "42501" ? { kind: "denied" } : { kind: "unavailable" };
  if (result.data === null) return { kind: "none" };
  const parsed = context.safeParse(result.data);
  return parsed.success && parsed.data.documentId === id ? { kind: "permission", value: parsed.data } : { kind: "unavailable" };
}

/** `payload` is the request's one bounded JSON body, already read by the route. */
export async function decidePermissionDocument(request: Request, id: string, payload: unknown,
  account: { userId: string; sessionId: string }, rpc: Rpc, current: z.infer<typeof context>): Promise<Response> {
  const parsed = permissionDocumentDecisionBody.safeParse(payload);
  if (!parsed.success || parsed.data.decision === "rejected-documentary-conflict") return notFound();
  if (!reviewCsrfMatches(request.headers.get("x-inherit-csrf"), id, account.userId, account.sessionId)) return notFound();
  const nonce = readReviewNonce(parsed.data.nonce, id, account.userId, account.sessionId);
  if (!nonce || parsed.data.reviewRevision !== current.reviewRevision || parsed.data.documentSha256 !== current.sha256) {
    return notFound();
  }
  let reason: string;
  try {
    reason = `\\x${encryptSecret(parsed.data.reason).toString("hex")}`;
  } catch {
    return unavailable();
  }
  const result = await rpc("decide_permission_document_v1", {
    p_document: id, p_sha256: parsed.data.documentSha256, p_review_revision: parsed.data.reviewRevision,
    p_decision: parsed.data.decision, p_nonce_hash: sha256Hex(nonce), p_reason_ciphertext: reason,
  }).retry(false).abortSignal(request.signal);
  if (result.error) return ["42501", "23505", "22023"].includes(result.error.code ?? "") ? notFound() : unavailable();
  const value = decided.safeParse(result.data);
  if (!value.success || value.data.documentId !== id || value.data.decision !== parsed.data.decision
    || value.data.reviewRevision !== parsed.data.reviewRevision + 1) return unavailable();
  const response = await closedResponse("api.legal-evidence-review", ["documentId", "status", "decision", "reviewRevision"],
    { documentId: id, status: "reviewed", decision: value.data.decision, reviewRevision: value.data.reviewRevision }, 200);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
