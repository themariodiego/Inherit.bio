import { EmbryoTransportError } from "./ingest-lines";
import { embryoVcfBuildEvidence } from "./vcf-build-evidence";
import { embryoVcfChunks } from "./vcf-transport";
import { embryoTableChunks } from "./table-transport";
import { embryoTableHeader, opensAsVcf, type TableHeaderCopy } from "./table-header";
import { applyMappingAnswers, mappingChallengeColumns, PGT_FIELDS, type CompleteMapping, type PgtField } from "../genome/parsers/pgt-table";
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
 * A laboratory table (ADR 0037) takes one more step between configure and
 * the chunks. Configure carries only the table's `##reference`/`##contig`
 * lines and answers with one mapping-inspection nonce. The mapping route
 * then receives the bounded header copy (forbidden columns already dropped
 * here) and answers, one step at a time, with a column question, the build
 * question, or the transport. The reader answers each question through
 * `decide`; the chunks carry only the chosen canonical columns, with every
 * source label replaced by its issued handle.
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
  | "table-unmapped"
  | "refused"
  | "network";

/**
 * A question the mapping route asked, in this browser's terms. The column
 * labels are the file's own header text, shown on this device only; the
 * route saw them in memory and returned neutral column numbers.
 */
export type MappingQuestion =
  | { kind: "columns"; decisions: { field: PgtField; candidates: { columnIndex: number; label: string }[] }[] }
  | { kind: "build" };

export type MappingAnswer =
  | { kind: "columns"; mappings: { field: PgtField; columnIndex: number }[] }
  | { kind: "build"; referenceBuild: "GRCh37" | "GRCh38" | "unknown" };

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

const tableConfigured = z.object({ nonce: z.string().min(1) }).strict();
const transportStep = z.object({
  kind: z.literal("transport"), build: z.enum(["GRCh37", "GRCh38"]), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), completionNonce: z.string().min(1), csrfToken: z.string().min(1),
}).strict();
const mappingStep = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("columns"), challengeId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    decisions: z.array(z.object({ sourceColumn: z.string(), columnIndex: z.number().int().nonnegative(),
      candidateFields: z.array(z.enum(PGT_FIELDS)).min(1).max(4) }).strict()).min(1),
    maximumDecisions: z.literal(4), expiresAt: z.string(), nonce: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("build"), challengeId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), questionCopyId: z.literal("upload.build.question"),
    options: z.array(z.object({ value: z.enum(["GRCh37", "GRCh38", "unknown"]), labelCopyId: z.string(), route: z.string().optional() }).strict()).length(3),
    expiresAt: z.string(), nonce: z.string().min(1),
  }).strict(),
  transportStep,
]);
type Transport = z.infer<typeof transportStep>;

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

/** The question the column challenge asks, grouped by field, after checking it is this browser's own plan. */
function columnQuestion(step: { decisions: { columnIndex: number; candidateFields: PgtField[] }[] }, table: TableHeaderCopy): MappingQuestion {
  if (!table.plan || table.plan.complete) throw new UploadTransportError("refused");
  const own = mappingChallengeColumns(table.plan);
  if (JSON.stringify(own) !== JSON.stringify(step.decisions.map(({ columnIndex, candidateFields }) => ({ columnIndex, candidateFields })))) {
    throw new UploadTransportError("refused");
  }
  return { kind: "columns", decisions: table.plan.decisions.map((decision) => ({
    field: decision.field,
    candidates: decision.candidates.map((columnIndex) => ({ columnIndex, label: table.labels[columnIndex] })),
  })) };
}

/** The complete mapping in the file's own column numbers, from the copy's. */
function sourceMapping(mapping: CompleteMapping, source: readonly number[]): CompleteMapping {
  const at = (index: number) => source[index];
  return {
    complete: true,
    identifier: { field: mapping.identifier.field, column: at(mapping.identifier.column) },
    genotype: at(mapping.genotype),
    locus: mapping.locus.kind === "rsid" ? { kind: "rsid", column: at(mapping.locus.column) }
      : { kind: "chrom-pos", chrom: at(mapping.locus.chrom), pos: at(mapping.locus.pos) },
  };
}

/**
 * Send one chosen file over the session. Resolves once the server accepted
 * the completion; rejects with `UploadTransportError` otherwise.
 */
export async function sendEmbryoFile(input: {
  file: Blob;
  session: UploadSession;
  onProgress?: (progress: UploadProgress) => void;
  /** Ask the reader one question of a laboratory table's mapping. */
  decide?: (question: MappingQuestion) => Promise<MappingAnswer>;
  fetch?: typeof fetch;
}): Promise<void> {
  const send = input.fetch ?? fetch;
  const json = (body: unknown, headers: Record<string, string> = {}, method = "POST"): RequestInit => ({
    method, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  let spent = false;
  try {
    let session: UploadSession;
    try { session = readUploadSession(input.session); } catch { throw new UploadTransportError("refused"); }
    input.onProgress?.({ phase: "reading" });
    if (!(await opensAsVcf(input.file))) {
      const table = await embryoTableHeader(input.file);
      if (!table.plan) throw new UploadTransportError("table-unmapped");
      spent = true;
      const transport = await mapTable(table, session);
      await sendChunks(session, transport, embryoTableTransport(table, transport));
      return;
    }
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

    await sendChunks(session, transport, embryoVcfChunks(input.file, {
      challenge: transport.challenge, revision: transport.revision, build: transport.build,
      sampleCount: evidence.sampleCount, handles: handlesOf(session),
    }));
  } catch (error) {
    throw new UploadTransportError(transportFailure(error), spent);
  }

  function handlesOf(session: UploadSession): string[] {
    return [...session.sampleHandles].sort((a, b) => a.ordinal - b.ordinal).map((item) => item.handle);
  }

  /**
   * Configure, inspect the header, then answer at most one column question
   * and one build question, in the order the route asks them. Resolves with
   * the transport the last answer carried.
   */
  async function mapTable(table: TableHeaderCopy, session: UploadSession): Promise<Transport & { answers: { field: PgtField; column: number }[] }> {
    const configure = await send(session.configureRoute,
      json({ format: "pgt_table", buildEvidence: table.buildEvidence, nonce: session.operationNonce }));
    if (configure.status !== 200) throw new UploadTransportError(await terminalOf(configure));
    const configured = tableConfigured.safeParse(await configure.json());
    if (!configured.success) throw new UploadTransportError("refused");
    const mappingRoute = route("api.embryo-ingest-mapping", { session: session.session });
    let response = await send(mappingRoute, json({ headerColumns: table.copy, nonce: configured.data.nonce }));
    let answers: { field: PgtField; column: number }[] = [];
    for (let step = 0; step < 3; step++) {
      if (response.status !== 200) throw new UploadTransportError(await terminalOf(response));
      const parsed = mappingStep.safeParse(await response.json());
      if (!parsed.success) throw new UploadTransportError("refused");
      const next = parsed.data;
      if (next.kind === "transport") return { ...next, answers };
      if (!input.decide) throw new UploadTransportError("refused");
      if (next.kind === "columns") {
        const answer = await input.decide(columnQuestion(next, table));
        if (answer.kind !== "columns") throw new UploadTransportError("refused");
        answers = answer.mappings.map(({ field, columnIndex }) => ({ field, column: columnIndex }));
        response = await send(mappingRoute, json({ challengeId: next.challengeId,
          mappings: answer.mappings.map(({ columnIndex, field }) => ({ columnIndex, field })), nonce: next.nonce }, {}, "PUT"));
      } else {
        const answer = await input.decide({ kind: "build" });
        if (answer.kind !== "build") throw new UploadTransportError("refused");
        response = await send(mappingRoute, json({ challengeId: next.challengeId, referenceBuild: answer.referenceBuild,
          nonce: next.nonce }, {}, "PUT"));
      }
    }
    throw new UploadTransportError("refused");
  }

  /** The table rewrite, bound to the issued transport and the reader's answers. */
  async function* embryoTableTransport(table: TableHeaderCopy, transport: Transport & { answers: { field: PgtField; column: number }[] }) {
    const mapping = applyMappingAnswers(table.header, transport.answers);
    if (!mapping) throw new UploadTransportError("refused");
    const session = readUploadSession(input.session);
    try {
      yield* embryoTableChunks(input.file, {
        challenge: transport.challenge, revision: transport.revision, build: transport.build,
        sampleCount: session.sampleHandles.length, handles: handlesOf(session), mapping: sourceMapping(mapping, table.source),
      });
    } catch (error) {
      // More labels than embryos, or fewer, is the count the reader gave.
      if (error instanceof EmbryoTransportError && error.code === "invalid_session") throw new UploadTransportError("sample-count");
      throw error;
    }
  }

  /** One PUT per chunk, then the completion with the transport's two tokens. */
  async function sendChunks(session: UploadSession, transport: Transport | z.infer<typeof configured>, chunks: AsyncIterable<Uint8Array>) {
    let sequence = 0;
    for await (const chunk of chunks) {
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
  }
}
