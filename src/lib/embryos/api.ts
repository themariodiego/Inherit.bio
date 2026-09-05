import "server-only";

/**
 * The response conventions every embryo route shares (E0 contract §5.6,
 * §6.0; register `embryo-closed-schema-v1`). Every body goes out through
 * `sensitiveJson`, which stamps the no-store and no-framing headers; every
 * RPC failure maps through `rpcErrorResponse`, so a route never improvises
 * a status; and every response object passes `closedObject`, which refuses
 * a key the register does not list rather than letting it serialize. A
 * refused shape becomes `blockedResponse`: a 500 with a fixed body and one
 * coded log line that carries no key, value, id or fragment of the payload.
 *
 * Statuses follow the register's contracts: an unreadable or foreign target
 * is 404, never 403, so a caller cannot learn that a resource exists.
 */

export const SENSITIVE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/** A JSON response with every sensitive header set; the sensitive set wins over any extra header of the same name. */
export function sensitiveJson(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  for (const [name, value] of Object.entries(SENSITIVE_HEADERS)) headers.set(name, value);
  return Response.json(body, { status, headers });
}

export function notFound(): Response {
  return sensitiveJson({ error: "not_found" }, 404);
}

export function invalidRequest(issues: readonly string[]): Response {
  return sensitiveJson({ error: "invalid_request", issues: [...issues] }, 422);
}

export function consentRequired(missing: readonly string[]): Response {
  return sensitiveJson({ error: "consent_required", missing: [...missing] }, 403);
}

export function unavailable(): Response {
  return sensitiveJson({ error: "unavailable" }, 503);
}

/**
 * The register's error mapping for a PostgREST error from an embryo RPC
 * (contract §4.3): 42501 is an authority or target the caller may not see
 * (404); 22023 is malformed input (422); 23505 is a nonce used twice, which
 * reads as an unknown target (404); 55000 is a state the RPC refused, either
 * a consent matrix with named gaps (403) or any other conflict (409).
 * Anything else, a null included, is the database being unavailable (503).
 */
export function rpcErrorResponse(error: { code?: string; message?: string; details?: string } | null): Response {
  if (!error) return unavailable();
  switch (error.code) {
    case "42501":
    case "23505":
      return notFound();
    case "22023":
      return invalidRequest(["request"]);
    case "55000":
      if (error.message === "consent_required") {
        const missing = (error.details ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        return consentRequired(missing);
      }
      return sensitiveJson({ error: "state_conflict" }, 409);
    default:
      return unavailable();
  }
}

/**
 * A response object whose key set is not the one the register publishes.
 * The message names no key; the two lists are for the unit suite and for a
 * developer reading a stack trace, never for a response or an audit row.
 */
export class ClosedShapeError extends Error {
  constructor(
    public readonly missing: readonly string[],
    public readonly unexpected: readonly string[],
  ) {
    super("response shape differs from the registered closed shape");
    this.name = "ClosedShapeError";
  }
}

/**
 * The value, when its own keys are exactly `keys` in any order and none of
 * them holds `undefined` (which JSON would drop, changing the shape on the
 * wire); otherwise a ClosedShapeError. Routes wrap every response object in
 * this before `sensitiveJson`, so a new column reaching a row type can never
 * reach a body without the register being updated first.
 */
export function closedObject<T extends Record<string, unknown>>(keys: readonly (keyof T)[], value: T): T {
  const expected = new Set(keys.map(String));
  const actual = Object.keys(value);
  const missing = [...expected].filter((key) => !actual.includes(key) || value[key] === undefined);
  const unexpected = actual.filter((key) => !expected.has(key));
  if (missing.length > 0 || unexpected.length > 0) throw new ClosedShapeError(missing, unexpected);
  return value;
}

/** A registered operation id: lowercase words, dots and dashes, nothing that could carry a payload. */
const OPERATION_ID_PATTERN = /^[a-z0-9.-]{1,64}$/;

/**
 * The register's `embryo-closed-schema-v1` failure: 500 with a fixed body.
 * The log line is the observability event and nothing more: the coded
 * template, the coded operation slot and the registered consumer id. No
 * key name, value, target id or payload fragment is ever written. The audit
 * row the register also asks for has no RPC yet (the 2026-09-05 embryo E0
 * slice-1 entry in docs/protocol/decisions.md); this function stays async
 * so adding it changes no caller.
 */
export async function blockedResponse(operation: string): Promise<Response> {
  const consumer = OPERATION_ID_PATTERN.test(operation) ? operation : "unregistered";
  console.error("feature.blocked embryo.closed-schema-serialization", consumer);
  return sensitiveJson({ error: "unsafe_response_blocked" }, 500);
}

/**
 * Whether the request declares no body at all: a Content-Length of zero or
 * none, and no Transfer-Encoding. Routes whose register body is empty
 * refuse anything else before reading a byte.
 */
export function bodyIsEmpty(request: Request): boolean {
  if (request.headers.has("transfer-encoding")) return false;
  const length = request.headers.get("content-length");
  return length === null || length.trim() === "0";
}
