import "server-only";

import { mintPublicFormToken, readPublicFormToken, CSRF_HEADER } from "./operation-token";
import { readRightsSessionHash, RIGHTS_COOKIE_NAME } from "./rights-session";

/**
 * The no-account Record Key Card delivery form (register
 * api.embryo-record-key-cards-rights; tokenSecurityContract
 * .futurePersonRecordKeyNoAccountDelivery). The rights page of an
 * embryo-record-key-card-delivery session serves one sealed form token bound
 * to sha256 of that session's cookie; the POST must present it both as the
 * body nonce and in `X-Inherit-CSRF`, from this origin, with exactly one
 * rights cookie. Nothing here reads a cohort, an embryo or a recipient: the
 * database resolves all of them from the session.
 */

const FORM = "embryo-record-key-cards-rights" as const;

/** The form token a rights page serves for its own session. Pure. */
export function mintRecordKeyCardsRightsForm(sessionHash: string, now = Date.now()): string {
  if (!/^[0-9a-f]{64}$/.test(sessionHash)) throw new Error("rights_session_hash_invalid");
  return mintPublicFormToken(FORM, now, sessionHash);
}

/** The session hash and one-time nonce of a delivery form served for this session, or null. */
export function readRecordKeyCardsRightsRequest(request: Request, nonce: string, now = Date.now()) {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.search !== ""
    || request.headers.get("origin") !== url.origin
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
    || request.headers.get(CSRF_HEADER) !== nonce) return null;
  const cookies = (request.headers.get("cookie") ?? "").split(";")
    .filter(part => part.trim().split("=")[0] === RIGHTS_COOKIE_NAME);
  if (cookies.length !== 1) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const claims = readPublicFormToken(nonce, FORM, now, sessionHash);
  return claims ? { sessionHash, nonce: claims.nonce } : null;
}
