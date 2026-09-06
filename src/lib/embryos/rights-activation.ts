import "server-only";

import crypto from "node:crypto";
import { mintPublicFormToken, readPublicFormToken } from "./operation-token";

const PRODUCTION = process.env.NODE_ENV === "production";
export const RIGHTS_CANDIDATE_COOKIE = PRODUCTION
  ? "__Host-inherit-rights-candidate"
  : "inherit-rights-candidate";
const CANDIDATE_SECONDS = 600;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/u;

function hashCandidate(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * A generic GET may issue this non-authorizing browser/form pair without
 * reading any invitation, target, account or fragment. The public form
 * contains only a hash binding; the random cookie is HttpOnly. Neither
 * grants a right or consumes a mailed credential.
 */
export function mintRightsActivationCandidate(now = Date.now()): { formToken: string; setCookie: string } {
  const secret = crypto.randomBytes(32).toString("base64url");
  const attributes = [
    `${RIGHTS_CANDIDATE_COOKIE}=${secret}`,
    "Path=/",
    `Max-Age=${CANDIDATE_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (PRODUCTION) attributes.push("Secure");
  return {
    formToken: mintPublicFormToken("rights-activate", now, hashCandidate(secret)),
    setCookie: attributes.join("; "),
  };
}

/** Strict double-submit binding before the token consumer may touch its RPC. */
export function readRightsActivationCandidate(
  request: Request,
  formToken: string,
  now = Date.now(),
): { nonce: string } | null {
  if (
    request.method !== "POST" ||
    request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  ) return null;

  const candidates = (request.headers.get("cookie") ?? "").split(";")
    .map(part => part.trim())
    .filter(part => part.slice(0, part.indexOf("=")) === RIGHTS_CANDIDATE_COOKIE);
  // Ambiguous cookies fail rather than letting two parsers choose differently.
  if (candidates.length !== 1) return null;
  const secret = candidates[0].slice(candidates[0].indexOf("=") + 1);
  if (!SECRET_SHAPE.test(secret)) return null;
  return readPublicFormToken(formToken, "rights-activate", now, hashCandidate(secret));
}
