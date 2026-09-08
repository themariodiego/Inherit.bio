import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { z } from "zod";
import { canonicalBindingSchema, type CanonicalBinding } from "./canonical-schema";
import { assertPreparedMetadataBounds } from "./canonical-manifest";
import { canonicalRsidPointerSchema, compareCanonicalRsidPointers, decodeCanonicalRsidBlock, type CanonicalRsidPointer } from "./canonical-rsid-index";
import { validateCanonicalRsidContainerDescriptor, verifyCanonicalRsidContainerBytes } from "./canonical-rsid-containers";
import type { CanonicalRsidMaterializationReceipt } from "./materialize-canonical-rsid";
import { preparedArtifactReceiptSchema, type PreparedStoredArtifact } from "./storage-writer";
import { readVerifiedPreparedArtifact } from "./verified-artifact-reader";

const n = z.number().int().nonnegative().safe(), uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const stored = z.object({ receipt: preparedArtifactReceiptSchema, storageObjectId: uuid }).strict();
const scan = z.object({ version: z.literal("canonical-rsid-scan-v1"), state: z.literal("provisional"), binding: canonicalBindingSchema,
  canonicalBlockCount: n.positive(), canonicalRecordCount: n.positive(), pointerCount: n, runCount: n, indexBlockCount: n }).strict();
const merge = z.object({ type: z.literal("rsid-merge-summary"), version: z.literal("canonical-rsid-merge-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, inputRunSequences: z.array(n).min(1).max(8), inputBlockCount: n.positive(), pointerCount: n.positive() }).strict();
const reference = z.object({ artifact: stored, sequence: n, firstBlockSequence: n, lastBlockSequence: n,
  containerCount: n.positive().max(128), blockCount: n.positive().max(128 * 128), pointerCount: n.positive(),
  first: canonicalRsidPointerSchema, last: canonicalRsidPointerSchema }).strict();
const rootSchema = z.object({ version: z.literal("canonical-rsid-materialization-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, jobId: uuid, attemptId: uuid, scanSummary: scan, mergeSummary: merge.nullable(),
  canonicalBlockCount: n.positive(), canonicalRecordCount: n.positive(), pointerCount: n, blockCount: n, containerCount: n,
  byteCount: n, first: canonicalRsidPointerSchema.nullable(), last: canonicalRsidPointerSchema.nullable(),
  directories: z.array(reference).max(4096), firstArtifactSequence: n.max(4095), nextArtifactSequence: n.max(4096), artifactCount: n.max(4096) }).strict();
export type CanonicalRsidExpectedSource = { binding: CanonicalBinding; jobId: string; attemptId: string;
  canonicalBlockCount: number; canonicalRecordCount: number; firstArtifactSequence: number };
export class CanonicalRsidVerificationError extends Error {
  constructor(readonly code: "invalid_manifest" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "CanonicalRsidVerificationError";
  }
}
function valid(condition: unknown): asserts condition { if (!condition) throw new CanonicalRsidVerificationError("integrity_mismatch"); }
function addIdentity(set: Set<string>, artifact: PreparedStoredArtifact) {
  for (const value of [`sequence:${artifact.receipt.sequence}`, `artifact:${artifact.receipt.artifactId}`,
    `object:${artifact.storageObjectId}`, `key:${artifact.receipt.objectKey}`]) { valid(!set.has(value)); set.add(value); }
}
function member(artifact: PreparedStoredArtifact, root: CanonicalRsidMaterializationReceipt) {
  valid(artifact.receipt.jobId === root.jobId && artifact.receipt.attemptId === root.attemptId
    && artifact.receipt.sequence >= root.firstArtifactSequence && artifact.receipt.sequence < root.nextArtifactSequence);
}
function inRange(pointer: CanonicalRsidPointer, root: CanonicalRsidMaterializationReceipt) { valid(pointer.blockSequence < root.canonicalBlockCount); }

/** Metadata validation only. Expected source must be the already verified
 * canonical materialization in the SAME claimed job, not HTTP request fields. */
export function validateCanonicalRsidMaterialization(raw: unknown, expected: CanonicalRsidExpectedSource): CanonicalRsidMaterializationReceipt {
  assertPreparedMetadataBounds(raw, 4_000_000); assertPreparedMetadataBounds(expected, 4_000_000);
  const parsed = rootSchema.safeParse(raw); if (!parsed.success) throw new CanonicalRsidVerificationError("invalid_manifest");
  const root = parsed.data, source = z.object({ binding: canonicalBindingSchema, jobId: uuid, attemptId: uuid,
    canonicalBlockCount: n.positive(), canonicalRecordCount: n.positive(), firstArtifactSequence: n.max(4095) }).strict().parse(expected);
  valid(equal(root.binding, source.binding) && root.jobId === source.jobId && root.attemptId === source.attemptId
    && root.canonicalBlockCount === source.canonicalBlockCount && root.canonicalRecordCount === source.canonicalRecordCount
    && root.firstArtifactSequence === source.firstArtifactSequence && root.canonicalBlockCount <= root.canonicalRecordCount
    && root.canonicalRecordCount <= root.canonicalBlockCount * 2000
    && root.artifactCount === root.nextArtifactSequence - root.firstArtifactSequence
    && root.artifactCount === root.containerCount + root.directories.length && root.containerCount <= root.blockCount
    && root.blockCount <= root.pointerCount && root.pointerCount <= root.blockCount * 2000
    && root.pointerCount <= root.canonicalRecordCount && root.byteCount >= root.containerCount && root.byteCount <= root.containerCount * 8_388_608);
  const s = root.scanSummary, m = root.mergeSummary;
  valid(equal(s.binding, root.binding) && s.canonicalBlockCount === root.canonicalBlockCount
    && s.canonicalRecordCount === root.canonicalRecordCount && s.pointerCount === root.pointerCount);
  if (root.pointerCount === 0) {
    valid(s.runCount === 0 && s.indexBlockCount === 0 && m === null && root.first === null && root.last === null
      && root.directories.length === 0 && root.artifactCount === 0 && root.containerCount === 0 && root.blockCount === 0 && root.byteCount === 0);
    return root;
  }
  valid(s.runCount > 0 && s.runCount <= s.indexBlockCount && s.indexBlockCount <= s.pointerCount
    && s.pointerCount <= s.runCount * 32000 && s.pointerCount <= s.indexBlockCount * 2000
    && m && equal(m.binding, root.binding) && m.pointerCount === root.pointerCount
    && m.inputRunSequences.every((value, i, all) => i === 0 || value > all[i - 1])
    && m.inputBlockCount >= m.inputRunSequences.length && m.inputBlockCount <= m.pointerCount && m.pointerCount <= m.inputBlockCount * 2000
    && root.directories.length > 0 && root.first && root.last);
  inRange(root.first, root); inRange(root.last, root);
  const identities = new Set<string>(); let nextBlock = 0, containers = 0, pointers = 0, previous: CanonicalRsidPointer | undefined;
  for (const [i, directory] of root.directories.entries()) {
    member(directory.artifact, root); addIdentity(identities, directory.artifact);
    valid(directory.artifact.receipt.byteCount <= 1_048_576 && directory.sequence === i
      && directory.firstBlockSequence === nextBlock && directory.lastBlockSequence === nextBlock + directory.blockCount - 1
      && directory.containerCount <= directory.blockCount && directory.blockCount <= directory.containerCount * 128
      && directory.pointerCount >= directory.blockCount && directory.pointerCount <= directory.blockCount * 2000
      && compareCanonicalRsidPointers(directory.first, directory.last) <= 0);
    if (directory.pointerCount === 1) valid(equal(directory.first, directory.last));
    if (previous) valid(compareCanonicalRsidPointers(previous, directory.first) < 0);
    inRange(directory.first, root); inRange(directory.last, root);
    nextBlock += directory.blockCount; containers += directory.containerCount; pointers += directory.pointerCount; previous = directory.last;
  }
  valid(nextBlock === root.blockCount && containers === root.containerCount && pointers === root.pointerCount
    && equal(root.first, root.directories[0].first) && equal(root.last, root.directories.at(-1)!.last));
  return root;
}

/** Read EVERY final rsID index member before publishing its parent root. Proves
 * byte identity/EOF, exact object membership and totals, tuple bounds and strict
 * global order. This is NOT independent reconstruction of rsIDs from original
 * genetic bytes: the actual canonical scan/merge/materializer must produce the
 * supplied root under the same job, and publication must bind that provenance.
 * recordOffset membership belongs to that verified scan (range alone is not a
 * genotype assertion). A later lookup still checks the pointed canonical record.
 *
 * One <=1MiB directory, one <=8MiB data container and one <=2000-pointer codec
 * block; <=4096 artifact receipts. The300s whole-operation maximum cannot extend
 * the actual claim, source or consent deadline checked before/after each object
 * and at final return. No source data escapes or is published by this function.
 */
export async function verifyCanonicalRsidMaterialization(raw: unknown, expected: CanonicalRsidExpectedSource, options: {
  readArtifact: (artifact: PreparedStoredArtifact, signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
  check: (manifest: CanonicalRsidMaterializationReceipt, artifact: PreparedStoredArtifact | null, signal: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}) {
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), 300_000); timer.unref();
  const active = () => { if (signal.aborted) throw new CanonicalRsidVerificationError("aborted"); };
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new CanonicalRsidVerificationError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", abort); }
  }
  try {
    active(); const root = validateCanonicalRsidMaterialization(raw, expected);
    async function check(artifact: PreparedStoredArtifact | null, current = signal) {
      active(); await wait(options.check(structuredClone(root), artifact ? structuredClone(artifact) : null, current)); active();
    }
    const identities = new Set<string>(), artifacts: PreparedStoredArtifact[] = [];
    const append = (artifact: PreparedStoredArtifact) => { member(artifact, root); addIdentity(identities, artifact); artifacts.push(artifact); valid(artifacts.length <= 4096); };
    for (const ref of root.directories) append(ref.artifact);
    const read = (artifact: PreparedStoredArtifact) => readVerifiedPreparedArtifact(artifact, {
      readArtifact: options.readArtifact, check: (selected, current) => check(selected, current), signal,
    });
    await check(null);
    let blocks = 0, containers = 0, pointerCount = 0, byteCount = 0;
    let first: CanonicalRsidPointer | null = null, last: CanonicalRsidPointer | null = null;
    const pointerHash = createHash("sha256");
    for (const ref of root.directories) {
      const bytes = await read(ref.artifact);
      valid(bytes.length <= 1_048_576);
      const rawPage = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
      assertPreparedMetadataBounds(rawPage, 1_048_576);
      const page = z.object({ version: z.literal("canonical-rsid-container-directory-v1"), state: z.literal("provisional"),
        binding: canonicalBindingSchema, sequence: n, containers: z.array(z.object({ artifact: stored, descriptor: z.unknown() }).strict()).min(1).max(128) }).strict().parse(rawPage);
      valid(equal(page.binding, root.binding) && page.sequence === ref.sequence && page.containers.length === ref.containerCount && blocks === ref.firstBlockSequence);
      let pagePointers = 0, pageFirst: CanonicalRsidPointer | null = null, pageLast: CanonicalRsidPointer | null = null;
      for (const item of page.containers) {
        append(item.artifact);
        const descriptor = validateCanonicalRsidContainerDescriptor(item.descriptor, root.binding);
        valid(item.artifact.receipt.sequence < ref.artifact.receipt.sequence && descriptor.sequence === containers
          && descriptor.byteCount === item.artifact.receipt.byteCount && descriptor.sha256 === item.artifact.receipt.sha256);
        const data = await read(item.artifact); verifyCanonicalRsidContainerBytes(data, descriptor);
        for (const range of descriptor.blocks) {
          valid(range.descriptor.sequence === blocks);
          const decoded = await wait(decodeCanonicalRsidBlock((async function* () { yield data.subarray(range.offset, range.offset + range.length); })(), range.descriptor, { signal }));
          for (const pointer of decoded.pointers) {
            inRange(pointer, root); if (last) valid(compareCanonicalRsidPointers(last, pointer) < 0);
            first ??= pointer; pageFirst ??= pointer; last = pointer; pageLast = pointer;
            pointerCount++; pagePointers++; pointerHash.update(`${pointer.rsid}:${pointer.blockSequence}:${pointer.recordOffset}\n`);
          }
          blocks++;
        }
        containers++; byteCount += descriptor.byteCount;
      }
      valid(blocks === ref.lastBlockSequence + 1 && pagePointers === ref.pointerCount && equal(pageFirst, ref.first) && equal(pageLast, ref.last));
    }
    valid(blocks === root.blockCount && containers === root.containerCount && pointerCount === root.pointerCount
      && byteCount === root.byteCount && equal(first, root.first) && equal(last, root.last) && artifacts.length === root.artifactCount);
    artifacts.sort((a, b) => a.receipt.sequence - b.receipt.sequence);
    valid(artifacts.every((artifact, i) => artifact.receipt.sequence === root.firstArtifactSequence + i));
    await check(null); active();
    return { version: "verified-canonical-rsid-materialization-v1" as const, state: "provisional" as const,
      binding: root.binding, jobId: root.jobId, attemptId: root.attemptId,
      manifestSha256: createHash("sha256").update(JSON.stringify(root)).digest("hex"), pointerSha256: pointerHash.digest("hex"),
      canonicalBlockCount: root.canonicalBlockCount, canonicalRecordCount: root.canonicalRecordCount,
      pointerCount, blockCount: blocks, containerCount: containers, byteCount, artifactCount: artifacts.length, artifacts };
  } catch (error) {
    if (signal.aborted) throw new CanonicalRsidVerificationError("aborted");
    if (error instanceof CanonicalRsidVerificationError) throw error;
    throw new CanonicalRsidVerificationError("unavailable");
  } finally { clearTimeout(timer); controller.abort(); }
}
