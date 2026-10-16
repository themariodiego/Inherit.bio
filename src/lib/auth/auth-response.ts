import "server-only";

import { applyAppealIntakeHeaders } from "@/lib/future-person/appeal-intake-response";
import type { AuthIssue } from "./auth-request";

/**
 * Every answer of the three auth endpoints carries the registered
 * `sensitiveResponseHeaders.authOrRecovery` profile plus the sensitive-data
 * cache headers (`sensitiveResponseHeaderBindings.authOrRecovery`). The
 * public appeal intake already applies exactly that union, so its helper is
 * the one used here; the proxy applies it as well, because a header the proxy
 * sets wins over the handler's.
 */
export function authJson(body: unknown, status: number, setCookies: readonly string[] = []): Response {
  const response = applyAppealIntakeHeaders(Response.json(body, { status }));
  for (const value of setCookies) response.headers.append("Set-Cookie", value);
  return response;
}

/** invalid-request-v1, naming fields and never values. */
export function authInvalidRequest(issues: readonly AuthIssue[] | readonly ["csrf"]): Response {
  return authJson({ error: "invalid_request", issues: [...issues] }, 422);
}

/** resource-not-found-v1, and reset-session-api-v1's refusal. */
export function authNotFound(): Response {
  return authJson({ error: "not_found" }, 404);
}

/** password-reset-v1: 204 with no body. */
export function authNoContent(setCookies: readonly string[]): Response {
  const response = applyAppealIntakeHeaders(new Response(null, { status: 204 }));
  for (const value of setCookies) response.headers.append("Set-Cookie", value);
  return response;
}

/**
 * The opaque answers (signup-v1, auth-opaque-request-v1) are sent no sooner
 * than this after the request began, so a quick refusal inside the auth
 * service and a slower mail send take the same time from outside. It is a
 * floor that hides the ordinary difference, not a proof of the whole timing
 * envelope; the same distinction the public appeal intake draws.
 */
export const OPAQUE_RESPONSE_FLOOR_MS = 1_000;

export async function afterFloor(startedAt: number, floorMs = OPAQUE_RESPONSE_FLOOR_MS): Promise<void> {
  const remaining = floorMs - (performance.now() - startedAt);
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
}
