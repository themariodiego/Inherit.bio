import "server-only";

import { isSameOrigin } from "@/lib/account-deletion";
import { encryptSecret } from "@/lib/crypto";
import { isTestJurisdictionEnabled, resolveCapability } from "@/lib/legal/jurisdictions";
import { ClosedShapeError, SENSITIVE_HEADERS, blockedResponse, closedObject, sensitiveJson } from "./api";
import { CSRF_HEADER, verifyEmbryoOperation, type EmbryoOperationClaims } from "./operation-token";

/**
 * The checks every embryo route runs before it reads a body (contract
 * §6.0), in one place so the order and the answers cannot drift between
 * routes: the plain 401 of the existing convention, the 403 of
 * authenticated-mutation-v1, the 403 of capability-denied-api-v1 with the
 * register's own sentence, and the one operation token per request.
 */

/** The existing convention: plain text, with the sensitive headers so no error frames. */
export function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401, headers: SENSITIVE_HEADERS });
}

/** authenticated-mutation-v1 failure. */
export function requestForbidden(): Response {
  return sensitiveJson({ error: "request_forbidden" }, 403);
}

/** Null when the request comes from this origin; the 403 otherwise. */
export function originDenied(request: Request): Response | null {
  return isSameOrigin(request) ? null : requestForbidden();
}

/**
 * The jurisdiction gate of every embryo route the register guards with
 * `embryo_analysis`: only the TEST-LOCAL fixture is enabled in E0, so the
 * flag decides, and the refusal carries the file's own copy for the default
 * real jurisdiction rather than a sentence of this route's making.
 */
export function jurisdictionDenied(env: Readonly<Record<string, string | undefined>> = process.env): Response | null {
  if (isTestJurisdictionEnabled(env)) return null;
  const decision = resolveCapability(null, "embryo_analysis", { testJurisdiction: false });
  return sensitiveJson({ error: "jurisdiction_unavailable", message: decision.userFacingCopy }, 403);
}

/** The claims of the `x-inherit-csrf` token when it was minted for exactly this operation; null otherwise. */
export function csrfOperation(
  request: Request,
  expected: Omit<EmbryoOperationClaims, "nonce" | "expiresAt">,
): EmbryoOperationClaims | null {
  return verifyEmbryoOperation(request.headers.get(CSRF_HEADER), expected);
}

/** The parsed JSON body, or null when there is none or it does not parse. */
export function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

/** A plaintext as the `bytea` literal PostgREST accepts: AES-GCM ciphertext, hex, `\x` prefixed. */
export function encryptedLiteral(plaintext: string): string {
  return `\\x${encryptSecret(plaintext).toString("hex")}`;
}

/**
 * The same ciphertext as bare hex, for the `text[]` contact arrays: an array
 * element travels as plain text and the RPC decodes it itself.
 */
export function encryptedHex(plaintext: string): string {
  return encryptSecret(plaintext).toString("hex");
}

/**
 * A success body through the closed-shape serializer: the response when the
 * value's keys are exactly the registered ones, the blocked 500 otherwise.
 */
export async function closedResponse<T extends Record<string, unknown>>(
  operation: string,
  keys: readonly (keyof T)[],
  value: T,
  status: number,
  extraHeaders?: HeadersInit,
): Promise<Response> {
  try {
    return sensitiveJson(closedObject(keys, value), status, extraHeaders);
  } catch (error) {
    if (error instanceof ClosedShapeError) return blockedResponse(operation);
    throw error;
  }
}
