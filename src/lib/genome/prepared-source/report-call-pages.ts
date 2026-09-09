import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { ReportCall } from "../report-calls";
import { assertPreparedMetadataBounds } from "./canonical-manifest";
import { canonicalRecordSchema } from "./canonical-schema";
import type { CanonicalCoordinate } from "./canonical-coordinate-index";
import type { CanonicalCoordinateCursor } from "./canonical-coordinate-reader";
import { createOwnPreparedCoordinateReader, type OwnPreparedSource } from "./published-source-reader";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/), hash = z.string().regex(/^[0-9a-f]{64}$/);
const integer = z.number().int().nonnegative().safe();
/** Captured by all report grant resolvers; not a browser-provided capability. */
export const preparedReportSourceSchema = z.object({ version: z.literal("own-prepared-report-source-v1"),
  backend: z.literal("prepared-object-v1"), manifestId: uuid, membershipSha256: hash,
  rootArtifactId: uuid, rootSha256: hash }).strict();
export type PreparedReportSource = z.infer<typeof preparedReportSourceSchema>;
const selectionSchema = z.object({ fileId: uuid, subjectId: uuid, sourceRevision: integer.positive(),
  sourceSha256: hash, normalizedAt: z.iso.datetime({ offset: true }), preparedSource: preparedReportSourceSchema }).strict();
export type PreparedReportSelection = z.infer<typeof selectionSchema>;
const cursorSchema = z.object({ version: z.literal("canonical-coordinate-cursor-v1"), manifestSha256: hash,
  querySha256: hash, blockSequence: integer, recordOffset: integer.max(1999) }).strict();
export type PreparedReportCallPage = { variants: Array<{ sourceLine: number; call: ReportCall }>;
  observations: Array<{ sourceLine: number; call: ReportCall }> };
export class PreparedReportReadError extends Error {
  constructor(readonly code: "invalid_request" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "PreparedReportReadError";
  }
}

/** Stream bounded selected-call pages under the EXACT captured report source.
 * checkOperation must resolve and compare the current running report claim,
 * purpose and complete authorization. Store consent alone does not suffice.
 * The actual published reader performs this check around each object and page.
 * Consumers must discard partial work on failure and recheck that same claim
 * transactionally before saving a result. No report is committed by this helper.
 *
 * Target fields come from normalization; usability and line remain original
 * evidence. No UUID ordering is invented. Consumers must use order-independent
 * conflict handling or the retained sourceLine where that is their contract.
 * A short/empty page is not EOF; only a validated null cursor is terminal.
 */
export function readOwnPreparedReportPages(actor: { accountId: string; sessionId: string },
  rawSelection: PreparedReportSelection, rawLoci: readonly CanonicalCoordinate[], options: {
    checkOperation: (signal: AbortSignal) => Promise<void>; signal?: AbortSignal;
  }): AsyncGenerator<PreparedReportCallPage, void, unknown> {
  let selection: PreparedReportSelection, loci: CanonicalCoordinate[];
  try {
    assertPreparedMetadataBounds(rawSelection, 2048); selection = selectionSchema.parse(rawSelection);
    assertPreparedMetadataBounds(rawLoci, 16384);
    loci = z.array(z.object({ chrom: integer.positive().max(25), pos: integer.positive() }).strict()).max(200).parse(rawLoci);
    if (new Set(loci.map(p => `${p.chrom}:${p.pos}`)).size !== loci.length || typeof options.checkOperation !== "function") throw new Error();
  } catch { throw new PreparedReportReadError("invalid_request"); }
  const read = createOwnPreparedCoordinateReader({ ...actor });
  const { checkOperation, signal } = options;
  const active = () => { if (signal?.aborted) throw new PreparedReportReadError("aborted"); };
  function match(source: OwnPreparedSource) {
    const expected = selection.preparedSource;
    if (source.fileId !== selection.fileId || source.subjectId !== selection.subjectId
      || source.sourceRevision !== selection.sourceRevision || source.rawSha256 !== selection.sourceSha256
      || source.preparedAt !== selection.normalizedAt || source.manifestId !== expected.manifestId
      || source.membershipSha256 !== expected.membershipSha256
      || source.root.receipt.artifactId !== expected.rootArtifactId || source.root.receipt.sha256 !== expected.rootSha256)
      throw new PreparedReportReadError("integrity_mismatch");
  }
  return (async function* () {
    let cursor: CanonicalCoordinateCursor | null = null, firstSource: OwnPreparedSource | undefined;
    const requested = new Set(loci.map(p => `${p.chrom}:${p.pos}`));
    try {
      do {
        active();
        const page = await read({ fileId: selection.fileId, expectedManifestId: selection.preparedSource.manifestId,
          loci, cursor }, { checkOperation, signal });
        active(); match(page.source);
        if (firstSource && !isDeepStrictEqual(page.source, firstSource)) throw new PreparedReportReadError("integrity_mismatch");
        firstSource ??= structuredClone(page.source);
        if (!Array.isArray(page.records) || page.records.length > 1000) throw new PreparedReportReadError("integrity_mismatch");
        const projected: PreparedReportCallPage = { variants: [], observations: [] };
        for (const raw of page.records) {
          const record = canonicalRecordSchema.parse(raw);
          // Coordinate reads promise only normalized selected evidence. A stray
          // source-only/duplicate disposition is a failed boundary, not coverage.
          if (record.normalization.status !== "normalized" || record.event.type === "reference") throw new PreparedReportReadError("integrity_mismatch");
          const normalized = record.normalization.record;
          if (!requested.has(`${normalized.chrom}:${normalized.pos}`)) throw new PreparedReportReadError("integrity_mismatch");
          const call: ReportCall = { file_id: selection.fileId, ...normalized,
            ...(record.event.type === "observed" ? { usable: record.event.call.usable } : {}) };
          (record.event.type === "variant" ? projected.variants : projected.observations).push({ sourceLine: record.event.line, call });
        }
        const next = page.nextCursor === null ? null : cursorSchema.parse(page.nextCursor);
        if (next && cursor && (next.manifestSha256 !== cursor.manifestSha256 || next.querySha256 !== cursor.querySha256
          || next.blockSequence < cursor.blockSequence || (next.blockSequence === cursor.blockSequence && next.recordOffset <= cursor.recordOffset)))
          throw new PreparedReportReadError("integrity_mismatch");
        cursor = next;
        active(); yield projected;
      } while (cursor !== null);
    } catch (error) {
      active(); if (error instanceof PreparedReportReadError) throw error;
      throw new PreparedReportReadError("unavailable");
    }
  })();
}
