import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalBindingSchema, type CanonicalBinding } from "./canonical-schema";
import { canonicalRsidPointerSchema, compareCanonicalRsidPointers, encodeCanonicalRsidBlock,
  type CanonicalRsidPointer, type CanonicalRsidMergeSummary, type createCanonicalRsidRuns } from "./canonical-rsid-index";
import { createCanonicalRsidContainerPacker, type CanonicalRsidContainerDescriptor } from "./canonical-rsid-containers";
import { preparedArtifactReceiptSchema, type PreparedArtifactDescriptor, type PreparedStoredArtifact } from "./storage-writer";

const integer = z.number().int().nonnegative().safe();
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const MAX_ARTIFACTS = 4096;
export const CANONICAL_RSID_DIRECTORY_MAX_BYTES = 1_048_576;
export const CANONICAL_RSID_MATERIALIZATION_MAX_BYTES = 4_000_000;
type Scan = Awaited<ReturnType<typeof createCanonicalRsidRuns>>;
const scanSchema = z.object({ version: z.literal("canonical-rsid-scan-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, canonicalBlockCount: integer.positive(), canonicalRecordCount: integer.positive(),
  pointerCount: integer, runCount: integer, indexBlockCount: integer }).strict().refine(s =>
  s.canonicalBlockCount <= s.canonicalRecordCount && s.canonicalRecordCount <= s.canonicalBlockCount * 2000
  && s.pointerCount <= s.canonicalRecordCount && (s.pointerCount === 0 ? s.runCount === 0 && s.indexBlockCount === 0
    : s.runCount >= 1 && s.runCount <= s.indexBlockCount && s.indexBlockCount <= s.pointerCount
      && s.pointerCount <= s.runCount * 32_000 && s.pointerCount <= s.indexBlockCount * 2000));
const mergeSchema = z.object({ type: z.literal("rsid-merge-summary"), version: z.literal("canonical-rsid-merge-v1"),
  state: z.literal("provisional"), binding: canonicalBindingSchema, inputRunSequences: z.array(integer).min(1).max(8),
  inputBlockCount: integer.positive(), pointerCount: integer.positive() }).strict().refine(m =>
  m.inputRunSequences.every((n, i, all) => i === 0 || n > all[i - 1])
  && m.inputBlockCount >= m.inputRunSequences.length && m.inputBlockCount <= m.pointerCount && m.pointerCount <= m.inputBlockCount * 2000);
export type CanonicalRsidContainerDirectory = { version: "canonical-rsid-container-directory-v1"; state: "provisional";
  binding: CanonicalBinding; sequence: number; containers: { artifact: PreparedStoredArtifact; descriptor: CanonicalRsidContainerDescriptor }[] };
export type CanonicalRsidDirectoryReference = { artifact: PreparedStoredArtifact; sequence: number;
  firstBlockSequence: number; lastBlockSequence: number; containerCount: number; blockCount: number; pointerCount: number;
  first: CanonicalRsidPointer; last: CanonicalRsidPointer };
export type CanonicalRsidMaterializationReceipt = { version: "canonical-rsid-materialization-v1"; state: "provisional";
  binding: CanonicalBinding; jobId: string; attemptId: string; scanSummary: Scan; mergeSummary: CanonicalRsidMergeSummary | null;
  canonicalBlockCount: number; canonicalRecordCount: number; pointerCount: number; blockCount: number; containerCount: number;
  byteCount: number; first: CanonicalRsidPointer | null; last: CanonicalRsidPointer | null; directories: CanonicalRsidDirectoryReference[];
  firstArtifactSequence: number; nextArtifactSequence: number; artifactCount: number };
export class CanonicalRsidMaterializationError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_summary" | "out_of_order" | "ack_mismatch" | "too_large" | "aborted") {
    super(code); this.name = "CanonicalRsidMaterializationError";
  }
}
function fail(code: CanonicalRsidMaterializationError["code"]): never { throw new CanonicalRsidMaterializationError(code); }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Persist final rsID pointers as immutable containers and <=1MiB directory
 * pages. The <=4MB provisional root contains only directory bounds/receipts.
 * The original scan and final merge terminal are distinct; both counts and
 * actual EOF must agree. No canonical/parser terminal is manufactured here.
 *
 * Caller supplies a verified original scan over the exact canonical dataset.
 * Pointer range checks cannot independently prove record membership: publication
 * must bind that scan/provenance, canonical materialization and current authority.
 * Actual byte durability requires createPreparedArtifactWriter or equivalent
 * exact create-only transport for the same live job/attempt. ACK validation is
 * not itself independent provider proof. Every reserved artifact remains caller
 * owned for cleanup on failure, even an uncertain or aborted sink write.
 *
 * Memory: <=2000 pointers, bounded rsID codec/container buffers, one <=1MiB
 * directory and <=4MB root metadata. Artifact IDs/keys are bounded by the job's
 * 4096 artifact cap. All reads/writes are serial and honor backpressure.
 */
export async function materializeCanonicalRsidMerge(stream: AsyncIterable<CanonicalRsidPointer | CanonicalRsidMergeSummary>, options: {
  binding: CanonicalBinding; expectedScan: Scan; canonicalBlockCount: number; canonicalRecordCount: number;
  jobId: string; attemptId: string; firstArtifactSequence?: number; signal?: AbortSignal;
  writeArtifact: (input: { descriptor: PreparedArtifactDescriptor; bytes: Uint8Array }, signal?: AbortSignal) => Promise<PreparedStoredArtifact>;
}): Promise<CanonicalRsidMaterializationReceipt> {
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const active = () => { if (signal.aborted) fail("aborted"); }; active();
  const binding = canonicalBindingSchema.parse(options.binding), scanSummary = scanSchema.parse(options.expectedScan);
  const canonicalBlockCount = integer.positive().parse(options.canonicalBlockCount), canonicalRecordCount = integer.positive().parse(options.canonicalRecordCount);
  if (!isDeepStrictEqual(binding, scanSummary.binding) || canonicalBlockCount !== scanSummary.canonicalBlockCount
    || canonicalRecordCount !== scanSummary.canonicalRecordCount) fail("invalid_summary");
  const jobId = uuid.parse(options.jobId), attemptId = uuid.parse(options.attemptId);
  const firstArtifactSequence = integer.max(MAX_ARTIFACTS - 1).parse(options.firstArtifactSequence ?? 0);
  let artifactSequence = firstArtifactSequence, receiptBytes = Buffer.byteLength(JSON.stringify({ binding, scanSummary })) + 4096;
  const identities = new Set<string>(), directories: CanonicalRsidDirectoryReference[] = [];
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new CanonicalRsidMaterializationError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", abort); }
  }
  async function write(bytes: Uint8Array): Promise<PreparedStoredArtifact> {
    active(); if (artifactSequence >= MAX_ARTIFACTS) fail("too_large");
    const descriptor: PreparedArtifactDescriptor = { kind: "container", sequence: artifactSequence, byteCount: bytes.byteLength, sha256: sha(bytes) };
    const response = await wait(options.writeArtifact({ descriptor: { ...descriptor }, bytes }, signal));
    const parsed = z.object({ receipt: preparedArtifactReceiptSchema, storageObjectId: uuid }).strict().safeParse(response);
    if (!parsed.success) fail("ack_mismatch"); const stored = parsed.data, receipt = stored.receipt;
    if (receipt.jobId !== jobId || receipt.attemptId !== attemptId || receipt.sequence !== artifactSequence
      || receipt.byteCount !== descriptor.byteCount || receipt.sha256 !== descriptor.sha256 || sha(bytes) !== descriptor.sha256) fail("ack_mismatch");
    for (const identity of [`artifact:${receipt.artifactId}`, `object:${stored.storageObjectId}`, `key:${receipt.objectKey}`]) {
      if (identities.has(identity)) fail("ack_mismatch"); identities.add(identity);
    }
    artifactSequence++; return stored;
  }
  let directory: CanonicalRsidContainerDirectory["containers"] = [], directoryBytes = 0;
  function directoryEnvelope(): CanonicalRsidContainerDirectory {
    return { version: "canonical-rsid-container-directory-v1", state: "provisional", binding, sequence: directories.length, containers: directory };
  }
  async function flushDirectory() {
    if (!directory.length) return;
    const bytes = Buffer.from(JSON.stringify(directoryEnvelope())); if (bytes.length > CANONICAL_RSID_DIRECTORY_MAX_BYTES) fail("too_large");
    const artifact = await write(bytes), first = directory[0].descriptor.blocks[0].descriptor,
      last = directory.at(-1)!.descriptor.blocks.at(-1)!.descriptor;
    const reference: CanonicalRsidDirectoryReference = { artifact, sequence: directories.length,
      firstBlockSequence: first.sequence, lastBlockSequence: last.sequence, first: { ...first.first }, last: { ...last.last },
      containerCount: directory.length, blockCount: directory.reduce((n, c) => n + c.descriptor.blocks.length, 0),
      pointerCount: directory.reduce((n, c) => n + c.descriptor.blocks.reduce((sum, block) => sum + block.descriptor.pointerCount, 0), 0) };
    receiptBytes += Buffer.byteLength(JSON.stringify(reference)) + 1;
    if (receiptBytes > CANONICAL_RSID_MATERIALIZATION_MAX_BYTES) fail("too_large");
    directories.push(reference); directory = []; directoryBytes = 0;
  }
  const packer = createCanonicalRsidContainerPacker({ binding, signal, sink: async container => {
    const stored = { artifact: await write(container.bytes), descriptor: container.descriptor }, size = Buffer.byteLength(JSON.stringify(stored)) + 1;
    if (directory.length && (directory.length >= 128 || directoryBytes + size + 4096 > CANONICAL_RSID_DIRECTORY_MAX_BYTES)) await flushDirectory();
    if (size + 4096 > CANONICAL_RSID_DIRECTORY_MAX_BYTES) fail("too_large");
    directory.push(stored); directoryBytes += size; return container.descriptor;
  } });
  let buffer: CanonicalRsidPointer[] = [], pointerCount = 0, blockCount = 0;
  let first: CanonicalRsidPointer | null = null, previous: CanonicalRsidPointer | null = null, terminal: CanonicalRsidMergeSummary | null = null;
  async function flushPointers() {
    if (!buffer.length) return;
    const encoded = await wait(encodeCanonicalRsidBlock({ binding, sequence: blockCount, pointers: buffer }, { signal }));
    await packer.append(encoded); blockCount++; buffer = [];
  }
  const iterator = stream[Symbol.asyncIterator](); let exhausted = false;
  try {
    for (;;) {
      active(); const next = await wait(iterator.next()); if (next.done) { exhausted = true; break; }
      if (terminal || scanSummary.pointerCount === 0) fail("invalid_summary");
      const raw = next.value;
      if (raw && typeof raw === "object" && "type" in raw && raw.type === "rsid-merge-summary") {
        if (!Array.isArray(raw.inputRunSequences) || raw.inputRunSequences.length > 8) fail("invalid_summary");
        const parsed = mergeSchema.safeParse(raw);
        if (!parsed.success || !isDeepStrictEqual(parsed.data.binding, binding) || parsed.data.pointerCount !== pointerCount
          || parsed.data.pointerCount !== scanSummary.pointerCount) fail("invalid_summary");
        terminal = parsed.data; continue;
      }
      const parsed = canonicalRsidPointerSchema.safeParse(raw); if (!parsed.success) fail("invalid_input"); const pointer = parsed.data;
      if (pointer.blockSequence >= canonicalBlockCount) fail("invalid_input");
      if (previous && compareCanonicalRsidPointers(previous, pointer) >= 0) fail("out_of_order");
      pointerCount++; if (!Number.isSafeInteger(pointerCount) || pointerCount > scanSummary.pointerCount) fail("invalid_summary");
      first ??= { ...pointer }; previous = pointer; buffer.push(pointer); if (buffer.length === 2000) await flushPointers();
    }
    if (pointerCount !== scanSummary.pointerCount || (pointerCount > 0 && !terminal)) fail("invalid_summary");
    await flushPointers(); const containers = await packer.finish(); await flushDirectory(); active();
    if (containers.blockCount !== blockCount || directories.reduce((n, d) => n + d.pointerCount, 0) !== pointerCount
      || directories.reduce((n, d) => n + d.blockCount, 0) !== blockCount) fail("invalid_summary");
    const receipt: CanonicalRsidMaterializationReceipt = { version: "canonical-rsid-materialization-v1", state: "provisional", binding, jobId, attemptId,
      scanSummary, mergeSummary: terminal, canonicalBlockCount, canonicalRecordCount, pointerCount, blockCount,
      containerCount: containers.containerCount, byteCount: containers.byteCount, first, last: previous, directories,
      firstArtifactSequence, nextArtifactSequence: artifactSequence, artifactCount: artifactSequence - firstArtifactSequence };
    if (Buffer.byteLength(JSON.stringify(receipt)) > CANONICAL_RSID_MATERIALIZATION_MAX_BYTES) fail("too_large");
    return receipt;
  } finally {
    controller.abort();
    if (!exhausted && iterator.return) { try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* Preserve original failure. */ } }
  }
}
