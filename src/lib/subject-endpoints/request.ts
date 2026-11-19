import "server-only";

/**
 * The request checks the `/api/subjects/[id]/*` routes share. The route
 * segment is one canonical lowercase UUID; anything else, including the
 * static `bind` sibling's name, never reaches a subject lookup.
 */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isCanonicalSubjectId(value: string): boolean {
  return CANONICAL_UUID.test(value);
}

/** A structured body must declare `application/json` (register requestContract.contentType). */
export function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json";
}
