import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { hasEmptyRequestBody } from "@/lib/empty-request-body";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { claimantCsrf, claimantNotFound, claimantSessionHash } from "@/lib/future-person/rights";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { sensitiveJson } from "@/lib/embryos/api";
import { EXPORT_OPERATION_TOKEN_MAX_LENGTH, mintExportOperation, verifyExportOperation,
  type ExportOperationContext } from "./export-operation-token";
import { ACCOUNT_EXPORT_COOKIE } from "./account-export-session";

/**
 * The approved claimant's own export (register api.future-person-export,
 * POST/GET /api/future-person/claim/[token]/export with the segment pinned to
 * `session`), under largeExportDeliveryContract and approved-future-person-
 * export-v1. TEST-LOCAL only: claims exist only where embryo analysis runs.
 *
 * The rights-session cookie is the only principal. Every operation first asks
 * the database for the current capture of that live session
 * (future_person_export_request_v1 'capture'); the operation nonce and the
 * export cookie are bound to that capture and to the session, never to a
 * body, URL or contact. Every refusal is the one opaque 404, as the register
 * says for this route.
 *
 * Generation and delivery are separate capabilities. No claimant generation
 * or delivery capability exists yet (the claimant archive needs the TEST R2
 * pipeline, whose credentials do not exist, and READY for a claimant archive
 * stays closed in the database). Until one is supplied, create and open-ready
 * answer 503 before any database write, exactly as api.export does without
 * its capability, and a poll never reaches READY.
 */

export const CLAIMANT_EXPORT_FILENAME = "inherit-claimed-record-export.zip";
export const CLAIMANT_EXPORT_CHUNK_BYTES = 4_000_000;
const ROUTE = "api.future-person-export" as const;
const CONTRACT = "approved-future-person-export-v1" as const;

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), revision = z.number().int().positive().safe();
const captureSchema = z.object({ principalId: uuid, principalHash: hash, originBinding: hash, authorityReceipt: hash,
  lifecycleRevision: revision, principalGraphRevision: revision, subjectPartitions: z.array(uuid).length(1),
  fileCount: z.literal(1) }).strict();
const createSchema = z.object({ exportId: uuid, exportRevision: z.literal(1), status: z.literal("queued"), authorityReceipt: hash }).strict();
const statusSchema = z.object({ exportId: uuid, exportRevision: revision,
  status: z.enum(["queued", "building", "ready", "failed", "revoked", "expired", "purged"]),
  expiresAt: z.iso.datetime({ offset: true }).nullable() }).strict();
const readySchema = z.object({ exportId: uuid, exportRevision: revision, sizeBytes: z.number().int().positive().safe(), sha256: hash,
  expiresAt: z.iso.datetime({ offset: true }), segmentCount: z.number().int().positive().safe(),
  pageCount: z.number().int().positive().safe(), authorityReceipt: hash }).strict()
  .refine(value => value.segmentCount === Math.ceil(value.sizeBytes / CLAIMANT_EXPORT_CHUNK_BYTES)
    && value.pageCount === Math.ceil(value.segmentCount / 128));
const openSchema = z.object({ downloadSessionId: uuid, expiresAt: z.iso.datetime({ offset: true }),
  chunkBytes: z.literal(CLAIMANT_EXPORT_CHUNK_BYTES), sizeBytes: z.number().int().positive().safe(), sha256: hash }).strict();
export const claimantExportBody = z.object({ operation: z.enum(["create", "open-ready"]),
  nonce: z.string().min(1).max(EXPORT_OPERATION_TOKEN_MAX_LENGTH) }).strict();

type RpcResult = PromiseLike<{ data: unknown; error: { code?: string } | null }>;
export type ClaimantExportRpc = {
  request(operation: "capture" | "create" | "check", sessionHash: string, payload: unknown, csrfBinding: string | null, signal: AbortSignal): RpcResult;
  ready(sessionHash: string, payload: unknown, signal: AbortSignal): RpcResult;
  open(sessionHash: string, payload: unknown, csrfBinding: string, signal: AbortSignal): RpcResult;
};
/** Supplied only by a reviewed composition. Nothing in production selects one. */
export type ClaimantExportCapability = Readonly<{ assertReady(signal: AbortSignal): Promise<void> }>;
export type ClaimantExportDependencies = {
  open: () => boolean;
  rpc: () => ClaimantExportRpc;
  generation: ClaimantExportCapability | null;
  delivery: ClaimantExportCapability | null;
};

export function claimantExportDependencies(): ClaimantExportDependencies {
  return {
    open: () => futurePersonClaimsOpen(),
    rpc: () => {
      const admin = createAdminClient();
      return {
        request: (operation, sessionHash, payload, csrfBinding, signal) => admin.rpc("future_person_export_request_v1", {
          p_operation: operation, p_session_hash: sessionHash, ...(payload === null ? {} : { p_payload: payload as Json }),
          ...(csrfBinding === null ? {} : { p_csrf_binding: csrfBinding }) }).retry(false).abortSignal(signal),
        ready: (sessionHash, payload, signal) => admin.rpc("future_person_export_ready_v1", {
          p_session_hash: sessionHash, p_payload: payload as Json }).retry(false).abortSignal(signal),
        open: (sessionHash, payload, csrfBinding, signal) => admin.rpc("future_person_export_open_ready_v1", {
          p_session_hash: sessionHash, p_payload: payload as Json, p_csrf_binding: csrfBinding }).retry(false).abortSignal(signal),
      };
    },
    // No claimant archive generation or delivery capability exists yet.
    generation: null,
    delivery: null,
  };
}

class Refusal extends Error { constructor(readonly code?: string) { super("claimant_export_unavailable"); } }
const unavailable = () => { const response = sensitiveJson({ error: "unavailable" }, 503); response.headers.set("referrer-policy", "no-referrer"); return response; };
const json = (body: unknown, status: number) => { const response = sensitiveJson(body, status); response.headers.set("referrer-policy", "no-referrer"); return response; };
const REFUSALS = new Set(["42501", "23505", "22023", "55000"]);
function failure(error: unknown): Response {
  // Authority, replay, conflict, stale and shape refusals are the one opaque
  // 404. Only a database or capability fault the caller cannot cause is 503.
  if (error instanceof Unready || (error instanceof Refusal && error.code !== undefined && !REFUSALS.has(error.code))) return unavailable();
  return claimantNotFound();
}
class Unready extends Error {}
async function ready(capability: ClaimantExportCapability, signal: AbortSignal) {
  try { await capability.assertReady(signal); } catch { throw new Unready("claimant_export_capability_unavailable"); }
}

async function call(work: (signal: AbortSignal) => RpcResult, signal: AbortSignal, milliseconds = 30_000): Promise<unknown> {
  const stop = AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]);
  if (stop.aborted) throw new Refusal();
  const result = await work(stop);
  if (stop.aborted) throw new Refusal();
  if (result.error) throw new Refusal(result.error.code);
  return result.data;
}

/** The CSRF digest the operation envelope carries: session, header value and operation. */
export function claimantExportCsrfBinding(sessionHash: string, operation: "create" | "open-ready"): string {
  return hmacSecret(JSON.stringify([sessionHash, claimantCsrf(sessionHash), operation]), "future-person-export-csrf-binding-v1");
}
function csrfMatches(request: Request, sessionHash: string): boolean {
  const presented = request.headers.get("x-inherit-csrf");
  return !!presented && /^[0-9a-f]{64}$/u.test(presented)
    && timingSafeEqual(Buffer.from(presented), Buffer.from(claimantCsrf(sessionHash)));
}

function context(capture: z.infer<typeof captureSchema>, csrfBinding: string): Omit<ExportOperationContext, "operation"> {
  return { routeId: ROUTE, origin: "independent-rights", principalId: capture.principalId, targetKind: "subject",
    targetId: capture.subjectPartitions[0]!, exportContract: CONTRACT, originBinding: capture.originBinding,
    authorityReceipt: capture.authorityReceipt, csrfBinding };
}

/** The export cookie: `<exportId>.<secret>`; the database holds only a keyed digest bound to the rights session. */
export function claimantExportCookieHash(secret: string, sessionHash: string): string {
  return hmacSecret(JSON.stringify([sessionHash, secret]), "future-person-export-cookie-v1");
}
function readCookie(request: Request, sessionHash: string): { exportId: string; hash: string } | null {
  const matches = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.split("=")[0] === ACCOUNT_EXPORT_COOKIE);
  if (matches.length !== 1) return null;
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/u.exec(matches[0]!.slice(ACCOUNT_EXPORT_COOKIE.length + 1));
  if (!match || !uuid.safeParse(match[1]).success || Buffer.from(match[2]!, "base64url").toString("base64url") !== match[2]) return null;
  return { exportId: match[1]!, hash: claimantExportCookieHash(match[2]!, sessionHash) };
}

function admitted(request: Request, deps: ClaimantExportDependencies): string | null {
  const url = new URL(request.url);
  if (!deps.open() || url.search !== "") return null;
  return claimantSessionHash(request);
}

/** Explicit server-rendered presentation of the create action. Renders nothing
 * and writes nothing when no generation capability exists. */
export async function presentClaimantExportCreate(request: Request, deps: ClaimantExportDependencies = claimantExportDependencies()) {
  if (!deps.generation) return null;
  const sessionHash = admitted(request, deps);
  if (!sessionHash) return null;
  try {
    const capture = captureSchema.parse(await call(signal => deps.rpc().request("capture", sessionHash, null, null, signal), request.signal));
    const operation = mintExportOperation({ ...context(capture, claimantExportCsrfBinding(sessionHash, "create")), operation: "create" });
    return Object.freeze({ operation: "create" as const, nonce: operation.token, csrf: claimantCsrf(sessionHash) });
  } catch { return null; }
}

export async function postClaimantExport(request: Request, deps: ClaimantExportDependencies = claimantExportDependencies()): Promise<Response> {
  try {
    const sessionHash = admitted(request, deps);
    const url = new URL(request.url);
    if (!sessionHash || request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin"
      || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      || !csrfMatches(request, sessionHash)) return claimantNotFound();
    const body = claimantExportBody.safeParse(await readBoundedJson(request, 4096));
    if (!body.success) return claimantNotFound();
    const rpc = deps.rpc();
    const capture = captureSchema.parse(await call(signal => rpc.request("capture", sessionHash, null, null, signal), request.signal));
    const csrfBinding = claimantExportCsrfBinding(sessionHash, body.data.operation);
    if (body.data.operation === "create") {
      const envelope = verifyExportOperation(body.data.nonce, { ...context(capture, csrfBinding), operation: "create" });
      if (!envelope) return claimantNotFound();
      if (!deps.generation) return unavailable();
      await ready(deps.generation, request.signal);
      const secret = randomBytes(32).toString("base64url");
      const result = createSchema.parse(await call(signal => rpc.request("create", sessionHash,
        { envelope, exportCookieHash: claimantExportCookieHash(secret, sessionHash) }, csrfBinding, signal), request.signal));
      if (result.authorityReceipt !== capture.authorityReceipt) throw new Refusal();
      const response = json({ status: "preparing", exportId: result.exportId }, 202);
      response.headers.set("set-cookie", `${ACCOUNT_EXPORT_COOKIE}=${result.exportId}.${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`);
      return response;
    }
    const cookie = readCookie(request, sessionHash);
    if (!cookie) return claimantNotFound();
    const status = statusSchema.parse(await call(signal => rpc.request("check", sessionHash,
      { exportId: cookie.exportId, exportCookieHash: cookie.hash }, null, signal), request.signal));
    if (status.exportId !== cookie.exportId || status.status !== "ready") return claimantNotFound();
    const envelope = verifyExportOperation(body.data.nonce, { ...context(capture, csrfBinding), operation: "open-ready",
      exportId: status.exportId, exportRevision: status.exportRevision });
    if (!envelope) return claimantNotFound();
    if (!deps.delivery) return unavailable();
    await ready(deps.delivery, request.signal);
    const current = readySchema.parse(await call(signal => rpc.ready(sessionHash,
      { exportId: cookie.exportId, exportCookieHash: cookie.hash }, signal), request.signal));
    if (current.authorityReceipt !== capture.authorityReceipt || current.exportRevision !== status.exportRevision) throw new Refusal();
    const secret = randomBytes(32).toString("base64url");
    const opened = openSchema.parse(await call(signal => rpc.open(sessionHash, { exportId: cookie.exportId, envelope,
      downloadCookieHash: createHash("sha256").update(secret).digest("hex"), exportCookieHash: cookie.hash }, csrfBinding, signal), request.signal));
    if (opened.sizeBytes !== current.sizeBytes || opened.sha256 !== current.sha256 || Date.parse(opened.expiresAt) <= Date.now()
      || Date.parse(opened.expiresAt) > Date.parse(current.expiresAt) || Date.parse(opened.expiresAt) > Date.now() + 3_600_000) throw new Refusal();
    const response = json({ session: opened.downloadSessionId, filename: CLAIMANT_EXPORT_FILENAME, sizeBytes: opened.sizeBytes,
      sha256: opened.sha256, chunkBytes: opened.chunkBytes, chunkCount: current.segmentCount,
      chunkRoute: `/api/downloads/${opened.downloadSessionId}/chunks/{sequence}` }, 200);
    response.headers.set("set-cookie", `__Host-inherit-download=${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1, Math.floor((Date.parse(opened.expiresAt) - Date.now()) / 1000))}`);
    return response;
  } catch (error) { return failure(error); }
}

/** GET: poll only. Zero enqueue, cookie, credential or other write. */
export async function pollClaimantExport(request: Request, deps: ClaimantExportDependencies = claimantExportDependencies()): Promise<Response> {
  try {
    const sessionHash = admitted(request, deps);
    if (!sessionHash || !(await hasEmptyRequestBody(request))) return claimantNotFound();
    const cookie = readCookie(request, sessionHash);
    if (!cookie) return claimantNotFound();
    const rpc = deps.rpc();
    const status = statusSchema.parse(await call(signal => rpc.request("check", sessionHash,
      { exportId: cookie.exportId, exportCookieHash: cookie.hash }, null, signal), request.signal));
    if (status.exportId !== cookie.exportId) throw new Refusal();
    if (status.status === "queued" || status.status === "building") return json({ status: "preparing", exportId: status.exportId }, 202);
    if (status.status !== "ready") return claimantNotFound();
    if (!deps.delivery) return unavailable();
    await ready(deps.delivery, request.signal);
    const current = readySchema.parse(await call(signal => rpc.ready(sessionHash,
      { exportId: cookie.exportId, exportCookieHash: cookie.hash }, signal), request.signal));
    if (current.exportId !== status.exportId) throw new Refusal();
    return json({ status: "ready", exportId: current.exportId, filename: CLAIMANT_EXPORT_FILENAME, sizeBytes: current.sizeBytes,
      sha256: current.sha256, openAction: { method: "POST", operation: "open-ready" } }, 200);
  } catch (error) { return failure(error); }
}
