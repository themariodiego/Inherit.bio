import "server-only";
import { z } from "zod";
import type { Db } from "./load";
import { currentOwnUploadAccount } from "../uploads/own-upload-context";
import { capturedSharedReportSourceSchema, type SharedReportState } from "../family/shared-report-results";
import { isFixtureSlug } from "../../components/reports/library";

const optionsSchema = z.object({ subjectId: z.uuid(), fileId: z.uuid(), slug: z.string().min(1).max(200) }).strict();
const responseSchema = z.object({ source: capturedSharedReportSourceSchema,
  receipt: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const denied = (): SharedReportState => ({ authorized: false, access: [], reports: [], sources: [], unavailableReports: [] });

/** Exact own saved result, independent of Family comparison authority. Neither
 * missing source/catalog nor any failed final check permits raw reinterpretation.
 * The final confirmation RPC is the last awaited operation before serialization. */
export async function loadOwnStoredReportSnapshot(db: Db, input: { subjectId: string; fileId: string; slug: string }) {
  try {
    const options = optionsSchema.parse(input), actor = await currentOwnUploadAccount();
    if (!actor || isFixtureSlug(options.slug)) throw new Error("unavailable");
    const rpc = db.rpc.bind(db) as unknown as Rpc;
    const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: options.subjectId,
      p_file_id: options.fileId, p_slug: options.slug };
    const read = await rpc("own_captured_report_v1", { ...args, p_expected: null });
    const parsed = responseSchema.parse(read.data), source = parsed.source, report = source.reports[0];
    if (read.error || source.fileId !== options.fileId || source.subjectId !== options.subjectId || source.reports.length !== 1
      || report.slug !== options.slug || !report.catalogSnapshot) throw new Error("unavailable");
    const state: SharedReportState = { authorized: true, access: [{ purpose: source.purpose, kind: "canonical" }],
      reports: [{ fileId: source.fileId, subjectId: source.subjectId, purpose: source.purpose,
        completedAt: new Date(source.completedAt).toISOString(), report: { ...report, catalogSnapshot: report.catalogSnapshot } }],
      sources: [source.source], unavailableReports: [] };
    let closed = false;
    return { ...state, confirm: async (): Promise<SharedReportState> => {
      if (closed) return denied();
      try {
        const now = await currentOwnUploadAccount();
        if (now && now.accountId === actor.accountId && now.sessionId === actor.sessionId) {
          const current = await rpc("own_captured_report_v1", { ...args, p_expected: parsed.receipt });
          const checked = responseSchema.safeParse(current.data);
          if (!current.error && checked.success && JSON.stringify(checked.data) === JSON.stringify(parsed)) return state;
        }
      } catch { /* A denied capture stays closed, including after regrant. */ }
      closed = true; return denied();
    } };
  } catch { return { ...denied(), confirm: async () => denied() }; }
}
