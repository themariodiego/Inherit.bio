import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS } from "@/lib/genome/ingest-limits";
import { sensitiveJson } from "./api";
import { closedResponse } from "./guards";
import { readBounded } from "./ingest-configure";

/**
 * The boundary of `POST /api/embryo-ingest/[session]/complete` (register
 * `api.embryo-ingest-complete`, response `embryo-ingest-complete-v1`). The
 * transaction is the worker stream's `public.complete_embryo_ingest_v1`; this
 * module owns only the closed request and the mapping of its outcomes to
 * the registered answers.
 */

/** Two small fields; nothing larger is read. */
export const COMPLETE_BODY_MAXIMUM_BYTES = 8_192;

/** `requestContract.closedBody`. */
export const completeBody = z
  .object({
    chunkCount: z.number().int().min(1).max(LIMITS.maximumChunks),
    nonce: z.string().min(1).max(4096),
  })
  .strict();
export type CompleteRequest = z.infer<typeof completeBody>;

export type CompleteIssue = "body" | "chunkCount" | "nonce";
const ISSUE_ORDER: readonly CompleteIssue[] = ["body", "chunkCount", "nonce"];

/** The closed body, or the closed `invalid-request-v1` issue list. */
export async function readCompleteBody(request: Request): Promise<{ ok: true; body: CompleteRequest } | { ok: false; issues: CompleteIssue[] }> {
  const type = (request.headers.get("content-type") ?? "").trim().toLowerCase();
  if (!/^application\/json(\s*;\s*charset=utf-8)?$/.test(type) || request.headers.has("content-encoding")) {
    return { ok: false, issues: ["body"] };
  }
  const bytes = await readBounded(request, COMPLETE_BODY_MAXIMUM_BYTES);
  if (!bytes) return { ok: false, issues: ["body"] };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    raw = undefined;
  }
  const parsed = completeBody.safeParse(raw);
  if (parsed.success) return { ok: true, body: parsed.data };
  const found = new Set<CompleteIssue>();
  for (const issue of parsed.error.issues) {
    const head = issue.path[0];
    const known = typeof head === "string" && (ISSUE_ORDER as readonly string[]).includes(head);
    found.add(known && issue.code !== "unrecognized_keys" ? (head as CompleteIssue) : "body");
  }
  return { ok: false, issues: ISSUE_ORDER.filter((issue) => found.has(issue)) };
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

const uuid = z.uuid();
const positiveRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** What `public.complete_embryo_ingest_v1` returns (#243). */
export const completeResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("sanitization_pending"), uploadId: uuid, jobId: uuid, analysisState: z.literal("queued") }).strict(),
  z.object({
    status: z.literal("sanitization_in_progress"), uploadId: uuid, jobId: uuid,
    analysisState: z.enum(["queued", "running"]),
  }).strict(),
  z.object({
    status: z.literal("mapping_required"),
    kind: z.enum(["columns", "build"]).nullable(),
    expiresAt: z.string().nullable(),
  }).strict(),
  z.object({
    status: z.literal("failure_pending"), cohortId: uuid, ingestRevision: positiveRevision,
    failureCode: z.string().nullable().optional(),
  }).strict(),
]);
export type CompleteResult = z.infer<typeof completeResult>;

function noReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

const SUCCESS_KEYS = ["status", "uploadId", "jobId", "analysisState"] as const;

/** `success[0]` (202, first completion) and `success[1]` (200, the existing job), through the closed-shape serializer. */
export async function completeAccepted(result: Extract<CompleteResult, { status: "sanitization_pending" | "sanitization_in_progress" }>): Promise<Response> {
  const body = { status: result.status, uploadId: result.uploadId, jobId: result.jobId, analysisState: result.analysisState };
  return noReferrer(await closedResponse("api.embryo-ingest-complete", SUCCESS_KEYS, body,
    result.status === "sanitization_pending" ? 202 : 200));
}

/** `missingOrNoncontiguous`: the chunk count or receipt set did not match. */
export function incompleteUpload(): Response {
  return noReferrer(sensitiveJson({ error: "incomplete_upload" }, 422));
}
