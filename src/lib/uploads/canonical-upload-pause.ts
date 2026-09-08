import "server-only";

/** Stops new canonical leases only; issued uploads keep their existing checks. */
export function canonicalUploadsPaused(): boolean {
  return process.env.INHERIT_CANONICAL_UPLOADS_PAUSED === "true";
}
