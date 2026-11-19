import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { SENSITIVE_HEADERS, sensitiveJson } from "./api";
import type { ServerTransportBinding } from "./ingest-binding";
import type { IngestAuthorization, IngestAuthorizationArgs } from "./ingest-http";
import { EmbryoTransportError } from "./ingest-lines";
import type { RouteFailureCode } from "./ingest-failure";
import { validateEmbryoVcfChunk } from "./vcf-transport";
import { embryoTableFragments, validateEmbryoTableChunk, type TableServerBinding } from "./table-transport";
import type { PgtLocusKind } from "../genome/parsers/pgt-table";

/**
 * The in-memory half of `PUT /api/embryo-ingest/[session]/chunks/[sequence]`
 * (register `api.embryo-ingest-chunk`, `transportWireV1`, `serverWork`). It
 * binds a chunk to the challenge the configure route issued, validates the
 * whole chunk before anything is reserved or written, and measures what the
 * reservation must bind: the content hash, byte, record and line counts, and
 * each per-embryo fragment's own bytes, lines and hash.
 *
 * Nothing here authorizes a request, reserves, writes or fails an attempt.
 */

type Authorized = Extract<IngestAuthorization, { status: "authorized" }>;

/** The regenerated header's third line: `##inheritChallenge=<challenge>:<revision>`. */
const CHALLENGE_LINE = /^##inheritChallenge=([A-Za-z0-9_-]{43}):([1-9][0-9]{0,15})$/;

function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sameDigest(left: string, right: string): boolean {
  return left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/**
 * The server transport binding for this chunk, or null when its header does
 * not carry the one challenge and revision this session was issued. Only a
 * digest of the challenge is stored, so the chunk's own claim is hashed and
 * compared; the claim becomes the binding only once it matches. Sample
 * handles resolve through their stored digests, never a global map.
 */
export function chunkBinding(bytes: Uint8Array, authority: Authorized): ServerTransportBinding | null {
  if (authority.format !== "vcf" || authority.build === null || authority.challengeHash === null) return null;
  // The first three header lines are short; decoding a bounded prefix keeps
  // this check from holding a second copy of the whole chunk.
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512));
  const line = prefix.split("\n")[2] ?? "";
  const match = CHALLENGE_LINE.exec(line);
  if (!match || match[2] !== String(authority.transportRevision)) return null;
  if (!sameDigest(sha256Hex(match[1]), authority.challengeHash)) return null;
  const ordinals = new Map(authority.handles.map((handle) => [handle.hash, handle.ordinal]));
  return {
    challenge: match[1],
    revision: authority.transportRevision,
    build: authority.build,
    sampleCount: authority.sampleCount,
    resolveHandle: (handle) => ordinals.get(sha256Hex(handle)) ?? null,
  };
}

/**
 * The table counterpart of `chunkBinding` (ADR 0037): the same challenge,
 * revision and handle binding, plus the locus kind the mapping route
 * recorded and the server reference store for rsID loci. Null for anything
 * but a table session whose build is resolved and whose transport and locus
 * are issued, or when the header names another challenge or revision.
 */
export function tableChunkBinding(
  bytes: Uint8Array,
  authority: Authorized,
  locusKind: PgtLocusKind | null,
  resolveRsid: TableServerBinding["resolveRsid"],
): TableServerBinding | null {
  if (authority.format !== "pgt_table" || authority.build === null || authority.challengeHash === null || locusKind === null) return null;
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512));
  const lines = prefix.split("\n");
  if (lines[0] !== "##inheritTable=1") return null;
  const match = CHALLENGE_LINE.exec(lines[2] ?? "");
  if (!match || match[2] !== String(authority.transportRevision)) return null;
  if (!sameDigest(sha256Hex(match[1]), authority.challengeHash)) return null;
  const ordinals = new Map(authority.handles.map((handle) => [handle.hash, handle.ordinal]));
  return {
    challenge: match[1],
    revision: authority.transportRevision,
    build: authority.build,
    sampleCount: authority.sampleCount,
    locusKind,
    resolveRsid,
    resolveHandle: (handle) => ordinals.get(sha256Hex(handle)) ?? null,
  };
}

export interface ReservedFragment {
  ordinal: number;
  bytes: Uint8Array;
  sha256: string;
  lines: number;
}

export interface ValidatedChunk {
  sha256: string;
  byteCount: number;
  recordCount: number;
  maximumLineBytes: number;
  fragments: ReservedFragment[];
}

const encoder = new TextEncoder();

/**
 * The whole chunk, validated by `validateEmbryoVcfChunk` before any fragment
 * or row is handed to a writer, and measured for the reservation. Throws the
 * coded `EmbryoTransportError`; the message never carries source text.
 */
export function validateChunk(bytes: Uint8Array, binding: ServerTransportBinding): ValidatedChunk {
  const fragments = validateEmbryoVcfChunk(bytes, binding);
  const lines = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).slice(0, -1).split("\n");
  // Every line after the column line is a logical record, retained or not.
  const recordCount = lines.length - 1 - lines.findIndex((line) => line.startsWith("#CHROM\t"));
  let maximumLineBytes = 1;
  for (const line of lines) maximumLineBytes = Math.max(maximumLineBytes, encoder.encode(line).byteLength);
  lines.length = 0;
  return {
    sha256: sha256Hex(bytes),
    byteCount: bytes.byteLength,
    recordCount,
    maximumLineBytes,
    fragments: fragments.map((fragment) => {
      const encoded = encoder.encode(fragment.vcf);
      return {
        ordinal: fragment.ordinal,
        bytes: encoded,
        sha256: sha256Hex(encoded),
        lines: fragment.vcf.split("\n").length - 1,
      };
    }),
  };
}

/**
 * The whole table chunk, validated by `validateEmbryoTableChunk` before any
 * fragment is handed to a writer, split into one neutral fragment per
 * embryo with a retained row, and measured for the reservation. Every line
 * after the column line is a logical record, retained or not.
 */
export function validateTableChunk(bytes: Uint8Array, binding: TableServerBinding): ValidatedChunk {
  const records = validateEmbryoTableChunk(bytes, binding);
  const lines = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).slice(0, -1).split("\n");
  const recordCount = lines.length - 4;
  let maximumLineBytes = 1;
  for (const line of lines) maximumLineBytes = Math.max(maximumLineBytes, encoder.encode(line).byteLength);
  lines.length = 0;
  return {
    sha256: sha256Hex(bytes),
    byteCount: bytes.byteLength,
    recordCount,
    maximumLineBytes,
    fragments: embryoTableFragments(records, binding.build).map((fragment) => {
      const encoded = encoder.encode(fragment.table);
      return { ordinal: fragment.ordinal, bytes: encoded, sha256: sha256Hex(encoded), lines: fragment.table.split("\n").length - 1 };
    }),
  };
}

/** `reserve_embryo_ingest_chunk_v1`'s closed fragment shape: ordinal, bytes, lines and digest, nothing else. */
export function reservationFragments(chunk: ValidatedChunk): { ordinal: number; bytes: number; lines: number; sha256: string }[] {
  return chunk.fragments.map((fragment) => ({
    ordinal: fragment.ordinal, bytes: fragment.bytes.byteLength, lines: fragment.lines, sha256: fragment.sha256,
  }));
}

/** Zero every buffer the route held. JavaScript strings cannot be overwritten; byte buffers can. */
export function zeroizeChunk(bytes: Uint8Array | null, chunk: ValidatedChunk | null): void {
  bytes?.fill(0);
  for (const fragment of chunk?.fragments ?? []) fragment.bytes.fill(0);
}

/** The closed issue vocabulary of `embryo-ingest-chunk-v1.invalidChunk`. */
export type ChunkIssue = "framing" | "header" | "format" | "records";

/** One terminal branch: the failure code recorded for the unwind and the registered answer. */
export interface ChunkRejection {
  code: RouteFailureCode;
  response: () => Response;
}

function invalidChunk(issue: ChunkIssue): () => Response {
  return () => noReferrer(sensitiveJson({ error: "invalid_genetic_chunk", issues: [issue] }, 422));
}

export const tooLarge = (): Response => noReferrer(sensitiveJson({ error: "too_large" }, 413));

/**
 * Every transport error mapped to its registered answer and failure code.
 * `build_unknown` cannot arise server-side for a configured VCF session; it
 * is a header failure if it ever does.
 */
export function chunkRejection(error: unknown, aborted = false): ChunkRejection {
  if (aborted) return { code: "abort", response: invalidChunk("framing") };
  const code = error instanceof EmbryoTransportError ? error.code : "invalid_chunk";
  switch (code) {
    case "too_large": return { code: "limit", response: tooLarge };
    case "pdf_not_data": return { code: "format", response: () => noReferrer(sensitiveJson({ error: "pdf_not_data" }, 415)) };
    case "unrecognised_format": return { code: "format", response: invalidChunk("format") };
    case "empty_after_parse": return { code: "format", response: invalidChunk("records") };
    case "invalid_session":
    case "build_unknown": return { code: "header", response: invalidChunk("header") };
    default: return { code: "chunk", response: invalidChunk("framing") };
  }
}

/** A PDF answers the registered 415 before any header binding is attempted. */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

/** A header that names no issued challenge, revision or handle. */
export const headerRejection: ChunkRejection = { code: "header", response: invalidChunk("header") };

/**
 * `embryo-ingest-chunk-v1.mappingRequired`: 409 and a constant body. A table
 * chunk sent before the mapping route resolved the build and issued the
 * transport writes nothing and is nonterminal: the live session and its
 * fixed due target are untouched.
 */
export function mappingRequired(): Response {
  return noReferrer(sensitiveJson({ error: "mapping_required" }, 409));
}

type LocusRpc = (args: {
  p_account_id: string; p_auth_session_id: string; p_ingest_session_id: string;
  p_cookie_hash: string; p_origin: string; p_test_jurisdiction: true;
}) => PromiseLike<{ data: unknown; error: unknown }>;

/**
 * The locus kind the mapping route recorded for this table session, read
 * through the credential-filtered `embryo_ingest_table_locus_v1`; null until
 * the transport is issued. Throws when the read fails or answers outside
 * the closed vocabulary, so the caller answers the retryable 503.
 */
export async function tableLocus(credentials: IngestAuthorizationArgs, rpc: LocusRpc): Promise<PgtLocusKind | null> {
  const { data, error } = await rpc({
    p_account_id: credentials.p_account_id, p_auth_session_id: credentials.p_auth_session_id,
    p_ingest_session_id: credentials.p_ingest_session_id, p_cookie_hash: credentials.p_cookie_hash,
    p_origin: credentials.p_origin, p_test_jurisdiction: credentials.p_test_jurisdiction,
  });
  if (error) throw new Error("table locus unavailable");
  if (data === null) return null;
  if (data === "rsid" || data === "chrom-pos") return data;
  throw new Error("table locus unavailable");
}

/** `embryo-ingest-chunk-v1.success`: 204, empty. */
export function chunkStored(): Response {
  return noReferrer(new Response(null, { status: 204, headers: SENSITIVE_HEADERS }));
}

export function noReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** What the reservation and commit doors answer. */
export const chunkReceipt = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["reserved", "stored"]),
    objects: z.array(z.object({ ordinal: z.number().int().min(0).max(63), objectId: z.uuid() }).strict()).max(64),
  }).strict(),
  z.object({ status: z.literal("failure_pending") }).strict(),
  z.object({ status: z.literal("denied") }).strict(),
]);

export const chunkCommit = z.discriminatedUnion("status", [
  z.object({ status: z.literal("stored") }).strict(),
  z.object({ status: z.literal("failure_pending") }).strict(),
  z.object({ status: z.literal("denied") }).strict(),
]);
