import { pollThirdPartyExport, postThirdPartyExport } from "@/lib/exports/third-party-export-http";
import { readRightsCsrfSession, withPurposeCsrf } from "@/lib/security/session-csrf";

/**
 * `/api/withdraw/[token]/export` with the segment pinned to `session`
 * (register api.third-party-subject-export). The rights session's own export
 * under largeExportDeliveryContract: POST `create` or `open-ready`, GET poll.
 * Both resolver cases answer resource-not-found-v1 until their producers
 * exist (owner decision 2026-10-22). See
 * src/lib/exports/third-party-export-http.ts. The rights session's one-time
 * X-Inherit-CSRF token is verified and spent before either POST runs (G8.5);
 * GET only polls and needs none.
 */
export const POST = withPurposeCsrf("api.third-party-subject-export", readRightsCsrfSession,
  async (request: Request) => postThirdPartyExport(request));
export async function GET(request: Request) { return pollThirdPartyExport(request); }
