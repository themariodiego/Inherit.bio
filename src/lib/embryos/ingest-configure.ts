import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { buildFromHeaderLines } from "@/lib/genome/parsers/vcf";
import { route } from "@/lib/primary-routes";
import { closedResponse } from "./guards";
import { sensitiveJson } from "./api";

/**
 * The request and response halves of `POST /api/embryo-ingest/[session]/configure`
 * (register `api.embryo-ingest-configure`, response `embryo-vcf-transport-v1`,
 * ADR 0035). The route owns authority and ordering; this module owns what may
 * cross the boundary in each direction.
 *
 * In: four closed fields, and of the source file only its `##fileformat`,
 * `##reference` and `##contig` lines and its sample count. Sample names, the
 * `#CHROM` line and every other meta line are refused before any database
 * row is touched, because they can name people or laboratories and the build
 * does not need them.
 *
 * Out: the server-derived build and the credentials the rest of the upload
 * needs. Nothing a caller submitted is echoed in any branch.
 */

export const BUILD_EVIDENCE_MAXIMUM_LINES = 64;
export const BUILD_EVIDENCE_MAXIMUM_CHARACTERS = 512;

/**
 * The largest body this route reads. A browser's `JSON.stringify` of 64 lines
 * of 512 characters stays under 100 KB even when every character takes three
 * UTF-8 bytes; anything larger is refused before it is parsed.
 */
export const CONFIGURE_BODY_MAXIMUM_BYTES = 131_072;

/** The only meta lines the build rule may see (`forbiddenLines`). */
const PERMITTED_PREFIXES = ["##fileformat=", "##reference=", "##contig="] as const;

/** No line terminator, tab or other control character survives a verbatim copy of one line. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The closed, server-derived issue vocabulary of `invalid-request-v1` for this route. */
export type ConfigureIssue = "body" | "format" | "buildEvidence" | "sampleCount" | "nonce";
const ISSUE_ORDER: readonly ConfigureIssue[] = ["body", "format", "buildEvidence", "sampleCount", "nonce"];

const evidenceLine = z
  .string()
  .max(BUILD_EVIDENCE_MAXIMUM_CHARACTERS)
  .refine((line) => !CONTROL.test(line));

/** `methodRequestContracts.POST.closedBody`; every other key is refused, including the forbidden fields. */
export const configureBody = z
  .object({
    format: z.literal("vcf"),
    buildEvidence: z.array(evidenceLine).max(BUILD_EVIDENCE_MAXIMUM_LINES),
    sampleCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    nonce: z.string().min(1).max(4096),
  })
  .strict();
export type ConfigureRequest = z.infer<typeof configureBody>;

export type ConfigureParse = { ok: true; body: ConfigureRequest } | { ok: false; issues: ConfigureIssue[] };

/** Whether a submitted line is one the build rule may read. `#CHROM`, `##SAMPLE`, `##PEDIGREE` and `##source` are not. */
export function isPermittedEvidenceLine(line: string): boolean {
  return PERMITTED_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function issuesOf(error: z.ZodError): ConfigureIssue[] {
  const found = new Set<ConfigureIssue>();
  for (const issue of error.issues) {
    const head = issue.path[0];
    const known = typeof head === "string" && (ISSUE_ORDER as readonly string[]).includes(head);
    found.add(known && issue.code !== "unrecognized_keys" ? (head as ConfigureIssue) : "body");
  }
  return ISSUE_ORDER.filter((issue) => found.has(issue));
}

/**
 * Overwrite and drop every submitted line. JavaScript strings cannot be
 * overwritten in place, so this is the most the runtime allows: the byte
 * buffer the body arrived in is zero-filled by `readConfigureBody`, and the
 * array that referenced the decoded lines is emptied here so no later code
 * path, error or log can reach them.
 */
export function zeroizeEvidence(body: { buildEvidence: string[] } | null | undefined): void {
  if (!body) return;
  body.buildEvidence.fill("");
  body.buildEvidence.length = 0;
}

/**
 * Stream at most `limit` bytes of the body. Content-Length is a claim, not a
 * bound, so the actual bytes are counted; an overflow cancels the stream and
 * zero-fills what was already read.
 */
export async function readBounded(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > limit)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      parts.push(part.value);
      if (length > limit) {
        await reader.cancel().catch(() => {});
        for (const chunk of parts) chunk.fill(0);
        return null;
      }
    }
  } catch {
    for (const chunk of parts) chunk.fill(0);
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of parts) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
    chunk.fill(0);
  }
  return bytes;
}

/**
 * The closed body, or the closed issue list `invalid-request-v1` carries. A
 * forbidden line is an invalid request like any other malformed field: it is
 * refused here, in memory, before the route writes, audits or logs anything,
 * and the refusal names the field, never the line.
 */
export async function readConfigureBody(request: Request): Promise<ConfigureParse> {
  const type = (request.headers.get("content-type") ?? "").trim().toLowerCase();
  if (!/^application\/json(\s*;\s*charset=utf-8)?$/.test(type) || request.headers.has("content-encoding")) {
    return { ok: false, issues: ["body"] };
  }
  const bytes = await readBounded(request, CONFIGURE_BODY_MAXIMUM_BYTES);
  if (!bytes) return { ok: false, issues: ["body"] };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    raw = undefined;
  } finally {
    bytes.fill(0);
  }
  const parsed = configureBody.safeParse(raw);
  raw = undefined;
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  if (!parsed.data.buildEvidence.every(isPermittedEvidenceLine)) {
    zeroizeEvidence(parsed.data);
    return { ok: false, issues: ["buildEvidence"] };
  }
  return { ok: true, body: parsed.data };
}

/**
 * The build, decided in memory by the product VCF parser's own header rule
 * (`buildFromHeader` through `buildFromHeaderLines`), or null when the lines
 * name no build, conflicting builds or one the rule cannot name. The lines are
 * zeroized before this returns, whatever the answer.
 */
export function deriveHeaderBuild(body: { buildEvidence: string[] }): "GRCh37" | "GRCh38" | null {
  try {
    const build = buildFromHeaderLines(body.buildEvidence);
    return build === "GRCh37" || build === "GRCh38" ? build : null;
  } finally {
    zeroizeEvidence(body);
  }
}

/** One CSPRNG 256-bit transport challenge, base64url: the 43-character shape the chunk header carries. */
export function newTransportChallenge(): string {
  return crypto.randomBytes(32).toString("base64url");
}

const uuid = z.uuid();
const positiveRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * What `public.configure_embryo_vcf_ingest_v1` returns: the configured
 * build and random revision; one terminal branch after the attempt was marked
 * failure-pending in the same transaction; or the failure-pending envelope
 * of an attempt that no longer authorizes anything.
 */
export const configureResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("configured"),
    build: z.enum(["GRCh37", "GRCh38"]),
    revision: positiveRevision,
  }).strict(),
  z.object({
    status: z.literal("terminal"),
    branch: z.enum(["build_unknown", "cohort_single_sample", "sample_count_mismatch"]),
    cohortId: uuid,
    ingestRevision: positiveRevision,
  }).strict(),
  z.object({ status: z.literal("failure_pending"), cohortId: uuid, ingestRevision: positiveRevision }).strict(),
]);
export type ConfigureResult = z.infer<typeof configureResult>;
export type TerminalBranch = Extract<ConfigureResult, { status: "terminal" }>["branch"];

/** `embryo-vcf-transport-v1` headers: `private-no-store-no-referrer`. */
export function withNoReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export interface VcfTransportConfigured extends Record<string, unknown> {
  build: "GRCh37" | "GRCh38";
  challenge: string;
  revision: number;
  completionNonce: string;
  csrfToken: string;
}
export const VCF_TRANSPORT_KEYS = ["build", "challenge", "revision", "completionNonce", "csrfToken"] as const;

/** `embryo-vcf-transport-v1.configured`: 200, exactly five keys, through the closed-shape serializer. */
export async function configuredResponse(value: VcfTransportConfigured): Promise<Response> {
  return withNoReferrer(await closedResponse("api.embryo-ingest-configure", VCF_TRANSPORT_KEYS, value, 200));
}

/**
 * `buildUnknown`, `cohortSingleSample` and `sampleCountMismatch`: 422 and a
 * constant body. `next.route` is the path of `embryos.request-data`, built
 * from the route register rather than spelled here.
 */
export function terminalResponse(branch: TerminalBranch): Response {
  const body = branch === "build_unknown"
    ? { error: branch, next: { labelCopyId: "upload.build.ask-laboratory", route: route("embryos.request-data") } }
    : { error: branch };
  return withNoReferrer(sensitiveJson(body, 422));
}
