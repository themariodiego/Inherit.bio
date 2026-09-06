import "server-only";
import type { Db } from "./load";
import { readInputSnapshot, type InputProvenanceSnapshot } from "./input-provenance";

/** Display facts only: never source paths, file names, hashes or raw headers. */
export interface InputSourceView {
  fileId: string;
  hasResultRecord?: boolean;
  fileType: string;
  processedAt: string | null;
  snapshot: Pick<InputProvenanceSnapshot, "sourceBuild" | "buildBasis" | "targetBuild" | "variantRowsMapped" | "variantRowsUnmapped" | "counts"> | null;
}

/** The caller must authorize the subject and purpose before this admin query. */
export async function loadInputSources(db: Db, subjectId: string, fileIds: readonly string[]): Promise<InputSourceView[]> {
  const ids = [...new Set(fileIds)].sort();
  const result: InputSourceView[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await db.from("genome_files")
      .select("id,file_type,status,processing_finished_at,input_provenance,input_source_sha256")
      .eq("subject_id", subjectId).in("id", ids.slice(offset, offset + 100)).order("id");
    // IDs came from the authorized result read. A metadata outage is not a
    // reason to hide that supported result or invent a quality measurement.
    if (error) {
      result.push(...ids.slice(offset, offset + 100).map((fileId) => ({ fileId, fileType: "unknown", processedAt: null, snapshot: null })));
      continue;
    }
    const byId = new Map((data ?? []).map((file) => [file.id, file]));
    for (const fileId of ids.slice(offset, offset + 100)) {
      const file = byId.get(fileId);
      if (!file) {
        result.push({ fileId, fileType: "unknown", processedAt: null, snapshot: null });
        continue;
      }
      const snapshot = readInputSnapshot(file.input_provenance, file.processing_finished_at, file.status, file.input_source_sha256);
      result.push({ fileId: file.id, fileType: file.file_type, processedAt: file.processing_finished_at,
        snapshot: snapshot ? {
          sourceBuild: snapshot.sourceBuild, buildBasis: snapshot.buildBasis, targetBuild: snapshot.targetBuild,
          variantRowsMapped: snapshot.variantRowsMapped, variantRowsUnmapped: snapshot.variantRowsUnmapped, counts: snapshot.counts,
        } : null });
    }
  }
  return result;
}
