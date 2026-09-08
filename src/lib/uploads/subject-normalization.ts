import "server-only";
import { hasEmptyRequestBody } from "../empty-request-body";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { z } from "zod";
import register from "../../../docs/route-register.json";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { buildLiftover, liftSingleBaseVariant } from "../genome/liftover";
import { countInputLines, emptyReadCounts, INPUT_PROVENANCE_VERSION } from "../genome/input-provenance";
import { parseArray, type ArrayKind } from "../genome/parsers/array";
import { buildFromHeader, parseVcf } from "../genome/parsers/vcf";
import type { Build, VariantRecord } from "../genome/types";
import { createAdminClient } from "../supabase/admin";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";
import { subjectNormalizationReceipt } from "./subject-upload-contract";
import { normalizationDatabaseCompletion } from "./normalization-database";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const positive = z.number().int().positive().safe();
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const manifestSchema = z.object({ status: z.literal("authorized"), fileId: uuid, claim: uuid, subjectId: uuid,
  bucket: z.literal("genomes"), objectKey: uuid, objectId: uuid, sizeBytes: positive,
  rawSha256: sha, decodedSha256: sha, sourceRevision: positive, maximumDecodedBytes: positive,
  fileType: z.enum(["array_23andme", "array_ancestry", "array_myheritage", "array_ftdna", "vcf", "gvcf"]),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
const cleanupSchema = z.object({ status: z.literal("build_cleanup_required"), fileId: uuid, claim: uuid,
  bucket: z.literal("genomes"), objectKey: uuid, objectId: uuid }).strict();
type Operation = "begin" | "check" | "stage" | "complete" | "fail" | "reject-build" | "check-rejected" | "finish-rejected";
type Rpc = (name: "own_upload_normalization_v1", args: { p_operation: Operation; p_account_id: string;
  p_session_id: string; p_file_id: string; p_claim: string | null; p_payload: unknown | null }) =>
  PromiseLike<{ data: unknown; error: { code?: string } | null }>;
type Failure = "unavailable" | "upload_integrity_mismatch" | "too_large" | "unrecognised_format" |
  "build_unknown" | "empty_after_parse" | "liftover_loss";
class NormalizationError extends Error { constructor(readonly code: Failure) { super(code); } }
function refuse(code: Failure = "unavailable"): never { throw new NormalizationError(code); }

/** A source is checked in bounded ranges on both passes. The first establishes
 * its build and byte identity without creating or interpreting genotypes. */
export async function normalizeSubjectFile(
  request: Request, fileId: string, completionDeadline = performance.now() + 270_000,
) {
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin") return ownUploadJson({ error: "forbidden" }, 403);
  if (new URL(request.url).search || !uuid.safeParse(fileId).success || !(await hasEmptyRequestBody(request))) {
    return ownUploadJson({ error: "invalid_request" }, 422);
  }
  let actor: Awaited<ReturnType<typeof currentOwnUploadAccount>>, rpc: Rpc, admin: ReturnType<typeof createAdminClient>;
  let directComplete: ReturnType<typeof normalizationDatabaseCompletion>;
  try { actor = await currentOwnUploadAccount(); admin = createAdminClient();
    directComplete = normalizationDatabaseCompletion();
    // Narrow adapter until generated types include this migration. It exposes
    // exactly one service-only RPC, not an untyped database client.
    rpc = admin.rpc.bind(admin) as unknown as Rpc;
  } catch { return ownUploadJson({ error: "unavailable" }, 503); }
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  let manifest: Manifest | undefined;
  const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: fileId };
  const call = (operation: Operation, payload: unknown = null) => {
    if (operation === "complete" && directComplete) {
      if (!manifest) refuse();
      return directComplete({ ...args, p_claim: manifest.claim }, payload, completionDeadline);
    }
    return rpc("own_upload_normalization_v1", {
      ...args, p_operation: operation, p_claim: manifest?.claim ?? null, p_payload: payload });
  };
  async function cleanupBuild(raw: unknown) {
    const parsed = cleanupSchema.safeParse(raw);
    if (!parsed.success || parsed.data.fileId !== fileId) refuse();
    const target = parsed.data;
    const cleanupCall = (operation: Operation) => rpc("own_upload_normalization_v1", {
      ...args, p_operation: operation, p_claim: target.claim, p_payload: null });
    const checked = await cleanupCall("check-rejected");
    const same = cleanupSchema.safeParse(checked.data);
    if (checked.error || !same.success || JSON.stringify(same.data) !== JSON.stringify(target)) refuse();
    const removed = await admin.storage.from("genomes").remove([target.objectKey]);
    if (removed.error) refuse();
    const finished = await cleanupCall("finish-rejected");
    if (finished.error || finished.data !== true) refuse();
    return ownUploadJson({ error: "build_unknown", next: { labelCopyId: "upload.build.ask-source", routeId: "files.upload" } }, 422);
  }
  try {
    const began = await call("begin");
    if (began.error) return ownUploadJson({ error: began.error.code === "42501" ? "not_found" : "unavailable" },
      began.error.code === "42501" ? 404 : 503);
    if (cleanupSchema.safeParse(began.data).success) return await cleanupBuild(began.data);
    const prior = subjectNormalizationReceipt.safeParse(began.data);
    if (prior.success && prior.data.fileId === fileId) return ownUploadJson(prior.data);
    const parsedManifest = manifestSchema.safeParse(began.data);
    if (!parsedManifest.success || parsedManifest.data.fileId !== fileId) refuse();
    manifest = parsedManifest.data;
    const source = manifest;
    async function recheck() {
      const response = await call("check");
      const checked = manifestSchema.safeParse(response.data);
      if (response.error || !checked.success || JSON.stringify(checked.data) !== JSON.stringify(source)) refuse();
    }
    async function* ranges() {
      for (let start = 0; start < source.sizeBytes; start += INGEST_CHUNK_MAXIMUM_BYTES) {
        await recheck();
        const end = Math.min(source.sizeBytes, start + INGEST_CHUNK_MAXIMUM_BYTES) - 1;
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/genomes/${source.objectKey}`, {
          headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `bytes=${start}-${end}` },
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
        });
        if (response.status !== 206 || !response.body
          || response.headers.get("content-range") !== `bytes ${start}-${end}/${source.sizeBytes}`) {
          await response.body?.cancel(); refuse();
        }
        let size = 0;
        for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
          size += bytes.length; if (size > end - start + 1) refuse("upload_integrity_mismatch");
          yield bytes;
        }
        if (size !== end - start + 1) refuse("upload_integrity_mismatch");
      }
    }
    const isVcf = source.fileType === "vcf" || source.fileType === "gvcf";
    const claims = new Set<Build>();
    for await (const line of verifiedLines(ranges(), source)) {
      if (!line.startsWith("#")) continue;
      if (isVcf) { const build = buildFromHeader(line); if (build) claims.add(build); }
      else for (const match of line.matchAll(/(build\s*|GRCh|hg)(\d+)/gi)) {
        const number = match[1].toLowerCase() === "hg" && match[2] === "19" ? "37" : match[2];
        claims.add(number === "38" ? "GRCh38" : number === "37" ? "GRCh37" : "unknown");
      }
    }
    const build: Build = claims.size === 0 && !isVcf ? "GRCh37" : claims.size === 1 ? [...claims][0] : "unknown";
    if (build === "unknown") {
      const rejected = await call("reject-build"); if (rejected.error) refuse();
      return await cleanupBuild(rejected.data);
    }
    await recheck();
    const counts = emptyReadCounts();
    const lines = countInputLines(verifiedLines(ranges(), source), source.fileType, counts);
    const parsed = isVcf ? await parseVcf(lines) : await parseArray(lines, source.fileType as ArrayKind);
    if (parsed.build !== build) refuse("upload_integrity_mismatch");
    // Deduplicate literal positions; conflicting duplicate calls are not silently
    // turned into one genotype. Keep observed no-call evidence separate.
    const positions = new Map<string, VariantRecord>();
    for (const record of parsed.records) {
      const key = `${record.chrom}:${record.pos}`;
      const prior = positions.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(record)) refuse("unrecognised_format");
      positions.set(key, record);
    }
    let records = [...positions.values()];
    let observed = (parsed.observedCalls ?? []).map(source => ({ source, normalized: { ...source } as VariantRecord }));
    if (!records.length && !observed.some(row => row.source.usable)) refuse("empty_after_parse");
    let unmapped = 0, attempted = 0, chainSha256: string | null = null;
    if (build === "GRCh37") {
      const chain = await readFile(path.join(process.cwd(), "data/ref/chain/GRCh37_to_GRCh38.chain.gz"));
      chainSha256 = createHash("sha256").update(chain).digest("hex");
      const lift = buildLiftover(chain);
      const autosomalPositions = new Map<string, VariantRecord>();
      for (const row of [...records, ...observed.map(row => row.normalized)]) {
        if (row.chrom >= 1 && row.chrom <= 22) autosomalPositions.set(`${row.chrom}:${row.pos}`, row);
      }
      attempted = autosomalPositions.size;
      for (const row of autosomalPositions.values()) if (!lift(row.chrom, row.pos)) unmapped++;
      if (attempted && unmapped / attempted > register.policyContracts["genome-liftover-v1"].maximumUnmappedFraction) refuse("liftover_loss");
      records = records.flatMap(record => { const mapped = liftSingleBaseVariant(record, lift); return mapped ? [mapped] : []; });
      observed = observed.flatMap(({ source }) => {
        const normalized = liftSingleBaseVariant({ ...source,
          genotype: source.genotype === "--" ? `${source.ref}/${source.ref}` : source.genotype }, lift);
        if (!normalized) return []; if (source.genotype === "--") normalized.genotype = "--";
        return [{ source, normalized }];
      });
      if (!records.length && !observed.some(row => row.source.usable)) refuse("empty_after_parse");
    }
    async function stage(kind: "variants" | "observed", rows: unknown[]) {
      for (let i = 0; i < rows.length; i += 1000) {
        const response = await call("stage", { kind, sequence: i / 1000, rows: rows.slice(i, i + 1000) });
        if (response.error || response.data !== true) refuse();
      }
    }
    await stage("variants", records);
    await stage("observed", observed.map(({ source, normalized }) => ({
      source_line: source.line, source_chrom: source.chrom, source_pos: source.pos,
      source_ref: source.ref, source_alt: source.alt, source_gt: source.sourceGt,
      rsid: source.rsid, chrom: normalized.chrom, pos: normalized.pos, ref: normalized.ref, alt: normalized.alt,
      genotype: normalized.genotype, site_filter: source.filter, sample_filter: source.sampleFilter,
      genotype_quality: source.genotypeQuality, read_depth: source.depth, quality_state: source.quality, usable: source.usable,
    })));
    const completed = await call("complete", { sourceBuild: build, rawSha256: source.rawSha256,
      decodedSha256: source.decodedSha256, variantCount: records.length, observedCallCount: observed.length,
      provenance: { version: INPUT_PROVENANCE_VERSION, sourceSha256: source.rawSha256, sourceBuild: build,
        buildBasis: counts.buildClaim ? "source-declared" : "format-assumption", targetBuild: "GRCh38",
        chainSha256, variantRowsMapped: records.length, variantRowsUnmapped: unmapped, attempted, counts },
    });
    const receipt = subjectNormalizationReceipt.safeParse(completed.data);
    if (completed.error || !receipt.success || receipt.data.fileId !== fileId) refuse();
    return ownUploadJson(receipt.data);
  } catch (error) {
    // An uncertain complete response must not delete committed canonical rows.
    // The database fail case accepts only the still-running exact claim.
    if (manifest) { try { await call("fail"); } catch { /* source remains retryable; no genetic error text */ } }
    const code = error instanceof NormalizationError ? error.code : "unavailable";
    if (code === "build_unknown") return ownUploadJson({ error: code,
      next: { labelCopyId: "upload.build.ask-source", routeId: "files.upload" } }, 422);
    return ownUploadJson({ error: code }, code === "unavailable" ? 503 : code === "too_large" ? 413 : code === "unrecognised_format" ? 415 : 422);
  }
}

async function* verifiedLines(source: AsyncIterable<Uint8Array>, manifest: Manifest): AsyncGenerator<string> {
  const iterator = source[Symbol.asyncIterator]();
  const initial: Uint8Array[] = [];
  let initialSize = 0;
  while (initialSize < 2) { const item = await iterator.next(); if (item.done) break;
    initial.push(item.value); initialSize += item.value.length; }
  const first = Buffer.concat(initial);
  if (!first.length) refuse("upload_integrity_mismatch");
  const rawHash = createHash("sha256"), decodedHash = createHash("sha256");
  let rawBytes = 0, decodedBytes = 0;
  async function* raw() {
    let value: Uint8Array | undefined = first;
    while (value) { rawBytes += value.length; if (rawBytes > manifest.sizeBytes) refuse("upload_integrity_mismatch");
      rawHash.update(value); yield value; const next = await iterator.next(); value = next.done ? undefined : next.value; }
  }
  const input = Readable.from(raw());
  const gunzip = first[0] === 0x1f && first[1] === 0x8b ? createGunzip() : null;
  const transferred = gunzip ? pipeline(input, gunzip) : null;
  transferred?.catch(() => {});
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let carry = "";
  try {
    for await (const chunk of gunzip ?? input) {
      decodedBytes += chunk.length; if (decodedBytes > manifest.maximumDecodedBytes) refuse("too_large");
      decodedHash.update(chunk); carry += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = carry.indexOf("\n")) >= 0) {
        if (Buffer.byteLength(carry.slice(0, end)) > INGEST_CHUNK_MAXIMUM_BYTES) refuse("too_large");
        yield carry.slice(0, end).replace(/\r$/, ""); carry = carry.slice(end + 1);
      }
      if (Buffer.byteLength(carry) > INGEST_CHUNK_MAXIMUM_BYTES) refuse("too_large");
    }
    carry += decoder.decode(); if (carry) yield carry.replace(/\r$/, "");
    if (transferred) await transferred;
    if (rawBytes !== manifest.sizeBytes || rawHash.digest("hex") !== manifest.rawSha256
      || decodedHash.digest("hex") !== manifest.decodedSha256) refuse("upload_integrity_mismatch");
  } finally {
    input.destroy(); gunzip?.destroy(); await iterator.return?.();
  }
}
