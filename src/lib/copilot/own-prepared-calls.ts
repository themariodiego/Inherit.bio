import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { z } from "zod";
import { assertPreparedMetadataBounds } from "../genome/prepared-source/canonical-manifest";
import { canonicalRecordSchema, type CanonicalRecord } from "../genome/prepared-source/canonical-schema";
import { canonicalRecordRsid, canonicalRsidCursorSchema, type CanonicalRsidCursor } from "../genome/prepared-source/canonical-rsid-reader";
import { createOwnPreparedRsidReader, type OwnPreparedSource } from "../genome/prepared-source/published-source-reader";
import { preparedReportSourceSchema } from "../genome/prepared-source/report-call-pages";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/), hash = z.string().regex(/^[0-9a-f]{64}$/), n = z.number().int().nonnegative().safe();
const selectionSchema = z.object({ fileId: uuid, subjectId: uuid, sourceRevision: n.positive(), sourceSha256: hash,
  decodedSha256: hash, normalizedAt: z.iso.datetime({ offset: true }), preparedSource: preparedReportSourceSchema }).strict();
export type PreparedCopilotSelection = z.infer<typeof selectionSchema>;
const callSchema = z.object({ file_id: uuid, rsid: n.positive(), chrom: n.positive().max(25), pos: n.positive(),
  ref: z.string().nullable(), alt: z.string().nullable(), genotype: z.string().max(64), usable: z.boolean() }).strict();
/** Structural match to existing Copilot calls; no projection/schema permission. */
export type OwnPreparedCopilotCall = z.infer<typeof callSchema>;
export class PreparedCopilotReadError extends Error {
  constructor(readonly code: "invalid_request" | "integrity_mismatch" | "source_unavailable" | "unavailable" | "too_large" | "aborted") {
    super(code); this.name = "PreparedCopilotReadError";
  }
}
function valid(condition: unknown): asserts condition { if (!condition) throw new PreparedCopilotReadError("integrity_mismatch"); }
function matchSource(source: OwnPreparedSource, selection: PreparedCopilotSelection) {
  const p = selection.preparedSource;
  valid(source.fileId === selection.fileId && source.subjectId === selection.subjectId
    && source.sourceRevision === selection.sourceRevision && source.rawSha256 === selection.sourceSha256
    && source.decodedSha256 === selection.decodedSha256 && source.preparedAt === selection.normalizedAt
    && source.manifestId === p.manifestId && source.membershipSha256 === p.membershipSha256
    && source.root.receipt.artifactId === p.rootArtifactId && source.root.receipt.sha256 === p.rootSha256);
}
function projectCalls(records: CanonicalRecord[], fileId: string): OwnPreparedCopilotCall[] {
  const firstVariants = new Map<number, Extract<CanonicalRecord["event"], { type: "variant" }>>();
  for (const record of records) if (record.event.type === "variant" && record.normalization.status === "normalized") {
    valid(!firstVariants.has(record.event.line)); firstVariants.set(record.event.line, record.event);
  }
  const calls: OwnPreparedCopilotCall[] = [];
  for (const record of records) {
    if (record.normalization.status === "duplicate") {
      // Only discard an exact duplicate whose original normalized variant is
      // present in this fully drained rsID selection. Source-only evidence is
      // never removed merely because its disposition says "duplicate".
      const first = firstVariants.get(record.normalization.firstSourceLine);
      valid(first && record.event.type === "variant" && equal(first.record, record.event.record));
      continue;
    }
    if (record.normalization.status !== "normalized") throw new PreparedCopilotReadError("source_unavailable");
    valid(record.event.type !== "reference");
    calls.push(callSchema.parse({ file_id: fileId, ...record.normalization.record,
      usable: record.event.type === "observed" ? record.event.call.usable : true }));
  }
  return calls;
}

/** Fully drain one exact own-source selection before releasing any raw calls.
 * checkOperation must re-resolve the captured Copilot permission, coordinator
 * and complete projection. Published reads also enforce current store/source
 * and exact member authority before/after I/O. This adapter grants nothing and
 * does not commit history; the dispatcher must retain its final full-projection
 * fence and transactional commit (including all other selected sources).
 *
 * <=50 rsIDs, <=1000 evidence records/page, <=10000 aggregate records and 2MB
 * serialized evidence/calls. At most 11 pages includes an empty terminal page.
 * All pages and callbacks share one finite 30s scope. A short or empty page with
 * a cursor is not absence; invalid/nonprogressing cursors or any later failure
 * discard the entire result. Selected unmapped/unsupported evidence is explicitly
 * unavailable. Cross-locus collisions and observed no-calls remain visible. */
export async function readOwnPreparedCopilotCalls(rawActor: { accountId: string; sessionId: string },
  rawSelection: PreparedCopilotSelection, rawRsids: readonly number[], options: {
    checkOperation: (signal: AbortSignal) => Promise<void>; signal?: AbortSignal;
    consumeEvidence?: (count: number, serializedBytes: number) => void;
  }): Promise<OwnPreparedCopilotCall[]> {
  const deadline = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), 30_000); timer.unref();
  const active = () => { if (signal.aborted) throw new PreparedCopilotReadError("aborted"); };
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new PreparedCopilotReadError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([pending, cancelled]); active(); return value; }
    finally { signal.removeEventListener("abort", abort); }
  }
  try {
    active(); let actor, selection, rsids;
    try {
      assertPreparedMetadataBounds(rawActor, 512); actor = z.object({ accountId: uuid, sessionId: uuid }).strict().parse(rawActor);
      assertPreparedMetadataBounds(rawSelection, 2048); selection = selectionSchema.parse(rawSelection);
      assertPreparedMetadataBounds(rawRsids, 16384); rsids = z.array(n.positive()).max(50).parse(rawRsids).sort((a, b) => a - b);
      if (new Set(rsids).size !== rsids.length || typeof options.checkOperation !== "function"
        || (options.consumeEvidence !== undefined && typeof options.consumeEvidence !== "function")) throw new Error();
    } catch { throw new PreparedCopilotReadError("invalid_request"); }
    const read = createOwnPreparedRsidReader(actor), operation = options.checkOperation, consumeEvidence = options.consumeEvidence;
    const checkOperation = async (current: AbortSignal) => { active(); await wait(operation(current)); active(); };
    let firstSource: OwnPreparedSource | undefined;
    const checkSourceSelection = async (source: OwnPreparedSource) => {
      active(); matchSource(source, selection);
      if (firstSource) valid(equal(source, firstSource));
      firstSource ??= structuredClone(source);
    };
    const requested = new Set(rsids), querySha256 = createHash("sha256").update(JSON.stringify(rsids)).digest("hex");
    const records: CanonicalRecord[] = []; let bytes = 2, cursor: CanonicalRsidCursor | null = null;
    await checkOperation(signal);
    for (let pageNumber = 0; ; pageNumber++) {
      if (pageNumber >= 11) throw new PreparedCopilotReadError("too_large");
      const page: Awaited<ReturnType<typeof read>> = await wait(read({ fileId: selection.fileId, expectedManifestId: selection.preparedSource.manifestId,
        rsids, cursor }, { checkOperation, checkSourceSelection, signal }));
      await checkSourceSelection(page.source);
      valid(Array.isArray(page.records) && page.records.length <= 1000);
      let pageBytes = 2, pageRecords = 0;
      for (const raw of page.records) {
        const record = canonicalRecordSchema.parse(raw), rsid = canonicalRecordRsid(record);
        valid(rsid !== null && requested.has(rsid));
        const recordBytes = Buffer.byteLength(JSON.stringify(record));
        bytes += recordBytes + (records.length ? 1 : 0);
        pageBytes += recordBytes + (pageRecords++ ? 1 : 0);
        if (records.length === 10000 || bytes > 2_000_000) throw new PreparedCopilotReadError("too_large");
        records.push(record);
      }
      // The caller may compose several sources under one stricter budget.
      // Charge original evidence before exact duplicate variants are omitted.
      consumeEvidence?.(pageRecords, pageBytes);
      const next: CanonicalRsidCursor | null = page.nextCursor === null ? null : canonicalRsidCursorSchema.parse(page.nextCursor);
      if (next) {
        valid(next.querySha256 === querySha256);
        if (cursor) valid(next.canonicalSha256 === cursor.canonicalSha256 && next.rsidSha256 === cursor.rsidSha256
          && (next.indexBlockSequence > cursor.indexBlockSequence
            || (next.indexBlockSequence === cursor.indexBlockSequence && next.pointerOffset > cursor.pointerOffset)));
      }
      cursor = next;
      if (cursor === null) break;
    }
    const calls = projectCalls(records, selection.fileId);
    if (Buffer.byteLength(JSON.stringify(calls)) > 2_000_000) throw new PreparedCopilotReadError("too_large");
    await checkOperation(signal); active(); return calls;
  } catch (error) {
    if (signal.aborted) throw new PreparedCopilotReadError("aborted");
    if (error instanceof PreparedCopilotReadError) throw error;
    throw new PreparedCopilotReadError("unavailable");
  } finally { clearTimeout(timer); deadline.abort(); }
}
