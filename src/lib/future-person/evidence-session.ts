import "server-only";

import crypto from "node:crypto";
import { hmacSecret } from "@/lib/crypto";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { evidenceSessionCsrfValue } from "@/lib/security/opened-session-csrf";
import { mintSessionCsrf } from "@/lib/security/session-csrf-core";
import { CLAIM_SESSION_COOKIE, sha256Hex } from "./claim-session";

/**
 * The browser credentials of a claim document upload
 * (policyResolvers.evidence-ingest-session-v1).
 *
 * - The document nonce: a sealed one-time token bound to the claim-session
 *   cookie, which the claim page renders. `POST /api/future-person/claim/
 *   session/documents` must carry it; the database keeps its nonce's hash so
 *   it opens one session only.
 * - The evidence cookie: 256 random bits, host-only, HttpOnly,
 *   SameSite=Strict, `__Host-` in production. The database keeps only its
 *   SHA-256, on the one session it opens. A browser uploads one document at
 *   a time; a new session replaces the cookie.
 * - The evidence session's first `X-Inherit-CSRF` values, handed over once
 *   by the opening answer in `X-Inherit-Evidence-CSRF`
 *   (`src/lib/security/opened-session-csrf.ts`; G8.5, the migration stage):
 *   the chunk stream's one session-bound value, which every chunk sends and
 *   nothing spends (principle 3; each sequence is reserved once), and the
 *   completion's first one-time token, whose successor each completion
 *   answer carries. Both are session tokens bound to the session id and the
 *   cookie hash (`session-csrf-core.ts`), and the route's wrapper checks them
 *   before the handler runs.
 * - The completion nonce: a keyed digest, returned in its own header and
 *   carried in the completion body. The database spends it on the first
 *   completion; the same nonce may only ask for the outcome again.
 */

const PRODUCTION = process.env.NODE_ENV === "production";
export const EVIDENCE_COOKIE = PRODUCTION ? "__Host-inherit-evidence" : "inherit-evidence";
export const EVIDENCE_COMPLETE_NONCE_HEADER = "x-inherit-complete-nonce";
/**
 * The answer header that hands the browser the evidence session's first
 * values, on every opening route, whose own X-Inherit-CSRF carries the
 * successor of that route's own token: api.legal-evidence-upload-session,
 * api.appeal-document-session and api.future-person-claim-document-session.
 */
export { EVIDENCE_SESSION_CSRF_HEADER } from "@/lib/security/opened-session-csrf";

const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The single value of a cookie; null when absent, repeated or malformed. */
export function readSecretCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf("=")) === name)
    .map((part) => part.slice(part.indexOf("=") + 1));
  return values.length === 1 && SECRET_SHAPE.test(values[0]!) ? values[0]! : null;
}

export function isEvidenceSessionId(value: string): boolean {
  return UUID.test(value);
}

/** The evidence cookie's hash, when the path names a well-formed session and the browser holds exactly one cookie. */
export function readEvidenceCookieHash(request: Request, session: string): string | null {
  if (!isEvidenceSessionId(session)) return null;
  const secret = readSecretCookie(request, EVIDENCE_COOKIE);
  return secret ? sha256Hex(secret) : null;
}

/** The claim-session cookie's hash, when the browser holds exactly one. */
export function claimSessionHash(request: Request): string | null {
  const secret = readSecretCookie(request, CLAIM_SESSION_COOKIE);
  return secret ? sha256Hex(secret) : null;
}

/** A document nonce for the claim page, bound to this claim-session cookie value. */
export function mintClaimDocumentNonce(claimSessionSecret: string, now = Date.now()): string | null {
  if (!SECRET_SHAPE.test(claimSessionSecret)) return null;
  return mintPublicFormToken("future-person-claim-document", now, sha256Hex(claimSessionSecret));
}

/** The nonce inside a document token bound to this claim session, or null. */
export function readClaimDocumentNonce(token: unknown, claimHash: string, now = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  return readPublicFormToken(token, "future-person-claim-document", now, claimHash)?.nonce ?? null;
}

/** A completion nonce for the claim page, bound to this claim-session cookie value. */
export function mintClaimCompleteNonce(claimSessionSecret: string, now = Date.now()): string | null {
  if (!SECRET_SHAPE.test(claimSessionSecret)) return null;
  return mintPublicFormToken("future-person-claim-complete", now, sha256Hex(claimSessionSecret));
}

/** The nonce inside a completion token bound to this claim session, or null. */
export function readClaimCompleteNonce(token: unknown, claimHash: string, now = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  return readPublicFormToken(token, "future-person-claim-complete", now, claimHash)?.nonce ?? null;
}

/** A new evidence cookie secret and its hash. */
export function newEvidenceSecret(): { secret: string; hash: string } {
  const secret = crypto.randomBytes(32).toString("base64url");
  return { secret, hash: sha256Hex(secret) };
}

export function evidenceCookie(secret: string, expiresAt: Date, now = Date.now()): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000));
  const attributes = [`${EVIDENCE_COOKIE}=${secret}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict"];
  if (PRODUCTION) attributes.push("Secure");
  return attributes.join("; ");
}

/**
 * The `X-Inherit-Evidence-CSRF` value an opening answer sets for a new
 * evidence session: the chunk stream's value and the completion's first
 * token, each bound to the session id and the cookie hash.
 */
export function evidenceSessionCsrf(sessionId: string, cookieHash: string): string {
  const session = { kind: "evidence-session", sessionHash: cookieHash, sessionId } as const;
  return evidenceSessionCsrfValue({
    chunk: mintSessionCsrf(session, "api.evidence-chunk"),
    complete: mintSessionCsrf(session, "api.evidence-complete"),
  });
}

export function evidenceCompleteNonce(sessionId: string, cookieHash: string): string {
  return hmacSecret(`${sessionId}|${cookieHash}`, "evidence-complete-v1");
}

function sameDigest(presented: string | null, expected: string): boolean {
  if (!presented || !/^[0-9a-f]{64}$/u.test(presented)) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/**
 * The evidence cookie hash of a request that carries every signal a chunk
 * or completion needs: exact origin, same-origin fetch metadata, no query,
 * a well-formed session id and one evidence cookie. Null on anything else.
 * Its `X-Inherit-CSRF` was checked for this session before the handler ran
 * (`withPurposeCsrf` with `readEvidenceCsrfSession`); a request with no
 * evidence cookie reaches the handler and is refused here.
 */
export function readEvidenceRequest(request: Request, session: string, contentType: string): string | null {
  const url = new URL(request.url);
  if (
    url.search !== "" ||
    request.headers.get("origin") !== url.origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase() !== contentType ||
    request.headers.get("content-encoding") !== null
  ) {
    return null;
  }
  return readEvidenceCookieHash(request, session);
}

export function completeNonceMatches(nonce: unknown, session: string, cookieHash: string): boolean {
  return typeof nonce === "string" && sameDigest(nonce, evidenceCompleteNonce(session, cookieHash));
}
