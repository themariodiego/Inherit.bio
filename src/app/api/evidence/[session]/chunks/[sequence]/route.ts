import crypto from "node:crypto";
import { SENSITIVE_HEADERS, notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { readBoundedBytes } from "@/lib/future-person/bounded-body";
import { supabaseClaimObjectStore, supabaseAppealObjectStore } from "@/lib/future-person/claim-objects";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { claimDataKey, sealDocumentBytes } from "@/lib/future-person/document-envelope";
import { readEvidenceRequest } from "@/lib/future-person/evidence-session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `PUT /api/evidence/[session]/chunks/[sequence]` (register api.evidence-chunk),
 * for the claim document sessions this deployment issues.
 *
 * The session id in the path must match the evidence cookie, and the
 * request must carry `X-Inherit-CSRF` for that session, the exact origin and
 * same-origin fetch metadata; otherwise it is the opaque 404. The body is
 * raw `application/octet-stream`, never encoded, at most 4,000,000 bytes.
 *
 * The server hashes the bytes itself and asks the database to reserve the
 * sequence under a key it makes. A sequence is written once. Too many bytes
 * for the declared size, or a body over the chunk limit, ends the session
 * (evidence-chunk-v1.failureSideEffects). The bytes are sealed under the
 * claim's data key and written create-only; a failed write ends the session
 * too, and the retention job deletes whatever it left.
 *
 * The one-time sequence reservation is the chunk authority (owner decision
 * 2026-09-28, requestContract.chunkAuthority); no separate chunk nonce.
 */

const CHUNK_BYTES = 4_000_000;
const SEQUENCE = /^(0|[1-4])$/u;

const reserved = (value: unknown): value is { status: "reserved"; objectKey: string; wrappedDataKey: string; storageKind?: "appeal" } =>
  typeof value === "object" && value !== null && (value as { status?: unknown }).status === "reserved"
  && typeof (value as { objectKey?: unknown }).objectKey === "string"
  && typeof (value as { wrappedDataKey?: unknown }).wrappedDataKey === "string"
  && ((value as { storageKind?: unknown }).storageKind === undefined || (value as { storageKind?: unknown }).storageKind === "appeal");

function withoutReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function invalid(issue: string): Response {
  return sensitiveJson({ error: "invalid_document_chunk", issues: [issue] }, 422);
}

export async function PUT(request: Request, context: { params: Promise<{ session: string; sequence: string }> }) {
  const { session, sequence } = await context.params;
  return withoutReferrer(await putChunk(request, session, sequence));
}

async function putChunk(request: Request, session: string, sequence: string): Promise<Response> {
  if (!futurePersonClaimsOpen() && !testAppealIntakeOpen()) return notFound();
  const cookieHash = readEvidenceRequest(request, session, "application/octet-stream");
  if (!cookieHash || !SEQUENCE.test(sequence)) return notFound();
  const admin = createAdminClient();
  const body = await readBoundedBytes(request, CHUNK_BYTES);
  if (body.kind === "unreadable") return invalid("body");
  const byteCount = body.kind === "too_large" ? CHUNK_BYTES + 1 : body.bytes.length;
  const sha256 = body.kind === "bytes"
    ? crypto.createHash("sha256").update(body.bytes).digest("hex")
    : "0".repeat(64);
  try {
    const { data, error } = await admin.rpc("reserve_claim_document_chunk_v1", {
      p_session_id: session,
      p_cookie_hash: cookieHash,
      p_sequence: Number(sequence),
      p_byte_count: byteCount,
      p_sha256: sha256,
    });
    if (error) {
      if (error.code === "23505") return invalid("sequence");
      return error.code === "42501" ? notFound() : unavailable();
    }
    if (body.kind === "too_large") return sensitiveJson({ error: "chunk_too_large" }, 413);
    if (!reserved(data)) return (data as { status?: unknown } | null)?.status === "invalid" ? invalid("size") : unavailable();

    if (data.storageKind === "appeal" ? !testAppealIntakeOpen() : !futurePersonClaimsOpen()) return notFound();
    const store = data.storageKind === "appeal" ? supabaseAppealObjectStore(admin) : supabaseClaimObjectStore(admin);
    let written = false;
    const key = claimDataKey(data.wrappedDataKey);
    try {
      await store.create(data.objectKey, sealDocumentBytes(key, data.objectKey, body.bytes));
      written = true;
    } catch {
      written = false;
    } finally {
      key.fill(0);
    }
    const settled = await admin.rpc("settle_claim_document_chunk_v1", {
      p_session_id: session, p_cookie_hash: cookieHash, p_sequence: Number(sequence), p_written: written,
    });
    if (settled.error || settled.data !== "written" || !written) return unavailable();
    return new Response(null, { status: 204, headers: SENSITIVE_HEADERS });
  } finally {
    if (body.kind === "bytes") body.bytes.fill(0);
  }
}
