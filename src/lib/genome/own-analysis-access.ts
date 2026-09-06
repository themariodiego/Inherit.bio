import "server-only";
import { z } from "zod";
import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";
import type { OwnReportPurpose } from "@/lib/uploads/own-report-purpose";
import type { Db } from "./load";
import type { ReportCall } from "./report-calls";

export interface AnalysisFileBoundary {
  id: string;
  status?: string;
  single_logical_sample_verified_at?: string | null;
}

/** Metadata only. Do not widen the legacy generic loader used by Copilot/family computations. */
export async function loadOwnAnalysisCandidateFiles(db: Db, subjectId: string) {
  const { data, error } = await db.from("genome_files")
    .select("id,original_name,file_type,status,variant_count,created_at,subject_id,build,observed_call_sha256,observed_call_version,single_logical_sample_verified_at,normalization_completed_at,normalization_source_revision,upload_revision")
    .eq("subject_id", subjectId).in("status", ["annotated", "stored"]).order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []).filter(f => f.single_logical_sample_verified_at === null ? f.status === "annotated"
    : f.normalization_completed_at !== null && f.normalization_source_revision === f.upload_revision);
}

/**
 * Only the live database resolver authorizes new sources. Missing/failed proof
 * removes those sources, without hiding independently valid historical files.
 * Call both before genetic reads and before returning their reduced result.
 */
export async function filterOwnAnalysisFiles<T extends AnalysisFileBoundary>(
  db: Db, subjectId: string, purpose: OwnReportPurpose | null, files: readonly T[],
  { storedResult = true }: { storedResult?: boolean } = {},
): Promise<T[]> {
  const legacy = files.filter(f => f.single_logical_sample_verified_at === null && f.status !== "stored");
  const modern = files.filter(f => f.single_logical_sample_verified_at != null);
  if (!modern.length || !purpose) return legacy;
  const actor = await currentOwnUploadAccount();
  if (!actor) return legacy;
  const allowed = new Set<string>();
  for (let offset = 0; offset < modern.length; offset += 100) {
    const selected = modern.slice(offset, offset + 100).map(f => f.id);
    const { data, error } = await db.rpc("filter_own_analysis_files_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId,
      p_purpose: purpose, p_file_ids: selected, p_stored_result: storedResult,
    });
    const parsed = z.array(z.uuid()).max(selected.length).safeParse(data);
    if (error || !parsed.success || new Set(parsed.data).size !== parsed.data.length
      || parsed.data.some(id => !selected.includes(id))) return legacy;
    for (const id of parsed.data) allowed.add(id);
  }
  const legacyIds = new Set(legacy.map(f => f.id));
  return files.filter(f => legacyIds.has(f.id) || allowed.has(f.id));
}

const reportCall = z.object({ file_id: z.uuid(), rsid: z.number().int().positive().safe(),
  chrom: z.number().int().min(1).max(25), pos: z.number().int().positive().safe(),
  ref: z.string().nullable(), alt: z.string().nullable(), genotype: z.string().max(64), usable: z.boolean(),
}).strict();

/** Each page holds live source/grant locks while fetching only the requested result inputs. */
export async function loadOwnReportCallPage(db: Db, fileId: string, purpose: OwnReportPurpose,
  rsids: readonly number[], offset: number): Promise<{ data: ReportCall[] | null; error: unknown }> {
  const actor = await currentOwnUploadAccount();
  if (!actor) return { data: null, error: "unavailable" };
  const { data, error } = await db.rpc("read_own_report_calls_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: fileId,
    p_purpose: purpose, p_rsids: [...rsids], p_offset: offset,
  });
  const parsed = z.array(reportCall).max(1000).safeParse(data);
  if (error || !parsed.success || parsed.data.some(c => c.file_id !== fileId || !rsids.includes(c.rsid))) {
    return { data: null, error: "unavailable" };
  }
  return { data: parsed.data, error: null };
}
