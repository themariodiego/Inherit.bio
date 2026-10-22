import "server-only";

import { adultSubjectRequestAllowed } from "@/lib/embryos/adult-subject-review";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { readRightsSessionHash, RIGHTS_COOKIE_NAME } from "@/lib/embryos/rights-session";

/**
 * The form of an adult-subject-control rights session (register
 * withdrawal-target-v1 purposeMatrix adult-subject-control): the person who
 * confirmed a Path B request with no account grants, revokes or binds through
 * it. The rights page serves one sealed form token bound to sha256 of the
 * session cookie; the POST must come from this origin with exactly one rights
 * cookie and present that token as its body nonce. The database decides the
 * subject, the principal, the uploader and every revision from the session;
 * nothing here reads them.
 */

const FORM = "adult-subject-control" as const;

/** The form token a rights page serves for its own session. Pure. */
export function mintAdultSubjectControlForm(sessionHash: string, now = Date.now()): string {
  if (!/^[0-9a-f]{64}$/.test(sessionHash)) throw new Error("rights_session_hash_invalid");
  return mintPublicFormToken(FORM, now, sessionHash);
}

/** The session hash and one-time nonce of a control form served for this session, or null. */
export function readAdultSubjectControlRequest(request: Request, nonce: string, now = Date.now()) {
  if (!adultSubjectRequestAllowed(request)) return null;
  const cookies = (request.headers.get("cookie") ?? "").split(";")
    .filter(part => part.trim().split("=")[0] === RIGHTS_COOKIE_NAME);
  if (cookies.length !== 1) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const claims = readPublicFormToken(nonce, FORM, now, sessionHash);
  return claims ? { sessionHash, nonce: claims.nonce } : null;
}
