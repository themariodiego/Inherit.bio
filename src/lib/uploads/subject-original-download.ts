import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { CHUNK_BYTES, downloadCookie, downloadCookieHash } from "@/lib/future-person/review";
import { preparedStorageConfig } from "@/lib/genome/prepared-source/storage-common";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import { originalDownloadName } from "./original-download-name";

/**
 * api.subject-download (GET /api/subjects/[id]/download?file=...) and its
 * genome branch of api.download-chunk, under revocable-chunk-session-v1.
 *
 * Owner decision of 16 October 2026 ("The subjects endpoints (G2.1)"): the
 * person's own data only, the self record or an adult record whose account is
 * the caller. Every other case (uploader, grantee, embryo) answers the opaque
 * resource-not-found-v1 until its permission path exists.
 *
 * The create step returns download-session-v1 and sets the download cookie;
 * the database keeps only the cookie's SHA-256. There is no signed or direct
 * Storage URL: each chunk is re-authorized by the database
 * (authorize_subject_original_chunk_v1), read by the service as one exact
 * range, and released only after a second authorization
 * (record_subject_original_chunk_v1), so a revocation during the read still
 * stops delivery.
 */

/** sensitiveResponseHeaders.downloadOrExport, with the no-store set every user-data response carries. */
export const DOWNLOAD_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SEQUENCE = /^(0|[1-9][0-9]{0,8})$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/u;

export type DownloadActor = { accountId: string; sessionId: string };
type RpcResult = { data: unknown; error: { code?: string } | null };
export type SubjectDownloadDependencies = {
  /** TEST-LOCAL only (INHERIT_TEST_JURISDICTION=1): closed, no session opens and no chunk is served. */
  enabled(): boolean;
  actor(): Promise<DownloadActor | null>;
  rpc(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<RpcResult>;
  /** One exact service-read byte range of the private genomes object. Never a URL. */
  readRange(objectKey: string, start: number, end: number, signal: AbortSignal): Promise<Response>;
  secret(): string;
};

function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...DOWNLOAD_HEADERS, ...(extra ?? {}) } });
}
export const downloadNotFound = () => json({ error: "not_found" }, 404);
const unauthenticated = () => json({ error: "unauthenticated" }, 401);
const invalid = (issues: string[]) => json({ error: "invalid_request", issues }, 422);
const unavailable = () => json({ error: "unavailable" }, 503);

const opened = z.object({
  session: z.uuid(), sizeBytes: z.number().int().positive().safe(), sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  chunkCount: z.number().int().positive().safe(), fileType: z.string().min(1).max(40),
  originalName: z.string().min(1).max(1024), sourceSha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

const authorized = z.object({
  status: z.literal("authorized"), session: z.uuid(), objectKey: z.string().min(1).max(1024),
  objectVersion: z.string().min(1).max(200), sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  sizeBytes: z.number().int().positive().safe(), chunkCount: z.number().int().positive().safe(),
  start: z.number().int().nonnegative().safe(), end: z.number().int().nonnegative().safe(),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

/**
 * download-session-v1.filename: the generic stored name with its type's
 * extension, reduced to plain characters. A legacy name that is not plain
 * becomes `genome-file` with the same extension, so no stored label leaves.
 */
export function subjectDownloadFilename(file: { originalName: string; fileType: string; sha256: string; sourceSha256: string | null }): string {
  const saved = originalDownloadName({ original_name: file.originalName, file_type: file.fileType,
    sha256: file.sha256, source_sha256: file.sourceSha256 });
  if (SAFE_NAME.test(saved)) return saved;
  const extension = originalDownloadName({ original_name: "genome-file", file_type: file.fileType,
    sha256: file.sha256, source_sha256: file.sourceSha256 });
  return extension;
}

/** The closed query: exactly one `file`, a canonical lowercase UUID. */
export function subjectDownloadQuery(url: URL): { file: string } | { issues: string[] } {
  const keys = [...url.searchParams.keys()];
  const files = url.searchParams.getAll("file");
  if (keys.some((key) => key !== "file")) return { issues: ["query"] };
  if (files.length !== 1 || !UUID.test(files[0]!)) return { issues: ["file"] };
  return { file: files[0]! };
}

function errorCode(error: { code?: string } | null): string {
  return error?.code ?? "";
}

/** GET /api/subjects/[id]/download. */
export async function openSubjectDownload(request: Request, subjectId: string, deps: SubjectDownloadDependencies): Promise<Response> {
  if (!deps.enabled() || request.method !== "GET" || request.headers.get("sec-fetch-site") !== "same-origin") return downloadNotFound();
  if (!UUID.test(subjectId)) return downloadNotFound();
  const actor = await deps.actor();
  if (!actor) return unauthenticated();
  const url = new URL(request.url);
  const query = subjectDownloadQuery(url);
  if ("issues" in query) {
    // invalid-request-v1.authorizationPrecedence: a subject the caller cannot
    // read is the opaque 404 before any field is validated.
    const target = await deps.rpc("subject_original_download_target_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId,
    }, request.signal);
    if (target.error) return errorCode(target.error) === "42501" ? downloadNotFound() : unavailable();
    return target.data === true ? invalid(query.issues) : downloadNotFound();
  }
  const secret = deps.secret();
  const cookieHash = crypto.createHash("sha256").update(secret).digest("hex");
  const result = await deps.rpc("open_subject_original_download_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId,
    p_file_id: query.file, p_cookie_hash: cookieHash,
  }, request.signal);
  if (result.error) return errorCode(result.error) === "42501" ? downloadNotFound() : unavailable();
  const session = opened.safeParse(result.data);
  if (!session.success || session.data.chunkCount !== Math.ceil(session.data.sizeBytes / CHUNK_BYTES)
    || Date.parse(session.data.expiresAt) <= Date.now()) return unavailable();
  const body = {
    session: session.data.session,
    filename: subjectDownloadFilename(session.data),
    sizeBytes: session.data.sizeBytes,
    sha256: session.data.sha256,
    chunkBytes: CHUNK_BYTES,
    chunkCount: session.data.chunkCount,
    chunkRoute: `/api/downloads/${session.data.session}/chunks/{sequence}`,
  };
  return json(body, 200, { "Set-Cookie": downloadCookie(secret) });
}

/**
 * The genome branch of GET /api/downloads/[session]/chunks/[sequence].
 * Null when the session is not a subject original session (or there is no
 * signed-in account at all), so the route's other session kinds are tried;
 * otherwise the complete answer.
 */
export async function getSubjectOriginalChunk(request: Request, params: { session: string; sequence: string },
  deps: SubjectDownloadDependencies): Promise<Response | null> {
  if (!deps.enabled() || !UUID.test(params.session)) return null;
  const cookieHash = downloadCookieHash(request);
  if (!cookieHash) return null;
  const actor = await deps.actor();
  if (!actor) return null;
  const sequenceValid = SEQUENCE.test(params.sequence);
  const ids = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_download_id: params.session,
    p_cookie_hash: cookieHash };
  const url = new URL(request.url);
  const admissible = url.search === "" && request.headers.get("range") === null
    && request.headers.get("sec-fetch-site") === "same-origin";
  const first = await deps.rpc("authorize_subject_original_chunk_v1", { ...ids,
    p_sequence: sequenceValid && admissible ? Number(params.sequence) : -1 }, request.signal);
  if (!first.error && first.data === null) return null;
  if (!admissible) return downloadNotFound();
  if (first.error) {
    const code = errorCode(first.error);
    if (code === "22023") return invalid(["sequence"]);
    return code === "42501" ? downloadNotFound() : unavailable();
  }
  if ((first.data as { status?: unknown } | null)?.status === "ended") return downloadNotFound();
  const grant = authorized.safeParse(first.data);
  if (!grant.success || grant.data.session !== params.session || grant.data.end < grant.data.start
    || grant.data.end >= grant.data.sizeBytes || grant.data.end - grant.data.start + 1 > CHUNK_BYTES
    || (grant.data.end + 1 < grant.data.sizeBytes && grant.data.end - grant.data.start + 1 !== CHUNK_BYTES)) return unavailable();
  const { start, end, sizeBytes } = grant.data;
  const count = end - start + 1;
  const part = new Uint8Array(count);
  let released = false;
  try {
    const timeout = AbortSignal.timeout(30_000);
    const signal = AbortSignal.any([request.signal, timeout]);
    let response: Response;
    try {
      response = await deps.readRange(grant.data.objectKey, start, end, signal);
    } catch {
      return unavailable();
    }
    if (response.status !== 206 || response.redirected || !response.body
      || response.headers.get("content-range") !== `bytes ${start}-${end}/${sizeBytes}`
      || (response.headers.has("content-length") && response.headers.get("content-length") !== String(count))
      || (response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity")) {
      await response.body?.cancel().catch(() => {});
      return unavailable();
    }
    const reader = response.body.getReader();
    let offset = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if (!(next.value instanceof Uint8Array) || next.value.length > count - offset) {
          await reader.cancel().catch(() => {});
          return unavailable();
        }
        part.set(next.value, offset);
        offset += next.value.length;
      }
    } catch {
      return unavailable();
    } finally {
      reader.releaseLock();
    }
    if (offset !== count) return unavailable();
    // A revocation, expiry or object change during the read stops delivery here.
    const second = await deps.rpc("record_subject_original_chunk_v1", { ...ids, p_sequence: Number(params.sequence),
      p_byte_count: count }, request.signal);
    if (second.error) return errorCode(second.error) === "42501" ? downloadNotFound() : unavailable();
    if (second.data !== "recorded") return downloadNotFound();
    released = true;
    return new Response(part, {
      status: 200,
      headers: { ...DOWNLOAD_HEADERS, "Content-Type": "application/octet-stream", "Content-Length": String(count),
        "Content-Encoding": "identity" },
    });
  } finally {
    if (!released) part.fill(0);
  }
}

/** The configured private genomes object, one exact range, service-authenticated. */
export function readGenomeObjectRange(objectKey: string, start: number, end: number, signal: AbortSignal): Promise<Response> {
  const config = preparedStorageConfig();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/u.test(objectKey) || objectKey.includes("..")) {
    return Promise.reject(new Error("unavailable"));
  }
  return fetch(`${config.origin}/storage/v1/object/authenticated/genomes/${objectKey}`, {
    method: "GET", signal, cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${config.key}`, apikey: config.key, "Accept-Encoding": "identity",
      Range: `bytes=${start}-${end}` },
  });
}

export function subjectDownloadDependencies(): SubjectDownloadDependencies {
  return {
    enabled: () => isTestJurisdictionEnabled(),
    async actor() {
      const context = await getSensitiveAccountContext();
      return context ? { accountId: context.user.id, sessionId: context.sessionId } : null;
    },
    async rpc(name, args, signal) {
      const admin = createAdminClient();
      const result = await admin.rpc(name as never, args as never).retry(false).abortSignal(signal);
      return { data: result.data, error: result.error };
    },
    readRange: readGenomeObjectRange,
    secret: () => crypto.randomBytes(32).toString("base64url"),
  };
}
