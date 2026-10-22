import "server-only";

import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, sensitiveJson } from "@/lib/embryos/api";
import { originDenied } from "@/lib/embryos/guards";
import { correctionIntakeBody } from "@/lib/future-person/correction-case-envelope";
import { isCanonicalSubjectId } from "./request";

/**
 * The two bound-claimant endpoints on a claimed subject:
 *
 *   - `DELETE /api/subjects/[id]/analysis` (register
 *     api.claimed-subject-analysis-stop, future-person-analysis-stop-v1);
 *   - `POST /api/subjects/[id]/corrections` (register
 *     api.claimed-subject-correction, future-person-correction-v1).
 *
 * Both act only for the account a `claimed_bound` subject is bound to
 * (actorRole route-subject-lifecycle-claimed_bound-and-subject_account_id-
 * equals-the-acting-account). Claimant binding is closed, so no
 * `claimed_bound` subject can exist. The owner decided on 2026-10-22
 * ("Consent, rights and claim endpoints (G2.1)") that both answer
 * resource-not-found-v1 until the binding release, the same rule as
 * api.subject-delete's bound case. The bound authority is not built here.
 *
 * What is built is the request contract:
 *
 *   - the route segment is one canonical lowercase UUID;
 *   - the caller is a live authenticated session (authenticated-api-v1:
 *     401 `{"error":"unauthenticated"}`);
 *   - the request is same-origin (authenticated-mutation-v1: 403);
 *   - then the route subject must be a `claimed_bound` subject bound to the
 *     caller. That target is never readable today, so the answer is the one
 *     opaque 404, decided before any body is read
 *     (responseContracts.invalid-request-v1.authorizationPrecedence: the 404
 *     comes before field validation when the target is not readable).
 *
 * The closed body and header contracts are below, for the binding release
 * to apply after its authority check. Nothing here reads the database.
 */

/** api.claimed-subject-analysis-stop.requestContract.requiredHeader. */
export const CLAIMED_SUBJECT_NONCE_HEADER = "x-inherit-operation-nonce";
export const claimedSubjectAnalysisNonce = z.string().min(1).max(2048);

/**
 * api.claimed-subject-correction.requestContract.closedBody: field,
 * statement (20 through 4000 characters) and nonce, and nothing else. It is
 * the same closed body as the claimant's own correction intake, so the
 * forbidden fields (claimId, newVariant, genotype, reviewer, approved,
 * parentId) and every other unknown field refuse.
 */
export const claimedSubjectCorrectionBody = correctionIntakeBody;

const unauthenticated = () => sensitiveJson({ error: "unauthenticated" }, 401);

/**
 * The shared answer of both routes. It never reads the request body: the
 * target decides first, and it is never readable while binding is closed.
 */
export async function answerClaimedSubjectRequest(request: Request, id: string): Promise<Response> {
  if (!isCanonicalSubjectId(id)) return notFound();
  const account = await getSensitiveAccountContext();
  if (!account) return unauthenticated();
  const forbidden = originDenied(request);
  if (forbidden) return forbidden;
  // The route subject would now have to be a claimed_bound subject bound to
  // account.user.id. Claimant binding is closed, so none is, and the bound
  // authority ships with the binding release. The body is never read.
  return notFound();
}
