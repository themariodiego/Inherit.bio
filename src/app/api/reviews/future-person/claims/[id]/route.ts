import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import {
  REVIEW_CSRF_HEADER,
  REVIEW_NONCE_HEADER,
  isCanonicalId,
  mintReviewNonce,
  readReviewNonce,
  reviewCaseBody,
  reviewCsrf,
  reviewCsrfMatches,
  reviewDecisionBody,
  sealReason,
} from "@/lib/future-person/review";
import { mintReceiptOpenNonce } from "@/lib/future-person/review-receipt";
import { createClient } from "@/lib/supabase/server";

/**
 * `/api/reviews/future-person/claims/[id]` (register
 * api.future-person-claim-review), for the named human who reviews one
 * Future Person claim.
 *
 * Every call runs under the reviewer's own JWT. The database decides:
 * an active claim reviewer, assigned this case, in a live session stepped
 * up with MFA in the last 15 minutes (reviewer-api-v1). Anything short of
 * that, and anything unknown, stale or inapplicable, is the one opaque 404;
 * there are no redirects.
 *
 * GET returns future-person-claim-review-case-v1 and records the read. It
 * also returns, in headers only, the CSRF value and a ten-minute one-time
 * decision nonce for this reviewer, session and case.
 *
 * POST takes one of the six closed decision bodies. The database allows
 * only the decisions the resolved case kind allows, records the decision
 * against the two documents' SHA-256 digests (after the reviewer has read
 * every chunk of both), and answers future-person-claim-review-v1. An
 * approval is recorded and queued for the release step, which is separate.
 */

const DECISION_KEYS = ["claimId", "state", "reviewRevision"] as const;

function withoutReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function reviewer(request: Request, id: string) {
  if (!futurePersonClaimsOpen() || !isCanonicalId(id) || new URL(request.url).search !== "") return null;
  return getSensitiveAccountContext();
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withoutReferrer(await read(request, id));
}

async function read(request: Request, id: string): Promise<Response> {
  const account = await reviewer(request, id);
  if (!account) return notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("read_claim_review_case_v1", { p_review_id: id });
  if (error) return error.code === "42501" ? notFound() : unavailable();
  const body = reviewCaseBody(data);
  if (!body) return notFound();
  return sensitiveJson(body, 200, {
    [REVIEW_CSRF_HEADER]: reviewCsrf(id, account.user.id, account.sessionId),
    [REVIEW_NONCE_HEADER]: mintReviewNonce(id, account.user.id, account.sessionId),
    "x-inherit-photo-receipt-nonce": mintReceiptOpenNonce(String((body.evidence as Record<string, unknown>).photoIdentityDocumentId), account.user.id, account.sessionId),
    "x-inherit-birth-receipt-nonce": mintReceiptOpenNonce(String((body.evidence as Record<string, unknown>).birthRecordDocumentId), account.user.id, account.sessionId),
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withoutReferrer(await decide(request, id));
}

async function decide(request: Request, id: string): Promise<Response> {
  const account = await reviewer(request, id);
  const url = new URL(request.url);
  if (
    !account ||
    request.headers.get("origin") !== url.origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase() !== "application/json" ||
    !reviewCsrfMatches(request.headers.get(REVIEW_CSRF_HEADER), id, account.user.id, account.sessionId)
  ) {
    return notFound();
  }
  const parsed = reviewDecisionBody.safeParse(await readBoundedJson(request, 16 * 1024));
  if (!parsed.success) return notFound();
  const nonce = readReviewNonce(parsed.data.nonce, id, account.user.id, account.sessionId);
  if (!nonce) return notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_claim_review_v1", {
    p_review_id: id,
    p_review_revision: parsed.data.reviewRevision,
    p_decision: parsed.data.decision,
    p_nonce_hash: sha256Hex(nonce),
    p_reason_ciphertext: sealReason(parsed.data.reason),
  });
  if (error) return ["42501", "23505", "22023"].includes(error.code ?? "") ? notFound() : unavailable();
  const outcome = data as { claimId?: unknown; state?: unknown; reviewRevision?: unknown } | null;
  if (
    !outcome || outcome.claimId !== id || typeof outcome.reviewRevision !== "number" ||
    !["release_queued", "more_information_required", "refused"].includes(String(outcome.state))
  ) {
    return unavailable();
  }
  return closedResponse("api.future-person-claim-review", DECISION_KEYS, {
    claimId: id, state: String(outcome.state), reviewRevision: outcome.reviewRevision,
  }, 200);
}
