import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, unavailable } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { mintCorrectionReviewNonce, readCorrectionReviewNonce, sealCorrectionRejectReason } from "@/lib/future-person/correction-case-envelope";
import {
  CORRECTION_REVIEW_CSRF_HEADER,
  CORRECTION_REVIEW_NONCE_HEADER,
  DECIDABLE,
  bindingIsCaller,
  correctionDecisionContext,
  correctionReviewBody,
  correctionReviewCase,
  correctionReviewCaseBody,
  correctionReviewCsrf,
  correctionReviewCsrfMatches,
  correctionReviewReceipt,
  nonceHash,
} from "@/lib/future-person/correction-review";
import { requesterStatementsOpen } from "@/lib/future-person/requester-statement";
import { isCanonicalId } from "@/lib/future-person/review";
import { createClient } from "@/lib/supabase/server";

/**
 * `/api/reviews/future-person/corrections/[id]` (register
 * api.future-person-correction-review), for the named human who reviews one
 * Future Person correction. TEST-LOCAL only: the server switch
 * (requesterStatementsOpen) and the database's own native switch must both
 * be open, and neither is open in production.
 *
 * Every call runs under the reviewer's own JWT. The database decides: the
 * reviewer the intake named, in a live session stepped up with MFA in the
 * last 15 minutes, before the fixed 30-day deadline. Anything else, unknown,
 * stale or inapplicable is the one opaque 404.
 *
 * GET decrypts only the closed case fields after that read, records the read
 * in the ledger, rechecks the unchanged case after serializing, and returns
 * future-person-correction-review-case-v1. The CSRF value and a ten-minute
 * one-time decision nonce bound to that exact read travel in headers only.
 *
 * POST records reject or needs-more-information without touching the
 * subject, and returns future-person-correction-review-v1. Approval is
 * refused (404) until the owner decides what an approved correction changes;
 * the database refuses it independently.
 */

const RECEIPT_KEYS = ["correctionId", "state", "reviewRevision"] as const;
const CASE_KEYS = ["correctionId", "field", "statement", "correctionRevision", "currentProvenance"] as const;

function private_(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function admitted(request: Request, id: string): boolean {
  return requesterStatementsOpen() && isCanonicalId(id) && new URL(request.url).search === ""
    && request.headers.get("sec-fetch-site") === "same-origin";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return private_(await read(request, id));
}

async function read(request: Request, id: string): Promise<Response> {
  if (!admitted(request, id) || request.body !== null) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return notFound();
  const own = await createClient();
  const fetched = await own.rpc("read_future_person_correction_review_v1", { p_correction: id })
    .retry(false).abortSignal(request.signal);
  if (fetched.error) return fetched.error.code === "42501" ? notFound() : unavailable();
  const row = correctionReviewCase.safeParse(fetched.data);
  if (!row.success || row.data.correctionId !== id || Date.parse(row.data.deadline) <= Date.now()
    || !bindingIsCaller(row.data.binding, account.user.id, account.sessionId)) return notFound();
  const body = correctionReviewCaseBody(row.data);
  if (!body) return notFound();
  let nonce: string;
  try { nonce = mintCorrectionReviewNonce(id, row.data.binding, row.data.deadline); }
  catch { return notFound(); }
  const response = await closedResponse("api.future-person-correction-review", CASE_KEYS, body, 200, {
    [CORRECTION_REVIEW_CSRF_HEADER]: correctionReviewCsrf(id, account.user.id, account.sessionId),
    [CORRECTION_REVIEW_NONCE_HEADER]: nonce,
  });
  // The case must still be exactly the one just read when the body leaves.
  const after = await own.rpc("check_future_person_correction_review_v1", { p_correction: id, p_expected: row.data.binding })
    .retry(false).abortSignal(request.signal);
  if (after.error || after.data !== true) return after.error && after.error.code !== "42501" ? unavailable() : notFound();
  return response;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return private_(await decide(request, id));
}

async function decide(request: Request, id: string): Promise<Response> {
  const url = new URL(request.url);
  if (!admitted(request, id) || request.headers.get("origin") !== url.origin
    || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return notFound();
  const parsed = correctionReviewBody.safeParse(await readBoundedJson(request, 16 * 1024));
  if (!parsed.success || !(DECIDABLE as readonly string[]).includes(parsed.data.decision)
    || !correctionReviewCsrfMatches(request.headers.get(CORRECTION_REVIEW_CSRF_HEADER), id, account.user.id, account.sessionId)) return notFound();
  const own = await createClient();
  const current = await own.rpc("future_person_correction_decision_context_v1", { p_correction: id })
    .retry(false).abortSignal(request.signal);
  if (current.error) return current.error.code === "42501" ? notFound() : unavailable();
  const row = correctionDecisionContext.safeParse(current.data);
  if (!row.success || row.data.correctionId !== id || Date.parse(row.data.deadline) <= Date.now()
    || row.data.correctionRevision !== parsed.data.correctionRevision
    || !bindingIsCaller(row.data.binding, account.user.id, account.sessionId)) return notFound();
  const nonce = readCorrectionReviewNonce(parsed.data.nonce, id, row.data.binding, row.data.deadline);
  if (!nonce) return notFound();
  let reasonHex: string;
  try { reasonHex = sealCorrectionRejectReason(row.data.scope, row.data.wrappedCaseKeyHex, nonce, parsed.data.reason); }
  catch { return unavailable(); }
  const result = await own.rpc("decide_future_person_correction_review_v1", {
    p_correction: id, p_decision: parsed.data.decision, p_correction_revision: row.data.correctionRevision,
    p_expected: row.data.binding, p_nonce_hash: nonceHash(nonce), p_reason_ciphertext: `\\x${reasonHex}`,
  }).retry(false).abortSignal(request.signal);
  if (result.error) return ["42501", "23505", "22023"].includes(result.error.code ?? "") ? notFound() : unavailable();
  const receipt = correctionReviewReceipt.safeParse(result.data);
  const expected = parsed.data.decision === "reject" ? "rejected" : "more_information_required";
  if (!receipt.success || receipt.data.correctionId !== id || receipt.data.state !== expected
    || receipt.data.reviewRevision !== row.data.reviewRevision + 1) return unavailable();
  return closedResponse("api.future-person-correction-review", RECEIPT_KEYS, receipt.data, 200);
}
