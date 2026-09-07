import "server-only";
import { z } from "zod";
import type { Db } from "../genome/load";
import type { InputSourceView } from "../genome/input-sources";
import { currentOwnUploadAccount } from "../uploads/own-upload-context";
import { familyCapability } from "./access";
import { capturedSharedReportSourceSchema, type SharedReportPurpose, type SharedReportResult } from "./shared-report-results";
import { isFixtureSlug } from "../../components/reports/library";

const purpose = z.enum(["reports.monogenic", "reports.polygenic"]);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const optionsSchema = z.object({ selfSubjectId: z.uuid(), counterparts: z.array(z.object({
  subjectId: z.uuid(), accountId: z.uuid(),
}).strict()).min(1).max(100), purposes: z.array(purpose).min(1).max(2) }).strict();
const pageSchema = z.object({ subjectId: z.uuid(), purpose, kind: z.enum(["own", "shared"]),
  access: z.enum(["canonical", "legacy-only", "not-shared"]), legacyFileIds: z.array(z.uuid()),
  hasPreparedSource: z.boolean(), sources: z.array(capturedSharedReportSourceSchema).max(100),
  nextAfter: z.uuid().nullable(), jointReceipt: hash, pageReceipt: hash,
}).strict();
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export interface HealthPictureOptions {
  selfSubjectId: string; counterparts: readonly { subjectId: string; accountId: string }[];
  purposes: readonly SharedReportPurpose[];
}
export interface HealthPictureColumn {
  subjectId: string; kind: "own" | "shared";
  access: { purpose: SharedReportPurpose; kind: "canonical" | "legacy-only" | "not-shared";
    hasPreparedSource: boolean; hasCompletedSource: boolean }[];
  reports: SharedReportResult[]; sources: InputSourceView[]; legacyFileIds: string[];
  unavailableReports: { fileId: string; purpose: SharedReportPurpose; slug: string }[];
}
export interface HealthPictureState { authorized: boolean; columns: HealthPictureColumn[] }
export interface HealthPictureSnapshot { state: HealthPictureState; confirm(): Promise<HealthPictureState> }
const denied = (): HealthPictureState => ({ authorized: false, columns: [] });

export async function prepareHealthPictureGrant(db: Db, subjectId: string, recipientAccountId: string): Promise<string | null> {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor || !z.uuid().safeParse(subjectId).success || !z.uuid().safeParse(recipientAccountId).success) return null;
    for (const capability of ["third_party_adult_analysis", "family_heritability"] as const)
      if ((await familyCapability(actor.accountId, [recipientAccountId], capability)).status !== "permitted") return null;
    const response = await (db.rpc.bind(db) as unknown as Rpc)("health_picture_grant_presentation_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId,
      p_recipient_account_id: recipientAccountId,
    });
    const parsed = hash.safeParse(response.data);
    return !response.error && parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** A server-local capture, not a browser scope token. `canonical` identifies the
 * permitted reader path, not a completed result: only hasCompletedSource/reports
 * assert completion. No prepared source means "No prepared file", not no file.
 * A not-shared purpose MUST NOT dispatch any legacy computation. Other authorized
 * purposes may use only legacyFileIds with the restrictive legacy readers.
 * Call confirm after every other await and render its returned state directly. */
export async function loadHealthPictureSnapshot(db: Db, input: HealthPictureOptions): Promise<HealthPictureSnapshot> {
  try {
    const options = optionsSchema.parse(input), actor = await currentOwnUploadAccount();
    const subjectIds = [options.selfSubjectId, ...options.counterparts.map(c => c.subjectId)].sort();
    const accounts = options.counterparts.map(c => c.accountId).sort();
    if (!actor || new Set(subjectIds).size !== subjectIds.length || new Set(accounts).size !== accounts.length
      || accounts.includes(actor.accountId) || new Set(options.purposes).size !== options.purposes.length) throw new Error("unavailable");
    options.counterparts.sort((a, b) => a.subjectId.localeCompare(b.subjectId)); options.purposes.sort();
    const allowed = async () => {
      const current = await currentOwnUploadAccount();
      if (!current || current.accountId !== actor.accountId || current.sessionId !== actor.sessionId) return false;
      for (const capability of ["third_party_adult_analysis", "family_heritability"] as const)
        if ((await familyCapability(actor.accountId, accounts, capability)).status !== "permitted") return false;
      return true;
    };
    if (!await allowed()) throw new Error("unavailable");
    const rpc = db.rpc.bind(db) as unknown as Rpc;
    const base = { p_account_id: actor.accountId, p_session_id: actor.sessionId,
      p_self_subject_id: options.selfSubjectId, p_counterparts: options.counterparts };
    const expected: { subjectId: string; purpose: SharedReportPurpose; afterFile: string | null; receipt: string }[] = [];
    const state: HealthPictureState = { authorized: true, columns: [] };
    let jointReceipt: string | null = null;
    const fileSubjects = new Map<string, string>();
    for (const subjectId of subjectIds) {
      const column: HealthPictureColumn = { subjectId, kind: subjectId === options.selfSubjectId ? "own" : "shared",
        access: [], reports: [], sources: [], legacyFileIds: [], unavailableReports: [] };
      let legacyCapture: string | null = null;
      for (const selected of options.purposes) {
        let after: string | null = null, accessCapture: string | null = null;
        const seen = new Set<string>();
        do {
          if (expected.length >= 1000) throw new Error("unavailable");
          const response = await rpc("health_picture_results_v1", { ...base,
            p_subject_id: subjectId, p_purpose: selected, p_after_file: after });
          const page = pageSchema.parse(response.data);
          const legacy = JSON.stringify([...page.legacyFileIds].sort());
          const access = JSON.stringify([page.access, page.hasPreparedSource]);
          if (response.error || page.subjectId !== subjectId || page.purpose !== selected || page.kind !== column.kind
            || (jointReceipt !== null && page.jointReceipt !== jointReceipt)
            || (legacyCapture !== null && legacyCapture !== legacy) || new Set(page.legacyFileIds).size !== page.legacyFileIds.length
            || (accessCapture !== null && accessCapture !== access)
            || (page.access !== "canonical" && (page.sources.length > 0 || page.nextAfter !== null))
            || (page.sources.length > 0 && !page.hasPreparedSource)
            || (page.nextAfter !== null && ((after !== null && page.nextAfter <= after)
              || page.sources.some(s => s.fileId > page.nextAfter!)))) throw new Error("unavailable");
          jointReceipt = page.jointReceipt; legacyCapture = legacy; accessCapture = access;
          column.legacyFileIds = [...page.legacyFileIds];
          let accessState = column.access.find(a => a.purpose === selected);
          if (!accessState) {
            accessState = { purpose: selected, kind: page.access, hasPreparedSource: page.hasPreparedSource, hasCompletedSource: false };
            column.access.push(accessState);
          }
          for (const id of page.legacyFileIds) {
            if (fileSubjects.has(id) && fileSubjects.get(id) !== subjectId) throw new Error("unavailable");
            fileSubjects.set(id, subjectId);
          }
          for (const source of page.sources) {
            if (source.subjectId !== subjectId || source.purpose !== selected || seen.has(source.fileId)
              || page.legacyFileIds.includes(source.fileId) || (after !== null && source.fileId <= after)
              || (fileSubjects.has(source.fileId) && fileSubjects.get(source.fileId) !== subjectId)) throw new Error("unavailable");
            seen.add(source.fileId); fileSubjects.set(source.fileId, subjectId); accessState.hasCompletedSource = true;
            const previous = column.sources.find(s => s.fileId === source.fileId);
            if (previous && JSON.stringify(previous) !== JSON.stringify(source.source)) throw new Error("unavailable");
            if (!previous) column.sources.push(source.source);
            for (const report of source.reports) {
              if (isFixtureSlug(report.slug)) continue;
              if (!report.catalogSnapshot) column.unavailableReports.push({ fileId: source.fileId, purpose: selected, slug: report.slug });
              else column.reports.push({ fileId: source.fileId, subjectId, purpose: selected,
                completedAt: new Date(source.completedAt).toISOString(), report: { ...report, catalogSnapshot: report.catalogSnapshot } });
            }
          }
          expected.push({ subjectId, purpose: selected, afterFile: after, receipt: page.pageReceipt });
          after = page.nextAfter;
        } while (after !== null);
      }
      column.reports.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)
        || a.fileId.localeCompare(b.fileId) || a.report.slug.localeCompare(b.report.slug));
      state.columns.push(column);
    }
    if (!await allowed()) throw new Error("unavailable");
    let closed = false;
    return { state, confirm: async () => {
      if (closed) return denied();
      try {
        if (await allowed()) {
          // LAST await: one transaction holds all endpoint, source and purpose
          // locks through ALL columns and pages, including empty/not-shared ones.
          const response = await rpc("confirm_health_picture_results_v1", { ...base, p_purposes: options.purposes, p_expected: expected });
          if (!response.error && response.data === true) return state;
        }
      } catch { /* No canonical denial is converted to a legacy fallback. */ }
      closed = true; return denied();
    } };
  } catch { return { state: denied(), confirm: async () => denied() }; }
}
