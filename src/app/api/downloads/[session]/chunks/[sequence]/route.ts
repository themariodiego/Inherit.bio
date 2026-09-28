import crypto from "node:crypto";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { SENSITIVE_HEADERS, notFound, unavailable } from "@/lib/embryos/api";
import { supabaseClaimObjectStore } from "@/lib/future-person/claim-objects";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { claimDataKey, openDocumentBytes } from "@/lib/future-person/document-envelope";
import { CHUNK_BYTES, downloadCookieHash, isCanonicalId } from "@/lib/future-person/review";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `GET /api/downloads/[session]/chunks/[sequence]` (register
 * api.download-chunk), for claim review downloads, the only download
 * sessions this deployment issues.
 *
 * The cookie and session id only identify; every chunk re-authorizes under
 * the reviewer's own JWT: the same reviewer and auth session that opened
 * it, a live MFA step-up, the current assignment, the open case and the
 * still-clean bound document. Only then does the service read the sealed
 * object, open it under the claim key, check its exact size and SHA-256, and
 * send one fixed 4,000,000-byte chunk (the last may be shorter). The object
 * is sealed whole, so the whole document is opened for each chunk; nothing
 * is kept after the response.
 */

const SEQUENCE = /^(0|[1-4])$/u;

export async function GET(request: Request, context: { params: Promise<{ session: string; sequence: string }> }) {
  const { session, sequence } = await context.params;
  const response = await chunk(request, session, sequence);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function chunk(request: Request, session: string, sequence: string): Promise<Response> {
  if (!futurePersonClaimsOpen() || !isCanonicalId(session) || !SEQUENCE.test(sequence)
    || new URL(request.url).search !== "" || request.headers.get("range") !== null
    || request.headers.get("sec-fetch-site") !== "same-origin") {
    return notFound();
  }
  const cookieHash = downloadCookieHash(request);
  const account = cookieHash ? await getSensitiveAccountContext() : null;
  if (!cookieHash || !account) return notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("authorize_claim_review_chunk_v1", {
    p_session_id: session, p_cookie_hash: cookieHash, p_sequence: Number(sequence),
  });
  if (error) return error.code === "42501" ? notFound() : unavailable();
  const grant = data as { objectKey?: unknown; sha256?: unknown; byteCount?: unknown; wrappedDataKey?: unknown } | null;
  if (!grant || typeof grant.objectKey !== "string" || typeof grant.sha256 !== "string"
    || typeof grant.byteCount !== "number" || typeof grant.wrappedDataKey !== "string") {
    return unavailable();
  }

  let sealed: Uint8Array;
  try {
    sealed = await supabaseClaimObjectStore(createAdminClient()).read(grant.objectKey);
  } catch {
    return unavailable();
  }
  const key = claimDataKey(grant.wrappedDataKey);
  const bytes = openDocumentBytes(key, grant.objectKey, sealed);
  key.fill(0);
  try {
    if (!bytes || bytes.length !== grant.byteCount
      || crypto.createHash("sha256").update(bytes).digest("hex") !== grant.sha256) {
      return unavailable();
    }
    const start = Number(sequence) * CHUNK_BYTES;
    const part = Buffer.from(bytes.subarray(start, Math.min(start + CHUNK_BYTES, bytes.length)));
    if (part.length === 0) return notFound();
    return new Response(new Uint8Array(part), {
      status: 200,
      headers: {
        ...SENSITIVE_HEADERS,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(part.length),
        "Content-Encoding": "identity",
      },
    });
  } finally {
    bytes?.fill(0);
  }
}
