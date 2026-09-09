import { preparedStoredArtifactSchema, preparedArtifactObjectIdentity } from "./artifact-identity";
import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { z } from "zod";
import { canonicalBindingSchema, canonicalSummarySchema, type CanonicalBinding } from "./canonical-schema";
import { validateCanonicalContainerDescriptor } from "./canonical-containers";
import { describeCanonicalCoordinateIndex, validateCanonicalCoordinateIndex, type CanonicalCoordinateIndex } from "./canonical-coordinate-index";
import { type PreparedStoredArtifact } from "./storage-writer";
import type { CanonicalContainerDirectory, CanonicalCoordinateReference, CanonicalDirectoryReference,
  CanonicalMaterializationReceipt } from "./materialize-canonical";

export type { CanonicalContainerDirectory, CanonicalCoordinateReference, CanonicalDirectoryReference, CanonicalMaterializationReceipt };
const ROOT_MAX_BYTES = 4_000_000, PAGE_MAX_BYTES = 1_048_576, MAX_ARTIFACTS = 4096;
const n = z.number().int().nonnegative().safe(), positive = n.positive();
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const storedSchema = preparedStoredArtifactSchema;
const coordinate = z.object({ chrom: positive.max(25), pos: positive }).strict();
const orderKey = z.tuple([n.max(1), n.max(25), n, positive.max(25), positive, positive, n.max(2)])
  .refine(k => k[0] === 0 ? k[1] > 0 && k[2] > 0 && k[6] !== 1 : k[1] === 0 && k[2] === 0);
const countsSchema = z.object({ sourceVariantCount: n, sourceObservedCount: n, sourceReferenceCount: n,
  normalizedVariantCount: n, normalizedObservedCount: n, usableObservedCount: n,
  duplicateCount: n, unmappedCount: n, unsupportedAlleleCount: n }).strict();
const mergeSchema = z.object({ type: z.literal("canonical-merge-summary"), version: z.literal("canonical-merge-summary-v1"),
  state: z.literal("provisional"), binding: canonicalBindingSchema, inputRunSequences: z.array(n).min(1).max(8),
  inputBlockCount: positive, recordCount: positive, counts: countsSchema }).strict();
const envelopeSchema = z.object({ sequence: n, firstBlockSequence: n, lastBlockSequence: n, blockCount: positive.max(128),
  recordCount: positive.max(128 * 2000), normalizedCount: n.max(128 * 2000),
  normalizedFirst: coordinate.nullable(), normalizedLast: coordinate.nullable(), firstKey: orderKey, lastKey: orderKey }).strict();
const directoryReferenceSchema = z.object({ artifact: storedSchema, sequence: n, firstBlockSequence: n,
  lastBlockSequence: n, containerCount: positive.max(128), blockCount: positive.max(128 * 128) }).strict();
const coordinateReferenceSchema = z.object({ artifact: storedSchema, envelope: envelopeSchema }).strict();
const summarySchema = z.object({ version: z.literal("canonical-coordinate-index-summary-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, pageCount: positive.max(MAX_ARTIFACTS), firstBlockSequence: n, lastBlockSequence: n.nullable(),
  blockCount: positive, recordCount: positive, normalizedCount: n, normalizedFirst: coordinate.nullable(),
  normalizedLast: coordinate.nullable(), firstKey: orderKey.nullable(), lastKey: orderKey.nullable() }).strict();
const rootSchema = z.object({ version: z.literal("canonical-materialization-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, jobId: uuid, attemptId: uuid, canonicalSummary: canonicalSummarySchema,
  mergeSummary: mergeSchema, counts: countsSchema, recordCount: positive, blockCount: positive, containerCount: positive,
  byteCount: positive, directories: z.array(directoryReferenceSchema).min(1).max(MAX_ARTIFACTS),
  coordinatePages: z.array(coordinateReferenceSchema).min(1).max(MAX_ARTIFACTS), coordinateSummary: summarySchema,
  firstArtifactSequence: n.max(MAX_ARTIFACTS - 1), nextArtifactSequence: positive.max(MAX_ARTIFACTS),
  artifactCount: positive.max(MAX_ARTIFACTS) }).strict();
export type CanonicalManifestContext = { binding: CanonicalBinding; jobId: string; attemptId: string;
  firstArtifactSequence: number; nextArtifactSequence: number; expectedFirstContainerSequence?: number;
  forbiddenArtifacts?: readonly PreparedStoredArtifact[] };
const contextSchema = z.object({ binding: canonicalBindingSchema, jobId: uuid, attemptId: uuid,
  firstArtifactSequence: n.max(MAX_ARTIFACTS - 1), nextArtifactSequence: positive.max(MAX_ARTIFACTS),
  expectedFirstContainerSequence: n.max(MAX_ARTIFACTS - 1).optional(),
  forbiddenArtifacts: z.array(storedSchema).max(MAX_ARTIFACTS).optional() }).strict()
  .refine(c => c.nextArtifactSequence > c.firstArtifactSequence);
export class CanonicalManifestError extends Error {
  constructor(readonly code: "invalid_manifest" | "integrity_mismatch" | "too_large") { super(code); this.name = "CanonicalManifestError"; }
}
function requireValid(condition: unknown): asserts condition { if (!condition) throw new CanonicalManifestError("integrity_mismatch"); }
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function compare(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function ownValue(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new CanonicalManifestError("invalid_manifest");
  return descriptor.value;
}

/** Bound the JSON tree BEFORE cloning or serialization. Strings in these
 * metadata schemas are <=128 characters; no genetic payload belongs here. */
function preflight(raw: unknown, maxBytes: number) {
  let bytes = 0, visits = 0;
  function add(count: number) { bytes += count; if (bytes > maxBytes) throw new CanonicalManifestError("too_large"); }
  function visit(value: unknown, depth: number): void {
    if (++visits > maxBytes || depth > 14) throw new CanonicalManifestError("too_large");
    if (value === null) { add(4); return; }
    if (typeof value === "string") {
      if (value.length > 128) throw new CanonicalManifestError("invalid_manifest");
      add(Buffer.byteLength(JSON.stringify(value))); return;
    }
    if (typeof value === "number" && Number.isFinite(value)) { add(String(value).length); return; }
    if (typeof value === "boolean") { add(value ? 4 : 5); return; }
    if (Array.isArray(value)) {
      if (value.length > MAX_ARTIFACTS) throw new CanonicalManifestError("too_large");
      add(2 + Math.max(0, value.length - 1));
      for (let i = 0; i < value.length; i++) visit(ownValue(value, i), depth + 1);
      return;
    }
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new CanonicalManifestError("invalid_manifest");
    // Provider metadata is JSON.parse output. Reject wide enumerable input
    // before own-key enumeration; JavaScript has no lazy enumeration of hidden
    // own keys. The latter check prevents hidden required-field getters from
    // escaping preflight and being invoked by the schema afterwards.
    let count = 0;
    for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key) && ++count > 32)
      throw new CanonicalManifestError("invalid_manifest");
    const keys = Reflect.ownKeys(value);
    if (keys.length > 32) throw new CanonicalManifestError("invalid_manifest");
    add(2); count = 0;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor))
        throw new CanonicalManifestError("invalid_manifest");
      if (count++) add(1); visit(key, depth + 1); add(1); visit(descriptor.value, depth + 1);
    }
  }
  visit(raw, 0);
}
function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw); if (!parsed.success) throw new CanonicalManifestError("invalid_manifest"); return parsed.data;
}
function identities() {
  const ids = new Set<string>();
  return (artifact: PreparedStoredArtifact) => {
    for (const key of [`sequence:${artifact.receipt.sequence}`, `artifact:${artifact.receipt.artifactId}`,
      `object:${preparedArtifactObjectIdentity(artifact)}`, `key:${artifact.receipt.objectKey}`]) {
      requireValid(!ids.has(key)); ids.add(key);
    }
  };
}
function artifactInContext(artifact: PreparedStoredArtifact, context: CanonicalManifestContext) {
  requireValid(artifact.receipt.jobId === context.jobId && artifact.receipt.attemptId === context.attemptId
    && artifact.receipt.sequence >= context.firstArtifactSequence && artifact.receipt.sequence < context.nextArtifactSequence);
}
function checkEnvelope(e: z.infer<typeof envelopeSchema>) {
  requireValid(e.lastBlockSequence === e.firstBlockSequence + e.blockCount - 1
    && e.recordCount >= e.blockCount && e.recordCount <= e.blockCount * 2000
    && e.normalizedCount <= e.recordCount && compare(e.firstKey, e.lastKey) <= 0);
  if (e.recordCount === 1) requireValid(equal(e.firstKey, e.lastKey));
  if (!e.normalizedCount) requireValid(e.normalizedFirst === null && e.normalizedLast === null && e.firstKey[0] === 1 && e.lastKey[0] === 1);
  else {
    requireValid(e.normalizedFirst && e.normalizedLast && e.firstKey[0] === 0
      && equal(e.normalizedFirst, { chrom: e.firstKey[1], pos: e.firstKey[2] })
      && compare([e.normalizedFirst.chrom, e.normalizedFirst.pos], [e.normalizedLast.chrom, e.normalizedLast.pos]) <= 0);
    if (e.normalizedCount === 1) requireValid(equal(e.normalizedFirst, e.normalizedLast));
    if (e.normalizedCount === e.recordCount) requireValid(e.lastKey[0] === 0
      && equal(e.normalizedLast, { chrom: e.lastKey[1], pos: e.lastKey[2] }));
    else requireValid(e.lastKey[0] === 1);
  }
}

/** Closed, bounded integrity validation of a PROVISIONAL root. The independently
 * authoritative immutable DB binding must select this exact receipt. This does
 * not publish it, grant permission, or prove an unread object's contents. */
export function validateCanonicalMaterializationReceipt(raw: unknown,
  expected: { binding: CanonicalBinding; jobId: string; attemptId: string }): CanonicalMaterializationReceipt {
  // Reject oversized top arrays before inspecting their members.
  for (const key of ["directories", "coordinatePages"]) {
    const list = ownValue(raw, key);
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ARTIFACTS) throw new CanonicalManifestError("invalid_manifest");
  }
  preflight(raw, ROOT_MAX_BYTES); preflight(expected, ROOT_MAX_BYTES);
  const root = parse(rootSchema, raw), binding = parse(canonicalBindingSchema, expected.binding);
  requireValid(equal(root.binding, binding) && root.jobId === parse(uuid, expected.jobId) && root.attemptId === parse(uuid, expected.attemptId));
  const context = parse(contextSchema, { binding, jobId: root.jobId, attemptId: root.attemptId,
    firstArtifactSequence: root.firstArtifactSequence, nextArtifactSequence: root.nextArtifactSequence });
  const { counts: c, canonicalSummary: s, mergeSummary: m, coordinateSummary: summary } = root;
  requireValid(equal(s.binding, binding) && equal(m.binding, binding) && equal(summary.binding, binding) && equal(m.counts, c)
    && root.recordCount === s.eventCount && root.recordCount === m.recordCount
    && root.recordCount === c.sourceVariantCount + c.sourceObservedCount + c.sourceReferenceCount
    && root.recordCount === c.normalizedVariantCount + c.normalizedObservedCount + c.sourceReferenceCount
      + c.duplicateCount + c.unmappedCount + c.unsupportedAlleleCount
    && s.variantCount === c.normalizedVariantCount && s.observedCallCount === c.normalizedObservedCount
    && s.usableObservedCount === c.usableObservedCount && c.usableObservedCount <= c.normalizedObservedCount
    && c.normalizedVariantCount + c.duplicateCount <= c.sourceVariantCount
    && c.normalizedObservedCount <= c.sourceObservedCount
    && s.mergeSummary.variantCount === c.sourceVariantCount && s.mergeSummary.observedCallCount === c.sourceObservedCount
    && s.mergeSummary.referenceCallCount === c.sourceReferenceCount
    && m.inputRunSequences.every((seq, i, all) => i === 0 || seq > all[i - 1])
    && m.inputBlockCount >= m.inputRunSequences.length && m.inputBlockCount <= m.recordCount);
  requireValid(root.artifactCount === root.nextArtifactSequence - root.firstArtifactSequence
    && root.artifactCount === root.containerCount + root.directories.length + root.coordinatePages.length
    && root.containerCount <= root.blockCount && root.blockCount <= root.recordCount && root.recordCount <= root.blockCount * 2000
    && root.byteCount >= root.containerCount && root.byteCount <= root.containerCount * 8_388_608);
  const addIdentity = identities();
  let nextBlock = 0, containerCount = 0;
  for (const [i, d] of root.directories.entries()) {
    artifactInContext(d.artifact, context); addIdentity(d.artifact);
    requireValid(d.artifact.receipt.byteCount <= PAGE_MAX_BYTES && d.sequence === i && d.firstBlockSequence === nextBlock
      && d.lastBlockSequence === d.firstBlockSequence + d.blockCount - 1
      && d.blockCount >= d.containerCount && d.blockCount <= d.containerCount * 128);
    nextBlock += d.blockCount; containerCount += d.containerCount;
  }
  requireValid(nextBlock === root.blockCount && containerCount === root.containerCount);
  nextBlock = 0; let records = 0, normalized = 0;
  let previous: z.infer<typeof envelopeSchema> | undefined;
  let firstNormalized: z.infer<typeof coordinate> | null = null, lastNormalized: z.infer<typeof coordinate> | null = null;
  for (const [i, page] of root.coordinatePages.entries()) {
    artifactInContext(page.artifact, context); addIdentity(page.artifact);
    const e = page.envelope; checkEnvelope(e);
    requireValid(page.artifact.receipt.byteCount <= PAGE_MAX_BYTES && e.sequence === i && e.firstBlockSequence === nextBlock);
    if (previous) requireValid(compare(previous.lastKey, e.firstKey) <= 0);
    firstNormalized ??= e.normalizedFirst; if (e.normalizedLast) lastNormalized = e.normalizedLast;
    previous = e; nextBlock += e.blockCount; records += e.recordCount; normalized += e.normalizedCount;
  }
  requireValid(nextBlock === root.blockCount && records === root.recordCount
    && normalized === c.normalizedVariantCount + c.normalizedObservedCount
    && summary.pageCount === root.coordinatePages.length && summary.firstBlockSequence === 0
    && summary.lastBlockSequence === root.blockCount - 1 && summary.blockCount === root.blockCount
    && summary.recordCount === records && summary.normalizedCount === normalized
    && equal(summary.normalizedFirst, firstNormalized) && equal(summary.normalizedLast, lastNormalized)
    && equal(summary.firstKey, root.coordinatePages[0].envelope.firstKey)
    && equal(summary.lastKey, root.coordinatePages.at(-1)!.envelope.lastKey));
  return root;
}

function decodeJson(bytes: Uint8Array, artifact: PreparedStoredArtifact, context: CanonicalManifestContext) {
  artifactInContext(artifact, context);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > PAGE_MAX_BYTES) throw new CanonicalManifestError("too_large");
  requireValid(bytes.byteLength === artifact.receipt.byteCount && hash(bytes) === artifact.receipt.sha256);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { throw new CanonicalManifestError("invalid_manifest"); }
  preflight(raw, PAGE_MAX_BYTES); return raw;
}

/** Decode one exact referenced directory. Every data artifact must belong to
 * this attempt/range and precede the directory write. Cross-directory identity
 * comparison and root-reference membership remain the assembling reader's job.
 * Point lookup cannot certify unseen members: publication must validate all
 * pages, data identities and byte totals. Supply the root's metadata artifacts
 * as forbiddenArtifacts and its preceding container count for selected reads. */
export function decodeCanonicalContainerDirectory(bytes: Uint8Array, expected: CanonicalDirectoryReference,
  rawContext: CanonicalManifestContext): CanonicalContainerDirectory {
  preflight(expected, PAGE_MAX_BYTES); preflight(rawContext, ROOT_MAX_BYTES);
  const reference = parse(directoryReferenceSchema, expected), context = parse(contextSchema, rawContext);
  const raw = decodeJson(bytes, reference.artifact, context);
  const containers = ownValue(raw, "containers");
  if (!Array.isArray(containers) || !containers.length || containers.length > 128) throw new CanonicalManifestError("invalid_manifest");
  const schema = z.object({ version: z.literal("canonical-container-directory-v1"), state: z.literal("provisional"),
    binding: canonicalBindingSchema, sequence: n, containers: z.array(z.object({ artifact: storedSchema, descriptor: z.unknown() }).strict()).min(1).max(128) }).strict();
  const parsed = parse(schema, raw);
  requireValid(equal(parsed.binding, context.binding) && parsed.sequence === reference.sequence && parsed.containers.length === reference.containerCount);
  const addIdentity = identities();
  for (const artifact of context.forbiddenArtifacts ?? []) {
    artifactInContext(artifact, context);
    if (!equal(artifact, reference.artifact)) addIdentity(artifact);
  }
  addIdentity(reference.artifact);
  let nextBlock = reference.firstBlockSequence, previousContainer: number | undefined, previousArtifact: number | undefined;
  const verified = parsed.containers.map(item => {
    artifactInContext(item.artifact, context); addIdentity(item.artifact);
    const descriptor = validateCanonicalContainerDescriptor(item.descriptor, context.binding);
    requireValid(item.artifact.receipt.sequence < reference.artifact.receipt.sequence
      && descriptor.byteCount === item.artifact.receipt.byteCount && descriptor.sha256 === item.artifact.receipt.sha256
      && descriptor.blocks[0].descriptor.sequence === nextBlock);
    if (previousContainer !== undefined) requireValid(descriptor.sequence === previousContainer + 1);
    else if (context.expectedFirstContainerSequence !== undefined) requireValid(descriptor.sequence === context.expectedFirstContainerSequence);
    else if (reference.sequence === 0) requireValid(descriptor.sequence === 0);
    if (previousArtifact !== undefined) requireValid(item.artifact.receipt.sequence > previousArtifact);
    previousArtifact = item.artifact.receipt.sequence; previousContainer = descriptor.sequence; nextBlock += descriptor.blocks.length;
    return { artifact: item.artifact, descriptor };
  });
  requireValid(nextBlock - reference.firstBlockSequence === reference.blockCount && nextBlock - 1 === reference.lastBlockSequence);
  return { ...parsed, containers: verified };
}

/** Verified metadata bounds select candidates only. Selected data bytes must
 * still pass the canonical codec and exact coordinate filtering before access. */
export function decodeCanonicalCoordinatePage(bytes: Uint8Array, expected: CanonicalCoordinateReference,
  rawContext: CanonicalManifestContext): CanonicalCoordinateIndex {
  preflight(expected, PAGE_MAX_BYTES); preflight(rawContext, ROOT_MAX_BYTES);
  const reference = parse(coordinateReferenceSchema, expected), context = parse(contextSchema, rawContext);
  checkEnvelope(reference.envelope);
  const page = validateCanonicalCoordinateIndex(decodeJson(bytes, reference.artifact, context), context.binding);
  requireValid(equal(describeCanonicalCoordinateIndex(page, context.binding), reference.envelope));
  return page;
}

/** Shared closed-JSON metadata bound for other prepared index manifests. */
export { preflight as assertPreparedMetadataBounds };
