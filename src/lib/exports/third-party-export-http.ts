import "server-only";
import { z } from "zod";
import { hasEmptyRequestBody } from "@/lib/empty-request-body";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { claimantNotFound, claimantSessionHash } from "@/lib/future-person/rights";

/**
 * `POST/GET /api/withdraw/[token]/export` with the segment pinned to
 * `session` (register api.third-party-subject-export,
 * exportContracts.token-target-export-v1, resolver withdrawal-target-v1).
 *
 * The rights-session cookie is the only principal: the withdrawal token is
 * never an export credential. POST takes one of two closed bodies, `create`
 * or `open-ready`, each with the rights-session-bound one-time export nonce
 * below; GET only polls, by the export cookie, with zero writes.
 *
 * The owner decided on 2026-10-22 ("Consent, rights and claim endpoints
 * (G2.1)") that both cases of the resolver answer resource-not-found-v1:
 *
 *   - the subject case (purpose adult-withdrawal or adult-subject-control)
 *     until an adult-withdrawal or adult-subject-control issuer exists. No
 *     rights session of either purpose can be issued today;
 *   - the cohort case (embryo-parent-withdrawal) until the cohort projection
 *     producer is decided and built.
 *
 * So a POST is validated in full (one rights session, exact origin,
 * same-origin fetch metadata, JSON, the closed body and a fresh nonce for
 * this session and operation; the rights session's one-time X-Inherit-CSRF
 * token is verified and spent by the route before this runs, G8.5, where until
 * 19 November 2026 a keyed digest of the session was compared here) and then
 * answered with that 404. A poll (one rights session, no query, no body)
 * answers the same 404, since no export of this route can exist.
 * Nothing here reads or writes the database, sets a cookie or enqueues work.
 * Every refusal is the one opaque 404 the register names for this route.
 * The withdraw page stays refuse/delete only and presents no export action.
 */

export type ThirdPartyExportOperation = "create" | "open-ready";
const FORMS = {
  create: "third-party-subject-export-create",
  "open-ready": "third-party-subject-export-open-ready",
} as const;
export const THIRD_PARTY_EXPORT_NONCE_MAX_LENGTH = 2048;

/** methodRequestContracts.POST.oneOfClosedBodies. */
export const thirdPartyExportBody = z.object({
  operation: z.enum(["create", "open-ready"]),
  nonce: z.string().min(1).max(THIRD_PARTY_EXPORT_NONCE_MAX_LENGTH),
}).strict();

/** The rights-session-bound one-time export nonce, distinct per operation, ten minutes fresh. */
export function mintThirdPartyExportNonce(sessionHash: string, operation: ThirdPartyExportOperation, now = Date.now()): string {
  return mintPublicFormToken(FORMS[operation], now, sessionHash);
}
export function readThirdPartyExportNonce(token: string, sessionHash: string, operation: ThirdPartyExportOperation, now = Date.now()) {
  if (token.length > THIRD_PARTY_EXPORT_NONCE_MAX_LENGTH) return null;
  return readPublicFormToken(token, FORMS[operation], now, sessionHash);
}

function admitted(request: Request): string | null {
  return new URL(request.url).search === "" ? claimantSessionHash(request) : null;
}
export async function postThirdPartyExport(request: Request): Promise<Response> {
  const sessionHash = admitted(request);
  const url = new URL(request.url);
  if (!sessionHash || request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return claimantNotFound();
  const body = thirdPartyExportBody.safeParse(await readBoundedJson(request, 4096));
  if (!body.success || !readThirdPartyExportNonce(body.data.nonce, sessionHash, body.data.operation)) return claimantNotFound();
  // withdrawal-target-v1 would now pick the subject or the cohort case for
  // this session. Neither has a producer, so every valid request is the same
  // opaque 404, and nothing is enqueued or set.
  return claimantNotFound();
}

/** GET: poll only. Zero enqueue, cookie, credential or other write. */
export async function pollThirdPartyExport(request: Request): Promise<Response> {
  const sessionHash = admitted(request);
  if (!sessionHash || !(await hasEmptyRequestBody(request))) return claimantNotFound();
  // missingRightsBoundExportCookie is resource-not-found-v1, and with a
  // cookie there is still no export to report: none of this route can exist
  // while neither case has a producer.
  return claimantNotFound();
}
