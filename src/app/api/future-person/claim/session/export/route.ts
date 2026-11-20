import { pollClaimantExport, postClaimantExport } from "@/lib/exports/claimant-export-http";
import { readRightsCsrfSession, withPurposeCsrf } from "@/lib/security/session-csrf";

/**
 * `/api/future-person/claim/[token]/export` with the segment pinned to
 * `session` (register api.future-person-export). The approved claimant's
 * free export of their one claimed record, under largeExportDeliveryContract.
 * POST `create` enqueues and POST `open-ready` opens a download session; GET
 * only polls. The rights-session cookie is the only principal, and every
 * refusal is the one opaque 404. See src/lib/exports/claimant-export-http.ts.
 * The rights session's one-time X-Inherit-CSRF token is verified and spent
 * before either POST runs (G8.5); GET only polls and needs none.
 */
export const POST = withPurposeCsrf("api.future-person-export", readRightsCsrfSession,
  async (request: Request) => postClaimantExport(request));
export async function GET(request: Request) { return pollClaimantExport(request); }
