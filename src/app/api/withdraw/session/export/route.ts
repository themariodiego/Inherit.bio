import { pollThirdPartyExport, postThirdPartyExport } from "@/lib/exports/third-party-export-http";

/**
 * `/api/withdraw/[token]/export` with the segment pinned to `session`
 * (register api.third-party-subject-export). The rights session's own export
 * under largeExportDeliveryContract: POST `create` or `open-ready`, GET poll.
 * Both resolver cases answer resource-not-found-v1 until their producers
 * exist (owner decision 2026-10-22). See
 * src/lib/exports/third-party-export-http.ts.
 */
export async function POST(request: Request) { return postThirdPartyExport(request); }
export async function GET(request: Request) { return pollThirdPartyExport(request); }
