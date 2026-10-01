import "server-only";

import { z } from "zod";
import { acknowledged } from "@/lib/family/tier2";
import { capturedSharedReportSourceSchema, type SharedReportState } from "@/lib/family/shared-report-results";
import { isFixtureSlug } from "@/components/reports/library";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPathBAccount, heldUploadRpc } from "./other-adult-upload-server";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const purpose = z.enum(["reports.monogenic", "reports.polygenic"]);
export const pathBReportMetadataSchema = z.object({
  subjectId: z.uuid(), label: z.string().min(1).max(200), direction: z.enum(["self", "uploader"]),
  purposes: z.array(purpose).min(1).max(2), receipt: hash,
}).strict().refine(row => new Set(row.purposes).size === row.purposes.length);
export type PathBReportMetadata = z.infer<typeof pathBReportMetadataSchema>;
const metadataRows = z.array(pathBReportMetadataSchema).max(100)
  .refine(rows => new Set(rows.map(row => row.subjectId)).size === rows.length);
const captureSchema = z.object({ metadata: pathBReportMetadataSchema,
  sources: z.array(capturedSharedReportSourceSchema).min(1).max(100), receipt: hash,
}).strict();
const denied = (): SharedReportState => ({ authorized: false, access: [], reports: [], sources: [], unavailableReports: [] });

/** Metadata only. The returned receipt remains server-side and cannot authorize
 * a result fetch. Every genetic read uses the actual current account/session. */
export async function listPathBReportMetadata(): Promise<PathBReportMetadata[]> {
  if (!isTestJurisdictionEnabled()) return [];
  const actor = await currentPathBAccount();
  if (!actor) return [];
  const response = await heldUploadRpc(createAdminClient(), "path_b_report_metadata_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: null, p_test_jurisdiction: true,
  });
  const parsed = metadataRows.safeParse(response.data);
  return response.error || !parsed.success ? [] : parsed.data;
}

/** Classify before any ordinary own-record loader can address a Path B source.
 * This query contains no genetic data or permission decision. */
export async function isPathBSubject(subjectId: string): Promise<boolean> {
  const response = await createAdminClient().from("adult_subject_drafts").select("id")
    .eq("subject_id", subjectId).eq("adult_flow", "path-b-subject-esignature").maybeSingle();
  // A failed classification cannot admit an ordinary reader.
  if (response.error) throw new Error("subject_unavailable");
  return response.data !== null;
}

/** Saved results only: never genotype re-resolution, legacy fallback or a
 * different file. Uploader capture starts after the session gate. The final
 * locked confirm is the last awaited operation before returning the projection. */
export async function loadPathBReportSnapshot(subjectId: string) {
  try {
    if (!isTestJurisdictionEnabled() || !z.uuid().safeParse(subjectId).success) throw new Error("unavailable");
    const actor = await currentPathBAccount();
    if (!actor) throw new Error("unavailable");
    const db = createAdminClient();
    const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId,
      p_subject_id: subjectId, p_test_jurisdiction: true };
    const metaResponse = await heldUploadRpc(db, "path_b_report_metadata_v1", args);
    if (metaResponse.error) throw new Error("unavailable");
    const metadata = metadataRows.parse(metaResponse.data);
    const selected = metadata.find(row => row.subjectId === subjectId);
    if (!selected || (selected.direction === "uploader" && !await acknowledged({ id: actor.accountId }))) throw new Error("unavailable");
    const response = await heldUploadRpc(db, "capture_path_b_report_results_v1", args);
    const capture = captureSchema.parse(response.data);
    if (response.error || capture.metadata.subjectId !== subjectId || capture.metadata.receipt !== selected.receipt
      || capture.sources.some(row => row.subjectId !== subjectId || !capture.metadata.purposes.includes(row.purpose)
        || row.reports.some(report => !report.catalogSnapshot))
      || new Set(capture.sources.map(row => `${row.purpose}:${row.fileId}`)).size !== capture.sources.length) throw new Error("unavailable");
    const state: SharedReportState = { ...denied(), authorized: true,
      access: capture.metadata.purposes.map(purpose => ({ purpose, kind: "canonical" })) };
    for (const source of capture.sources) {
      if (!state.sources.some(row => row.fileId === source.fileId)) state.sources.push(source.source);
      for (const report of source.reports) {
        if (isFixtureSlug(report.slug)) continue;
        state.reports.push({ fileId: source.fileId, subjectId, purpose: source.purpose,
          completedAt: new Date(source.completedAt).toISOString(),
          report: { ...report, catalogSnapshot: report.catalogSnapshot! } });
      }
    }
    const confirm = async (): Promise<SharedReportState> => {
      const now = await currentPathBAccount();
      if (!now || now.accountId !== actor.accountId || now.sessionId !== actor.sessionId
        || (selected.direction === "uploader" && !await acknowledged({ id: actor.accountId }))) return denied();
      const checked = await heldUploadRpc(db, "confirm_path_b_report_results_v1", { ...args, p_receipt: capture.receipt });
      return !checked.error && checked.data === true ? state : denied();
    };
    if (!(await confirm()).authorized) throw new Error("unavailable");
    return { ...state, confirm };
  } catch { return { ...denied(), confirm: async () => denied() }; }
}
