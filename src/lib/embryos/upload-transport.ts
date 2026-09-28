import { EmbryoTransportError } from "./ingest-lines";
import { embryoVcfBuildEvidence } from "./vcf-build-evidence";
import { embryoVcfChunks } from "./vcf-transport";

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
  sampleHandles: { ordinal: number; handle: string }[];
  operationNonce: string;
  configureRoute: string;
  chunkRoute: string;
  completeRoute: string;
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

const configured = (value: unknown): value is {
  build: "GRCh37" | "GRCh38"; challenge: string; revision: number; completionNonce: string; csrfToken: string;
} => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (record.build === "GRCh37" || record.build === "GRCh38") && typeof record.challenge === "string"
    && typeof record.revision === "number" && typeof record.completionNonce === "string"
    && typeof record.csrfToken === "string";
};

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
    input.onProgress?.({ phase: "reading" });
    const evidence = await embryoVcfBuildEvidence(input.file);
    if (evidence.sampleCount !== input.session.sampleHandles.length) throw new UploadTransportError("sample-count");

    spent = true;
    const configure = await send(input.session.configureRoute,
      json({ format: "vcf", buildEvidence: evidence.buildEvidence, sampleCount: evidence.sampleCount,
        nonce: input.session.operationNonce }));
    if (configure.status !== 200) throw new UploadTransportError(await terminalOf(configure));
    const transport: unknown = await configure.json();
    if (!configured(transport)) throw new UploadTransportError("refused");

    const handles = [...input.session.sampleHandles].sort((a, b) => a.ordinal - b.ordinal).map((item) => item.handle);
    let sequence = 0;
    for await (const chunk of embryoVcfChunks(input.file, {
      challenge: transport.challenge, revision: transport.revision, build: transport.build,
      sampleCount: evidence.sampleCount, handles,
    })) {
      input.onProgress?.({ phase: "sending", part: sequence + 1 });
      const stored = await send(input.session.chunkRoute.replace("[sequence]", String(sequence)), {
        method: "PUT", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/octet-stream" }, body: chunk as BodyInit,
      });
      if (stored.status !== 204) throw new UploadTransportError(await terminalOf(stored));
      sequence += 1;
    }

    input.onProgress?.({ phase: "finishing" });
    const complete = await send(input.session.completeRoute,
      json({ chunkCount: sequence, nonce: transport.completionNonce }, { [UPLOAD_CSRF_HEADER]: transport.csrfToken }));
    if (complete.status !== 200 && complete.status !== 202) throw new UploadTransportError(await terminalOf(complete));
  } catch (error) {
    throw new UploadTransportError(transportFailure(error), spent);
  }
}
