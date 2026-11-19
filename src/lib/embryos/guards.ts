import "server-only";

import { isSameOrigin } from "@/lib/account-deletion";
import { encryptSecret } from "@/lib/crypto";
import {
  accountCapability,
  isTestJurisdictionEnabled,
  resolveCapability,
  type JurisdictionCapability,
} from "@/lib/legal/jurisdictions";
import { ClosedShapeError, blockedResponse, closedObject, sensitiveJson } from "./api";
import { CSRF_HEADER, OPERATION_HEADER, verifyEmbryoOperation, type EmbryoOperationClaims } from "./operation-token";

/**
 * The checks every embryo route runs before it reads a body (contract
 * §6.0), in one place so the order and the answers cannot drift between
 * routes: the JSON 401 of authenticated-api-v1, the 403 of
 * authenticated-mutation-v1, the 403 of capability-denied-api-v1 with the
 * register's own sentence, and the one operation token per request.
 */

/**
 * `authenticated-api-v1.unauthenticated`: the register's JSON 401, with the
 * sensitive headers. The upload-session routes answer a request with no live
 * account with it (`authenticated-session-v1.failure.endpoint`). Since
 * 19 November 2026 so do the authenticated routes that answered a plain-text
 * 401 (G8.5, "where the register is stricter, engineering codes to it"); the
 * four left, and why, are in `src/lib/security/unauthenticated-answers.test.ts`.
 */
export function unauthenticated(): Response {
  return sensitiveJson({ error: "unauthenticated" }, 401);
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

/**
 * The same gate for the acting account (G5.1a, G5.1b). The flag rule above
 * still answers first; the account's own declared jurisdiction must then
 * permit the capability too. It is read when the request arrives, so a
 * declaration changed after the page loaded is the one that decides, and an
 * undeclared or block-only account is refused with its decision's copy.
 */
export async function accountJurisdictionDenied(
  accountId: string,
  capability: JurisdictionCapability = "embryo_analysis",
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Response | null> {
  const flag = jurisdictionDenied(env);
  if (flag) return flag;
  const decision = await accountCapability(accountId, capability, { testJurisdiction: isTestJurisdictionEnabled(env) });
  if (decision.status === "permitted") return null;
  return sensitiveJson({ error: "jurisdiction_unavailable", message: decision.userFacingCopy }, 403);
}

/** The claims of the `x-inherit-csrf` token when it was minted for exactly this operation; null otherwise. */
export function csrfOperation(
  request: Request,
  expected: Omit<EmbryoOperationClaims, "nonce" | "expiresAt">,
): EmbryoOperationClaims | null {
  return verifyEmbryoOperation(request.headers.get(CSRF_HEADER), expected);
}

/**
 * The claims of the `x-inherit-operation-nonce` token when it was minted for
 * exactly this operation; null otherwise. The same one-time embryo operation
 * token `csrfOperation` reads, in its own header: on a route whose
 * `X-Inherit-CSRF` is the session token (G8.5, the owner's principles of
 * 19 November 2026), the operation token travels here.
 */
export function headerOperation(
  request: Request,
  expected: Omit<EmbryoOperationClaims, "nonce" | "expiresAt">,
): EmbryoOperationClaims | null {
  return verifyEmbryoOperation(request.headers.get(OPERATION_HEADER), expected);
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
