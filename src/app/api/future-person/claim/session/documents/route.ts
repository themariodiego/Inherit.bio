import { z } from "zod";
import { closedResponse } from "@/lib/embryos/guards";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import {
  EVIDENCE_COMPLETE_NONCE_HEADER,
  EVIDENCE_CSRF_HEADER,
  claimSessionHash,
  evidenceCompleteNonce,
  evidenceCookie,
  evidenceCsrf,
  newEvidenceSecret,
  readClaimDocumentNonce,
} from "@/lib/future-person/evidence-session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/future-person/claim/session/documents`
 * (register api.future-person-claim-document-session). The claim-session
 * cookie opens one evidence session for one document. No account, no
 * jurisdiction; the answer projects nothing about any record.
 *
 * The body is closed: the kind, the declared media type, size and SHA-256,
 * and the one-time nonce the claim page rendered for this claim session. A
 * bucket, object path, file name, claim id or review state is never read
 * from it. Anything unknown, missing, invalid or ambiguous is the opaque 404
 * (requestContract.unknownMissingInvalidOrAmbiguous). A claim already at its
 * session or document limit is the shared 429.
 *
 * The 201 body is evidence-session-v1. The evidence cookie, and the two
 * session-bound values every chunk and the completion must send back, travel
 * only in headers.
 */

const MAXIMUM_DOCUMENT_BYTES = 20_000_000;
const CHUNK_BYTES = 4_000_000;
const MAXIMUM_CHUNKS = 5;
const SESSION_KEYS = [
  "session", "documentKind", "chunkBytes", "maximumChunks", "maximumDocumentBytes",
  "chunkRoute", "completeRoute", "expiresAt",
] as const;

const body = z.object({
  documentKind: z.enum(["future-photo-identity", "future-birth-record"]),
  mediaType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  sizeBytes: z.number().int().min(1).max(MAXIMUM_DOCUMENT_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  nonce: z.string().min(1).max(2048),
}).strict();

const opened = z.object({
  status: z.literal("open"),
  session: z.uuid(),
  documentKind: z.enum(["future-photo-identity", "future-birth-record"]),
  expiresAt: z.string(),
}).strict();

function withoutReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function POST(request: Request) {
  return withoutReferrer(await open(request));
}

async function open(request: Request): Promise<Response> {
  if (!futurePersonClaimsOpen()) return notFound();
  const url = new URL(request.url);
  if (
    url.search !== "" ||
    request.headers.get("origin") !== url.origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase() !== "application/json"
  ) {
    return notFound();
  }
  const claimHash = claimSessionHash(request);
  if (!claimHash) return notFound();
  const parsed = body.safeParse(await readBoundedJson(request, 4096));
  if (!parsed.success) return notFound();
  const nonce = readClaimDocumentNonce(parsed.data.nonce, claimHash);
  if (!nonce) return notFound();

  const evidence = newEvidenceSecret();
  const { data, error } = await createAdminClient().rpc("open_claim_document_session_v1", {
    p_claim_session_hash: claimHash,
    p_create_nonce_hash: sha256Hex(nonce),
    p_document_kind: parsed.data.documentKind,
    p_media_type: parsed.data.mediaType,
    p_size_bytes: parsed.data.sizeBytes,
    p_sha256: parsed.data.sha256,
    p_cookie_hash: evidence.hash,
  });
  if (error) return ["42501", "23505", "22023"].includes(error.code ?? "") ? notFound() : unavailable();
  if ((data as { status?: unknown } | null)?.status === "capacity_limited") {
    return sensitiveJson({ error: "try_again_later" }, 429, { "Retry-After": "900" });
  }
  const session = opened.safeParse(data);
  if (!session.success) return unavailable();
  const expiresAt = new Date(session.data.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return unavailable();

  const id = session.data.session;
  const response = await closedResponse("api.future-person-claim-document-session", SESSION_KEYS, {
    session: id,
    documentKind: session.data.documentKind,
    chunkBytes: CHUNK_BYTES,
    maximumChunks: MAXIMUM_CHUNKS,
    maximumDocumentBytes: MAXIMUM_DOCUMENT_BYTES,
    chunkRoute: `/api/evidence/${id}/chunks/{sequence}`,
    completeRoute: `/api/evidence/${id}/complete`,
    expiresAt: expiresAt.toISOString(),
  }, 201);
  if (response.status !== 201) return response;
  response.headers.append("Set-Cookie", evidenceCookie(evidence.secret, expiresAt));
  response.headers.set(EVIDENCE_CSRF_HEADER, evidenceCsrf(id, evidence.hash));
  response.headers.set(EVIDENCE_COMPLETE_NONCE_HEADER, evidenceCompleteNonce(id, evidence.hash));
  return response;
}
