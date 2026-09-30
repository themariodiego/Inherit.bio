import crypto from "node:crypto";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { notFound, unavailable } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { CHUNK_BYTES, downloadCookie, isCanonicalId } from "@/lib/future-person/review";
import { createClient } from "@/lib/supabase/server";

/**
 * `GET /api/legal-evidence/[id]/review-download` (register
 * api.legal-evidence-review-download), for the claim documents this
 * deployment holds. The assigned, stepped-up reviewer of the case that bound
 * the document gets a revocable chunk session (revocable-chunk-session-v1):
 * one hour absolute, five minutes idle, bound to this reviewer and this auth
 * session, with only a 256-bit cookie's SHA-256 stored. The body is
 * download-session-v1 and names no bucket, key or URL.
 */

const SESSION_KEYS = ["session", "filename", "sizeBytes", "sha256", "chunkBytes", "chunkCount", "chunkRoute"] as const;
const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const NAMES: Record<string, string> = { "future-photo-identity": "photo-identity", "future-birth-record": "birth-record" };

function withoutReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withoutReferrer(await open(request, id));
}

async function open(request: Request, id: string): Promise<Response> {
  if (!futurePersonClaimsOpen() || !isCanonicalId(id) || new URL(request.url).search !== ""
    || request.headers.get("sec-fetch-site") !== "same-origin") {
    return notFound();
  }
  const account = await getSensitiveAccountContext();
  if (!account) return notFound();
  const secret = crypto.randomBytes(32).toString("base64url");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_claim_review_download_v1", {
    p_document_id: id, p_cookie_hash: sha256Hex(secret),
  });
  if (error) return error.code === "42501" ? notFound() : unavailable();
  const value = data as Record<string, unknown> | null;
  if (
    !value || typeof value.session !== "string" || typeof value.sizeBytes !== "number" ||
    typeof value.sha256 !== "string" || typeof value.chunkCount !== "number" ||
    !(String(value.mediaType) in EXTENSIONS) || !(String(value.documentKind) in NAMES)
  ) {
    return unavailable();
  }
  const response = await closedResponse("api.legal-evidence-review-download", SESSION_KEYS, {
    session: value.session,
    filename: `${NAMES[String(value.documentKind)]}.${EXTENSIONS[String(value.mediaType)]}`,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    chunkBytes: CHUNK_BYTES,
    chunkCount: value.chunkCount,
    chunkRoute: `/api/downloads/${value.session}/chunks/{sequence}`,
  }, 200);
  if (response.status === 200) response.headers.append("Set-Cookie", downloadCookie(secret));
  return response;
}
