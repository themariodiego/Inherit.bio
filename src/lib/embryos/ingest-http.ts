import "server-only";

import { z } from "zod";
import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS, INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { EmbryoTransportError } from "./ingest-lines";
import { isIngestSessionId, readIngestCookieHash } from "./ingest-session";
import { notFound, rpcErrorResponse, unavailable } from "./api";
import { jurisdictionDenied, requestForbidden, unauthorized } from "./guards";

const uuid = z.string().refine(isIngestSessionId);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Internal only. Never serialize this service-role metadata to a response. */
export const ingestAuthorization = z.discriminatedUnion("status", [
  z.object({ status: z.literal("failure_pending"), cohortId: uuid, ingestRevision: revision }).strict(),
  z.object({
    status: z.literal("authorized"), session: uuid, cohortId: uuid, uploadId: uuid, ingestRevision: revision,
    expiresAt: z.iso.datetime({ offset: true }), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    transportRevision: revision, build: z.enum(["GRCh37", "GRCh38"]).nullable(),
    format: z.enum(["vcf", "gvcf", "pgt_table"]).nullable(),
    sampleCount: z.number().int().min(1).max(LIMITS.maximumSampleColumns),
    handles: z.array(z.object({ ordinal: z.number().int().min(0), hash: z.string().regex(/^[0-9a-f]{64}$/) }).strict())
      .min(1).max(LIMITS.maximumSampleColumns),
  }).strict().refine((value) => value.handles.length === value.sampleCount &&
    value.handles.every((handle, index) => handle.ordinal === index) &&
    new Set(value.handles.map((handle) => handle.hash)).size === value.sampleCount),
]);
export type IngestAuthorization = z.infer<typeof ingestAuthorization>;

export interface IngestAuthorizationArgs {
  p_account_id: string;
  p_auth_session_id: string;
  p_ingest_session_id: string;
  p_cookie_hash: string;
  p_origin: string;
  p_test_jurisdiction: true;
}
type AuthorizationRpc = (args: IngestAuthorizationArgs) => Promise<{
  data: unknown; error: { code?: string } | null;
}>;

/**
 * The account/session arguments must come from getSensitiveAccountContext(),
 * never request parameters. The injected RPC is the service-only authorizer.
 * This boundary neither reads bytes nor creates/reserves/extends a session.
 * A failure_pending outcome must be dispatched to unwind, not exposed as a
 * successful credential. Keeping it distinct prevents accidental fallthrough.
 */
export async function authorizeIngestHttpRequest(
  request: Request, session: string,
  account: { accountId: string; authSessionId: string } | null,
  authorize: AuthorizationRpc,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{ kind: "denied"; response: Response } | {
  kind: "authorized"; authority: Extract<IngestAuthorization, { status: "authorized" }>; credentials: IngestAuthorizationArgs;
} | { kind: "failure_pending"; authority: Extract<IngestAuthorization, { status: "failure_pending" }> }> {
  if (!account) return { kind: "denied", response: unauthorized() };
  const origin = ingestRequestOrigin(request);
  if (!origin) return { kind: "denied", response: requestForbidden() };
  const jurisdiction = jurisdictionDenied(env);
  if (jurisdiction) return { kind: "denied", response: jurisdiction };
  if (!isIngestSessionId(session) || new URL(request.url).search !== "") return { kind: "denied", response: notFound() };
  const hash = readIngestCookieHash(request, session, env.NODE_ENV === "production");
  if (!hash) return { kind: "denied", response: notFound() };
  const credentials: IngestAuthorizationArgs = {
    p_account_id: account.accountId, p_auth_session_id: account.authSessionId,
    p_ingest_session_id: session, p_cookie_hash: hash, p_origin: origin, p_test_jurisdiction: true,
  };
  try {
    const result = await authorize(credentials);
    if (result.error) return { kind: "denied", response: rpcErrorResponse(result.error) };
    const parsed = ingestAuthorization.safeParse(result.data);
    if (!parsed.success) return { kind: "denied", response: unavailable() };
    if (parsed.data.status === "failure_pending") return { kind: "failure_pending", authority: parsed.data };
    if (parsed.data.session !== session) return { kind: "denied", response: unavailable() };
    return { kind: "authorized", authority: parsed.data, credentials };
  } catch {
    return { kind: "denied", response: unavailable() };
  }
}

/** Resolve the exact Origin header; Sec-Fetch-Site is not a stored origin. */
export function ingestRequestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin || origin.length > 255 || origin !== new URL(request.url).origin ||
    !/^https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(origin)) return null;
  return origin;
}

/** Path and envelope checks do not read or acquire the request body. */
export function ingestChunkEnvelope(request: Request, session: string, sequence: string): { sequence: number; length: number } {
  if (!isIngestSessionId(session) || !/^(0|[1-9][0-9]*)$/.test(sequence) ||
    !Number.isSafeInteger(Number(sequence)) || Number(sequence) >= LIMITS.maximumChunks ||
    new URL(request.url).search !== "" || request.method !== "PUT") throw new EmbryoTransportError("invalid_chunk");
  if (request.headers.get("content-type") !== "application/octet-stream" ||
    request.headers.has("content-encoding")) throw new EmbryoTransportError("invalid_chunk");
  const length = request.headers.get("content-length");
  if (!length || !/^[1-9][0-9]*$/.test(length) || !Number.isSafeInteger(Number(length))) {
    throw new EmbryoTransportError("invalid_chunk");
  }
  if (Number(length) > INGEST_CHUNK_MAXIMUM_BYTES) throw new EmbryoTransportError("too_large");
  return { sequence: Number(sequence), length: Number(length) };
}

/**
 * Call only after live authority and the two operation tokens have passed.
 * Content-Length is a claim, not a bound: count actual streamed bytes and
 * cancel immediately on overflow. Only one bounded buffer is retained.
 */
export async function readIngestChunk(request: Request, declaredLength: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > INGEST_CHUNK_MAXIMUM_BYTES) {
    throw new EmbryoTransportError("too_large");
  }
  if (!request.body || request.signal.aborted) throw new EmbryoTransportError("invalid_chunk");
  const reader = request.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", abort, { once: true });
  const bytes = new Uint8Array(declaredLength);
  let length = 0;
  let complete = false;
  try {
    for (;;) {
      if (request.signal.aborted) throw new EmbryoTransportError("invalid_chunk");
      const part = await reader.read();
      if (request.signal.aborted) throw new EmbryoTransportError("invalid_chunk");
      if (part.done) break;
      if (length + part.value.byteLength > declaredLength) throw new EmbryoTransportError("too_large");
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
    if (length !== declaredLength || bytes[length - 1] !== 10) throw new EmbryoTransportError("invalid_chunk");
    complete = true;
    return bytes;
  } catch (error) {
    bytes.fill(0);
    if (error instanceof EmbryoTransportError) throw error;
    throw new EmbryoTransportError("invalid_chunk");
  } finally {
    request.signal.removeEventListener("abort", abort);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
