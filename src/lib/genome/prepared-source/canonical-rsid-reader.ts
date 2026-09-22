import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { validateCanonicalMaterializationReceipt, decodeCanonicalContainerDirectory } from "./canonical-manifest";
import { validateCanonicalRsidMaterialization, type CanonicalRsidExpectedSource } from "./verify-rsid-materialization";
import { decodeCanonicalRsidBlock, compareCanonicalRsidPointers, type CanonicalRsidPointer } from "./canonical-rsid-index";
import { readCanonicalStorageBlock } from "./canonical-storage-reader";
import { readPreparedStorageRange, type PreparedRangeFetch } from "./storage-reader";
import { CanonicalRsidReadError, requireRsidIntegrity as valid, addRsidArtifactIdentity, decodeRsidReadDirectory } from "./canonical-rsid-reader-metadata";
import type { CanonicalMaterializationReceipt, CanonicalContainerDirectory } from "./materialize-canonical";
import type { CanonicalRsidMaterializationReceipt } from "./materialize-canonical-rsid";
import type { CanonicalRecord } from "./canonical-schema";
import type { PreparedStoredArtifact } from "./storage-writer";

export { CanonicalRsidReadError } from "./canonical-rsid-reader-metadata";
export const CANONICAL_RSID_MAX_QUERY_IDS = 50;
export const CANONICAL_RSID_MAX_PAGE_RECORDS = 1000;
export const CANONICAL_RSID_MAX_PAGE_BYTES = 2_000_000;
const n = z.number().int().nonnegative().safe(), hash = z.string().regex(/^[0-9a-f]{64}$/);
export const canonicalRsidCursorSchema = z.object({ version: z.literal("canonical-rsid-cursor-v1"),
  canonicalSha256: hash, rsidSha256: hash, querySha256: hash, indexBlockSequence: n, pointerOffset: n.max(1999),
}).strict();
export type CanonicalRsidCursor = z.infer<typeof canonicalRsidCursorSchema>;
export type CanonicalRsidReadSelection = { canonical: CanonicalMaterializationReceipt;
  rsid: CanonicalRsidMaterializationReceipt; artifact: PreparedStoredArtifact | null };
export const canonicalRecordRsid = (record: CanonicalRecord) => record.event.type === "reference" ? null
  : record.event.type === "variant" ? record.event.record.rsid : record.event.call.rsid;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** rsID lookup over the exact published canonical/index pair. All original
 * evidence is retained, including unmapped records, duplicates and wrong-locus
 * collisions. A pointer is never a call until its canonical record is verified.
 * Publication must already have verified the full index and member inventory.
 * Callbacks must recheck current source/coordinator/operation and exact artifact
 * membership; these hash-bound cursors establish position, never permission.
 *
 * One rsID directory/block, one canonical directory/block and <=1000 records /
 * 2MB output are retained. A page has a finite 30s deadline. Consumers must drain
 * until null (including after short pages), bound aggregate work and discard all
 * partial output on any later refusal. No provider paths leave this helper. */
export async function readCanonicalRsids(request: { canonical: CanonicalMaterializationReceipt;
  rsid: CanonicalRsidMaterializationReceipt; expected: CanonicalRsidExpectedSource;
  rsids: readonly number[]; cursor?: CanonicalRsidCursor | null }, options: {
    check: (selection: CanonicalRsidReadSelection, signal: AbortSignal) => Promise<void>;
    fetchRange: PreparedRangeFetch; signal?: AbortSignal;
  }) {
  const deadline = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), 30_000); timer.unref();
  const active = () => { if (signal.aborted) throw new CanonicalRsidReadError("aborted"); };
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new CanonicalRsidReadError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const result = await Promise.race([pending, cancelled]); active(); return result; }
    finally { signal.removeEventListener("abort", abort); }
  }
  try {
    active();
    if (!Array.isArray(request.rsids) || request.rsids.length > CANONICAL_RSID_MAX_QUERY_IDS) throw new CanonicalRsidReadError("invalid_request");
    const parsed = z.array(n.positive()).max(CANONICAL_RSID_MAX_QUERY_IDS).safeParse(request.rsids);
    if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) throw new CanonicalRsidReadError("invalid_request");
    const rsids = parsed.data.sort((a, b) => a - b), requested = new Set(rsids);
    const canonical = validateCanonicalMaterializationReceipt(request.canonical, request.expected);
    const rsid = validateCanonicalRsidMaterialization(request.rsid, { ...request.expected,
      canonicalBlockCount: canonical.blockCount, canonicalRecordCount: canonical.recordCount });
    valid(canonical.nextArtifactSequence <= rsid.firstArtifactSequence);
    const binding = { canonicalSha256: sha(canonical), rsidSha256: sha(rsid), querySha256: sha(rsids) };
    const rawCursor = request.cursor == null ? null : canonicalRsidCursorSchema.safeParse(request.cursor);
    if (rawCursor && !rawCursor.success) throw new CanonicalRsidReadError("invalid_request");
    const cursor = rawCursor?.data ?? null;
    if (cursor && (cursor.canonicalSha256 !== binding.canonicalSha256 || cursor.rsidSha256 !== binding.rsidSha256
      || cursor.querySha256 !== binding.querySha256 || cursor.indexBlockSequence >= rsid.blockCount)) throw new CanonicalRsidReadError("invalid_request");
    async function check(artifact: PreparedStoredArtifact | null, current = signal) {
      active(); await wait(options.check({ canonical: structuredClone(canonical), rsid: structuredClone(rsid),
        artifact: artifact ? structuredClone(artifact) : null }, current)); active();
    }
    async function object<T>(artifact: PreparedStoredArtifact, decode: (bytes: Uint8Array) => T): Promise<T> {
      return readPreparedStorageRange({ objectKey: artifact.receipt.objectKey, offset: 0,
        length: artifact.receipt.byteCount, total: artifact.receipt.byteCount }, {
        signal, fetchRange: args => options.fetchRange({ ...args, artifact }), check: current => check(artifact, current), decode: async bytes => decode(bytes),
      });
    }
    await check(null);
    const identities = new Set<string>(), visited = new Set<string>();
    for (const ref of [...canonical.directories, ...canonical.coordinatePages, ...rsid.directories]) addRsidArtifactIdentity(identities, ref.artifact);
    const context = { binding: canonical.binding, jobId: canonical.jobId, attemptId: canonical.attemptId,
      firstArtifactSequence: canonical.firstArtifactSequence, nextArtifactSequence: canonical.nextArtifactSequence,
      forbiddenArtifacts: [...canonical.directories, ...canonical.coordinatePages].map(ref => ref.artifact) };
    let directoryCache: { sequence: number; page: CanonicalContainerDirectory } | undefined;
    let blockCache: { sequence: number; records: CanonicalRecord[] } | undefined;
    function register(key: string, containers: { artifact: PreparedStoredArtifact }[]) {
      if (visited.has(key)) return;
      for (const container of containers) addRsidArtifactIdentity(identities, container.artifact);
      visited.add(key);
    }
    async function pointedRecord(pointer: CanonicalRsidPointer) {
      valid(pointer.blockSequence < canonical.blockCount);
      if (blockCache?.sequence !== pointer.blockSequence) {
        const ref = canonical.directories.find(r => pointer.blockSequence >= r.firstBlockSequence && pointer.blockSequence <= r.lastBlockSequence);
        valid(ref);
        if (directoryCache?.sequence !== ref.sequence) {
          const expectedFirstContainerSequence = canonical.directories.slice(0, ref.sequence).reduce((sum, r) => sum + r.containerCount, 0);
          const page = await object(ref.artifact, bytes => decodeCanonicalContainerDirectory(bytes, ref, { ...context, expectedFirstContainerSequence }));
          register(`canonical:${ref.sequence}`, page.containers); directoryCache = { sequence: ref.sequence, page };
        }
        const container = directoryCache.page.containers.find(c => c.descriptor.blocks.some(b => b.descriptor.sequence === pointer.blockSequence));
        valid(container);
        const decoded = await readCanonicalStorageBlock({ objectKey: container.artifact.receipt.objectKey,
          container: container.descriptor, blockSequence: pointer.blockSequence }, {
          signal, fetchRange: args => options.fetchRange({ ...args, artifact: container.artifact }), check: current => check(container.artifact, current),
        });
        blockCache = { sequence: pointer.blockSequence, records: decoded.records };
      }
      const record = blockCache.records[pointer.recordOffset];
      valid(record && canonicalRecordRsid(record) === pointer.rsid);
      return record;
    }
    const records: CanonicalRecord[] = []; let bytes = 2, last: CanonicalRsidCursor | null = null, cursorSeen = cursor === null;
    const intersects = (first: number, last: number) => rsids.some(id => id >= first && id <= last);
    async function finish(nextCursor: CanonicalRsidCursor | null) {
      if (!cursorSeen) throw new CanonicalRsidReadError("invalid_request");
      await check(null); active(); return { records, nextCursor };
    }
    for (const ref of rsid.directories) {
      if ((cursor && ref.lastBlockSequence < cursor.indexBlockSequence) || !intersects(ref.first.rsid, ref.last.rsid)) continue;
      const page = await object(ref.artifact, data => decodeRsidReadDirectory(data, rsid, ref));
      register(`rsid:${ref.sequence}`, page.containers);
      for (const container of page.containers) for (const range of container.descriptor.blocks) {
        const d = range.descriptor;
        if ((cursor && d.sequence < cursor.indexBlockSequence) || !intersects(d.first.rsid, d.last.rsid)) continue;
        const decoded = await readPreparedStorageRange({ objectKey: container.artifact.receipt.objectKey,
          offset: range.offset, length: range.length, total: container.descriptor.byteCount }, {
          signal, fetchRange: args => options.fetchRange({ ...args, artifact: container.artifact }), check: current => check(container.artifact, current),
          decode: data => decodeCanonicalRsidBlock((async function* () { yield data; })(), d, { signal }),
        });
        valid(decoded.pointers.every((p, i, all) => p.blockSequence < canonical.blockCount
          && (i === 0 || compareCanonicalRsidPointers(all[i - 1], p) < 0)));
        if (cursor && d.sequence === cursor.indexBlockSequence) {
          const pointer = decoded.pointers[cursor.pointerOffset];
          if (!pointer || !requested.has(pointer.rsid)) throw new CanonicalRsidReadError("invalid_request");
          await pointedRecord(pointer); cursorSeen = true;
        }
        for (const [offset, pointer] of decoded.pointers.entries()) {
          if ((cursor && d.sequence === cursor.indexBlockSequence && offset <= cursor.pointerOffset) || !requested.has(pointer.rsid)) continue;
          const record = await pointedRecord(pointer), size = Buffer.byteLength(JSON.stringify(record)) + (records.length ? 1 : 0);
          if (size + 2 > CANONICAL_RSID_MAX_PAGE_BYTES) throw new CanonicalRsidReadError("too_large");
          if (records.length && bytes + size > CANONICAL_RSID_MAX_PAGE_BYTES) return await finish(last);
          records.push(record); bytes += size;
          last = { version: "canonical-rsid-cursor-v1", ...binding, indexBlockSequence: d.sequence, pointerOffset: offset };
          if (records.length === CANONICAL_RSID_MAX_PAGE_RECORDS) return await finish(last);
        }
      }
    }
    return await finish(null);
  } catch (error) {
    if (signal.aborted) throw new CanonicalRsidReadError("aborted");
    if (error instanceof CanonicalRsidReadError) throw error;
    throw new CanonicalRsidReadError("unavailable");
  } finally { clearTimeout(timer); deadline.abort(); }
}
