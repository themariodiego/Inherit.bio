import { pollClaimantExport, postClaimantExport } from "@/lib/exports/claimant-export-http";

/**
 * `/api/future-person/claim/[token]/export` with the segment pinned to
 * `session` (register api.future-person-export). The approved claimant's
 * free export of their one claimed record, under largeExportDeliveryContract.
 * POST `create` enqueues and POST `open-ready` opens a download session; GET
 * only polls. The rights-session cookie is the only principal, and every
 * refusal is the one opaque 404. See src/lib/exports/claimant-export-http.ts.
 */
export async function POST(request: Request) { return postClaimantExport(request); }
export async function GET(request: Request) { return pollClaimantExport(request); }
