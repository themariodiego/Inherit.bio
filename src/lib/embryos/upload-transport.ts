import { EmbryoTransportError } from "./ingest-lines";
import { embryoVcfBuildEvidence } from "./vcf-build-evidence";
import { embryoVcfChunks } from "./vcf-transport";
import { z } from "zod";
import { route, routePattern } from "@/lib/primary-routes";

/**
 * The browser's half of an embryo upload after the cohort is finalized
 * (register `api.embryo-ingest-configure`, `api.embryo-ingest-chunk`,
 * `api.embryo-ingest-complete`; ADR 0035). Three requests in a fixed order,
 * all over the upload session the finalize response opened:
 *
 *   1. configure: the file's build lines and sample count, and the one-use
 *      `operationNonce`; the answer is the server's build, the transport
 *      challenge and revision, the completion nonce and the CSRF token;
 *   2. one PUT per chunk `embryoVcfChunks` writes, each with its own
 *      regenerated header bound to that challenge and the issued handles;
 *   3. complete, with the chunk count, the completion nonce and the CSRF
 *      token.
 *
 * The file is read twice in this browser: once for the configure lines, and
 * once as the chunks are written. Neither read leaves the device except as
 * the rewritten chunks, which carry no sample name, no INFO text and nothing
 * outside chromosomes 1 to 22.
 *
 * Every failure is one closed word, never a server body or source text. The
 * server fails the attempt on its own side for anything terminal, so a
 * failed upload is never retried from here: the page states the outcome.
 */

/** `operation-token.ts`'s `CSRF_HEADER`, which is server-only; the unit test pins the two together. */
export const UPLOAD_CSRF_HEADER = "x-inherit-csrf";

export interface UploadSession {
  session: string;
  uploadId: string;
  sampleHandles: { ordinal: number; handle: string }[];
  operationNonce: string;
  configureRoute: string;
  chunkRoute: string;
  completeRoute: string;
}

const sessionFields = z.object({
  session: z.uuid(), uploadId: z.uuid(), sampleHandles: z.array(z.object({ ordinal: z.number().int().nonnegative(), handle: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()).min(2).max(64),
  operationNonce: z.string().min(1), configureRoute: z.string(), chunkRoute: z.string(), completeRoute: z.string(),
}).strict().refine(value => {
  const chunkRoute = routePattern("api.embryo-ingest-chunk").replace("[session]", value.session);
  const handles = [...value.sampleHandles].sort((a, b) => a.ordinal - b.ordinal);
  return value.configureRoute === route("api.embryo-ingest-configure", { session: value.session }) && value.chunkRoute === chunkRoute
    && value.completeRoute === route("api.embryo-ingest-complete", { session: value.session }) && handles.every((item, index) => item.ordinal === index)
    && new Set(handles.map(item => item.handle)).size === handles.length;
});

/** Refuse a cross-session route, foreign origin, duplicate handle or missing ordinal before reading the file. */
export function readUploadSession(value: UploadSession): UploadSession {
  return sessionFields.parse({ session: value.session, uploadId: value.uploadId, sampleHandles: value.sampleHandles, operationNonce: value.operationNonce,
    configureRoute: value.configureRoute, chunkRoute: value.chunkRoute, completeRoute: value.completeRoute });
}

export type UploadFailure =
  | "not-a-vcf"
  | "pdf"
  | "too-large"
  | "build-unknown"
  | "sample-count"
  | "refused"
  | "network";

/**
 * `spent` says whether the session's one configure nonce was sent. Before
 * that, nothing reached the server and another file can be chosen; after it,
 * the session cannot be configured again, so the upload has ended.
 */
export class UploadTransportError extends Error {
  constructor(readonly failure: UploadFailure, readonly spent = false) {
    super(failure);
    this.name = "UploadTransportError";
  }
}

export type UploadProgress = { phase: "reading" } | { phase: "sending"; part: number } | { phase: "finishing" };

const configured = z.object({
  build: z.enum(["GRCh37", "GRCh38"]), challenge: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), completionNonce: z.string().min(1), csrfToken: z.string().min(1),
}).strict();

function transportFailure(error: unknown): UploadFailure {
  if (error instanceof UploadTransportError) return error.failure;
  if (error instanceof EmbryoTransportError) {
    switch (error.code) {
      case "pdf_not_data": return "pdf";
      case "too_large": return "too-large";
      case "build_unknown": return "build-unknown";
      default: return "not-a-vcf";
    }
  }
  return "network";
}

async function terminalOf(response: Response): Promise<UploadFailure> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body.error === "build_unknown") return "build-unknown";
    if (body.error === "cohort_single_sample" || body.error === "sample_count_mismatch") return "sample-count";
    if (body.error === "too_large") return "too-large";
    if (body.error === "pdf_not_data") return "pdf";
    if (body.error === "invalid_genetic_chunk") return "not-a-vcf";
  } catch { /* the status alone decides below */ }
  return "refused";
}

/**
 * Send one chosen file over the session. Resolves once the server accepted
 * the completion; rejects with `UploadTransportError` otherwise.
 */
export async function sendEmbryoFile(input: {
  file: Blob;
  session: UploadSession;
  onProgress?: (progress: UploadProgress) => void;
  fetch?: typeof fetch;
}): Promise<void> {
  const send = input.fetch ?? fetch;
  const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  let spent = false;
  try {
    let session: UploadSession;
    try { session = readUploadSession(input.session); } catch { throw new UploadTransportError("refused"); }
    input.onProgress?.({ phase: "reading" });
    const evidence = await embryoVcfBuildEvidence(input.file);
    if (evidence.sampleCount !== session.sampleHandles.length) throw new UploadTransportError("sample-count");

    spent = true;
    const configure = await send(session.configureRoute,
      json({ format: "vcf", buildEvidence: evidence.buildEvidence, sampleCount: evidence.sampleCount,
        nonce: session.operationNonce }));
    if (configure.status !== 200) throw new UploadTransportError(await terminalOf(configure));
    const parsedTransport = configured.safeParse(await configure.json());
    if (!parsedTransport.success) throw new UploadTransportError("refused");
    const transport = parsedTransport.data;

    const handles = [...session.sampleHandles].sort((a, b) => a.ordinal - b.ordinal).map((item) => item.handle);
    let sequence = 0;
    for await (const chunk of embryoVcfChunks(input.file, {
      challenge: transport.challenge, revision: transport.revision, build: transport.build,
      sampleCount: evidence.sampleCount, handles,
    })) {
      input.onProgress?.({ phase: "sending", part: sequence + 1 });
      const stored = await send(session.chunkRoute.replace("[sequence]", String(sequence)), {
        method: "PUT", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/octet-stream" }, body: chunk as BodyInit,
      });
      if (stored.status !== 204) throw new UploadTransportError(await terminalOf(stored));
      sequence += 1;
    }

    input.onProgress?.({ phase: "finishing" });
    const complete = await send(session.completeRoute,
      json({ chunkCount: sequence, nonce: transport.completionNonce }, { [UPLOAD_CSRF_HEADER]: transport.csrfToken }));
    if (complete.status !== 200 && complete.status !== 202) throw new UploadTransportError(await terminalOf(complete));
    const accepted = z.object({ status: z.enum(["sanitization_pending", "sanitization_in_progress"]), uploadId: z.uuid(),
      jobId: z.uuid(), analysisState: z.enum(["queued", "running"]) }).strict().safeParse(await complete.json());
    if (!accepted.success || accepted.data.uploadId !== session.uploadId
      || (complete.status === 202 && (accepted.data.status !== "sanitization_pending" || accepted.data.analysisState !== "queued"))
      || (complete.status === 200 && accepted.data.status !== "sanitization_in_progress")) throw new UploadTransportError("refused");
  } catch (error) {
    throw new UploadTransportError(transportFailure(error), spent);
  }
}
