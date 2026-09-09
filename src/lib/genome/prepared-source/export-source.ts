import "server-only";
import { z } from "zod";
import { assertPreparedMetadataBounds } from "./canonical-manifest";
import type { CanonicalBinding, CanonicalRecord } from "./canonical-schema";
import { preparedReportSourceSchema } from "./report-call-pages";
import { withOwnPreparedSource, PublishedSourceReadError, type OwnPreparedSource } from "./published-source-reader";
import { streamPreparedExportRecords } from "./export-reader";

const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/);
const selectionSchema = z.object({ fileId: uuid, subjectId: uuid, sourceRevision: z.number().int().positive().safe(),
  rawSha256: hash, decodedSha256: hash, preparedAt: z.string(), preparedSource: preparedReportSourceSchema }).strict();
export type OwnPreparedExportSelection = z.infer<typeof selectionSchema>;
export type OwnPreparedExportHeader = { type: "prepared-export-source"; version: "own-prepared-export-v1";
  manifestId: string; preparedAt: string; binding: CanonicalBinding; summary: OwnPreparedSource["summary"] };

/** Consume every immutable canonical record under an actual current export
 * snapshot. The callback is awaited, so downstream backpressure cannot create an
 * unbounded queue. Its caller must abort the archive on any error. This includes
 * all original evidence; no DB-row fallback or analytical recalculation occurs. */
export async function exportOwnPreparedRecords(actor: { accountId: string; sessionId: string }, rawSelection: OwnPreparedExportSelection,
  options: { checkOperation: (signal: AbortSignal) => Promise<void>; signal?: AbortSignal },
  consume: (records: readonly CanonicalRecord[], signal: AbortSignal, header: OwnPreparedExportHeader) => Promise<void>): Promise<{ recordCount: number; variantCount: number }> {
  let selection: OwnPreparedExportSelection;
  try { assertPreparedMetadataBounds(rawSelection, 4096); selection = selectionSchema.parse(rawSelection); }
  catch { throw new PublishedSourceReadError("invalid_request"); }
  if (typeof consume !== "function") throw new PublishedSourceReadError("invalid_request");
  return withOwnPreparedSource(actor, { fileId: selection.fileId, expectedManifestId: selection.preparedSource.manifestId }, options,
    async ({ source, canonical, readArtifact, checkArtifact, checkSource, signal }) => {
      const expected = selection.preparedSource;
      if (source.fileId !== selection.fileId || source.subjectId !== selection.subjectId || source.sourceRevision !== selection.sourceRevision
        || source.rawSha256 !== selection.rawSha256 || source.decodedSha256 !== selection.decodedSha256
        || Date.parse(source.preparedAt) !== Date.parse(selection.preparedAt) || source.membershipSha256 !== expected.membershipSha256
        || source.root.receipt.artifactId !== expected.rootArtifactId || source.root.receipt.sha256 !== expected.rootSha256)
        throw new PublishedSourceReadError("integrity_mismatch");
      const header: OwnPreparedExportHeader = { type: "prepared-export-source", version: "own-prepared-export-v1",
        manifestId: source.manifestId, preparedAt: source.preparedAt, binding: canonical.binding, summary: source.summary };
      let recordCount = 0, variantCount = 0;
      for await (const records of streamPreparedExportRecords(canonical,
        { binding: canonical.binding, jobId: canonical.jobId, attemptId: canonical.attemptId }, {
          signal, readArtifact, check: (_, artifact, current) => artifact ? checkArtifact(artifact, current) : checkSource(),
        })) {
        recordCount += records.length;
        variantCount += records.filter(r => r.event.type === "variant" && r.normalization.status === "normalized").length;
        await consume(records, signal, structuredClone(header));
        if (signal.aborted) throw new PublishedSourceReadError("aborted");
      }
      if (variantCount !== source.summary.variantCount || recordCount !== canonical.recordCount)
        throw new PublishedSourceReadError("integrity_mismatch");
      return { recordCount, variantCount };
    });
}
