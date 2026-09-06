import "server-only";

/** Deployment-owned pause for new legacy leases only. Never a client setting. */
export function legacyUploadsPaused(): boolean {
  return process.env.INHERIT_PAUSE_LEGACY_UPLOADS === "true";
}
