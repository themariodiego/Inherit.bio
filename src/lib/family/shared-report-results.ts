import "server-only";
import { z } from "zod";
import type { Db } from "../genome/load";
import type { InputSourceView } from "../genome/input-sources";
import { reportCatalogSnapshotSchema } from "../genome/report-catalog-snapshot";
import { currentOwnUploadAccount } from "../uploads/own-upload-context";
import { familyCapability } from "./access";
import { isFixtureSlug } from "../../components/reports/library";

const purpose = z.enum(["reports.monogenic", "reports.polygenic"]);
export type SharedReportPurpose = z.infer<typeof purpose>;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative().safe();
const sourceSchema = z.object({ fileId: z.uuid(), fileType: z.enum([
  "vcf", "gvcf", "array_23andme", "array_ancestry", "array_myheritage", "array_ftdna",
]), processedAt: z.iso.datetime({ offset: true }), snapshot: z.object({
  sourceBuild: z.enum(["GRCh37", "GRCh38"]), buildBasis: z.enum(["source-declared", "format-assumption"]),
  targetBuild: z.literal("GRCh38"), variantRowsMapped: count, variantRowsUnmapped: count,
  counts: z.object({ called: count, noCall: count, unsupported: count, failedFilter: count, blocks: count,
    singleSample: z.boolean(), buildClaim: z.boolean(),
  }).strict().refine(v => Number.isSafeInteger(v.called + v.noCall)),
}).strict().nullable() }).strict();
const outcome = z.discriminatedUnion("status", [
  z.object({ status: z.literal("genotyped"), genotype: z.string(), interpretation: z.string(), strandFlipped: z.boolean() }).strict(),
  z.object({ status: z.literal("unrecognized"), genotype: z.string() }).strict(),
  z.object({ status: z.literal("no-call") }).strict(), z.object({ status: z.literal("not-covered") }).strict(),
]);
const storedReport = z.object({ slug: z.string(), covered: z.boolean(),
  variants: z.array(z.object({ rsid: z.number().int().positive().safe(), outcome }).strict()).max(1000),
  conflictingRsids: z.array(z.number().int().positive().safe()).max(1000),
  catalogSnapshot: reportCatalogSnapshotSchema.optional(),
}).strict().superRefine((report, ctx) => {
  const template = report.catalogSnapshot?.template;
  if (template && (template.slug !== report.slug || template.variants.length !== report.variants.length
    || template.variants.some((v, i) => v.rsid !== report.variants[i].rsid)
    || report.variants.some((v, i) => v.outcome.status === "genotyped"
      && template.variants[i]?.interpretations[v.outcome.genotype] !== v.outcome.interpretation)
    || report.conflictingRsids.some(id => !template.variants.some(v => v.rsid === id))))
    ctx.addIssue({ code: "custom", message: "Captured report mismatch" });
});
export const capturedSharedReportSourceSchema = z.object({ fileId: z.uuid(), subjectId: z.uuid(), purpose,
  completedAt: z.iso.datetime({ offset: true }), source: sourceSchema,
  reports: z.array(storedReport).max(10000), receipt: hash,
}).strict().refine(s => s.source.fileId === s.fileId && s.reports.every(r => !r.catalogSnapshot
  || r.catalogSnapshot.template.layer === (s.purpose === "reports.monogenic" ? "variant_call" : "estimate")));
const basePage = z.object({ pageReceipt: hash, authority: hash, ownerAccountId: z.uuid(), subjectId: z.uuid(), purpose,
  legacyOnly: z.boolean(), nextAfter: z.uuid().nullable() });
const contentPage = basePage.extend({ sources: z.array(capturedSharedReportSourceSchema).max(100) }).strict();
const readinessPage = basePage.extend({ sources: z.array(z.object({ fileId: z.uuid(), receipt: hash,
  hasReports: z.boolean() }).strict()).max(100) }).strict();

type StoredReport = z.infer<typeof storedReport>;
export interface SharedReportResult {
  fileId: string; subjectId: string; purpose: SharedReportPurpose; completedAt: string;
  report: StoredReport & { catalogSnapshot: z.infer<typeof reportCatalogSnapshotSchema> };
}
export interface SharedReportAccess { purpose: SharedReportPurpose; kind: "canonical" | "legacy-only" }
export interface SharedReportState {
  authorized: boolean; access: SharedReportAccess[]; reports: SharedReportResult[]; sources: InputSourceView[];
  unavailableReports: { fileId: string; purpose: SharedReportPurpose; slug: string }[];
}
export interface SharedReportReadiness { authorized: boolean; access: SharedReportAccess[]; hasReports: boolean }
export interface SharedReportOptions {
  subjectId: string; counterpartAccountId: string; purposes: readonly SharedReportPurpose[];
}
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const denied = (): SharedReportState => ({ authorized: false, access: [], reports: [], sources: [], unavailableReports: [] });
const deniedReadiness = (): SharedReportReadiness => ({ authorized: false, access: [], hasReports: false });

/** Signed presentation carries only a digest of the DB-owned endpoint snapshot.
 * Its versioned commit rechecks the snapshot under locks before any grant write. */
export async function prepareSharedReportGrant(db: Db, subjectId: string, recipientAccountId: string): Promise<string | null> {
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor || (await familyCapability(actor.accountId, [recipientAccountId], "third_party_adult_analysis")).status !== "permitted") return null;
    const { data, error } = await (db.rpc.bind(db) as unknown as Rpc)("family_report_grant_presentation_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: subjectId, p_recipient_account_id: recipientAccountId,
    });
    const parsed = hash.safeParse(data);
    return !error && parsed.success ? parsed.data : null;
  } catch { return null; }
}

async function capture(db: Db, options: SharedReportOptions, mode: "content" | "readiness") {
  const actor = await currentOwnUploadAccount();
  if (!actor || !z.uuid().safeParse(options.subjectId).success || !z.uuid().safeParse(options.counterpartAccountId).success
    || actor.accountId === options.counterpartAccountId || !options.purposes.length
    || options.purposes.some(p => !purpose.safeParse(p).success)) throw new Error("unavailable");
  const allowed = async () => (await familyCapability(actor.accountId, [options.counterpartAccountId], "third_party_adult_analysis")).status === "permitted";
  const rpc = db.rpc.bind(db) as unknown as Rpc;
  async function read() {
    if (!await allowed()) throw new Error("unavailable");
    const content: z.infer<typeof contentPage>[] = [], readiness: z.infer<typeof readinessPage>[] = [];
    for (const selected of [...new Set(options.purposes)].sort()) {
      let after: string | null = null, expectedAuthority: string | null = null;
      const seen = new Set<string>();
      do {
        const response = await rpc("family_shared_report_results_v1", { p_account_id: actor!.accountId,
          p_session_id: actor!.sessionId, p_subject_id: options.subjectId, p_purpose: selected, p_after_file: after, p_mode: mode });
        const parsed = (mode === "content" ? contentPage : readinessPage).safeParse(response.data);
        if (response.error || !parsed.success) throw new Error("unavailable");
        const page = parsed.data;
        if (page.subjectId !== options.subjectId || page.ownerAccountId !== options.counterpartAccountId || page.purpose !== selected
          || (expectedAuthority && expectedAuthority !== page.authority) || (page.legacyOnly && page.sources.length)
          || page.sources.some(s => seen.has(s.fileId) || (after !== null && s.fileId <= after))
          || (page.nextAfter !== null && (page.nextAfter === after || (after !== null && page.nextAfter <= after)
            || page.sources.some(s => s.fileId > page.nextAfter!)))) throw new Error("unavailable");
        for (const source of page.sources) {
          if (seen.has(source.fileId)) throw new Error("unavailable");
          seen.add(source.fileId);
          if ("subjectId" in source && (source.subjectId !== options.subjectId || source.purpose !== selected)) throw new Error("unavailable");
        }
        expectedAuthority = page.authority;
        if (mode === "content") content.push(contentPage.parse(page)); else readiness.push(readinessPage.parse(page));
        after = page.nextAfter;
      } while (after !== null);
    }
    // Resolve the current session again, as well as jurisdictions, after the
    // last content read. No caller-supplied account/session or cached scope.
    const now = await currentOwnUploadAccount();
    if (!now || now.accountId !== actor!.accountId || now.sessionId !== actor!.sessionId || !await allowed()) throw new Error("unavailable");
    return { content, readiness };
  }
  const captured = await read();
  const expected: { purpose: SharedReportPurpose; afterFile: string | null; receipt: string }[] = [];
  let previous: SharedReportPurpose | null = null, afterFile: string | null = null;
  for (const page of mode === "content" ? captured.content : captured.readiness) {
    if (page.purpose !== previous) afterFile = null;
    expected.push({ purpose: page.purpose, afterFile, receipt: page.pageReceipt });
    previous = page.purpose; afterFile = page.nextAfter;
  }
  const checkScope = async () => {
    const now = await currentOwnUploadAccount();
    return Boolean(now && now.accountId === actor.accountId && now.sessionId === actor.sessionId && await allowed());
  };
  return { captured, expected, actor, rpc, checkScope, confirm: async () => {
    if (!await checkScope()) return false;
    // This is deliberately the LAST awaited operation before returning the
    // capture: one locked transaction checks every page/source, including empty
    // captures. Session/jurisdiction work must not follow this boundary.
    const response = await rpc("confirm_family_shared_report_results_v1", { p_account_id: actor.accountId,
      p_session_id: actor.sessionId, p_subject_id: options.subjectId, p_mode: mode, p_expected: expected });
    return !response.error && response.data === true;
  } };
}

/** No legacy loader is called here. The caller may use an independently valid
 * legacy branch under either authorized access kind; legacy-only never permits
 * modern sources. Hard denial never permits a fallback. All receipts,
 * grants, owner IDs, hashes and source manifests remain inside this closure. */
export async function loadSharedReportSnapshot(db: Db, options: SharedReportOptions) {
  try {
    const { captured, confirm } = await capture(db, options, "content");
    const state: SharedReportState = { ...denied(), authorized: true };
    for (const page of captured.content) {
      if (!state.access.some(a => a.purpose === page.purpose)) state.access.push({ purpose: page.purpose, kind: page.legacyOnly ? "legacy-only" : "canonical" });
      for (const source of page.sources) {
        if (!state.sources.some(s => s.fileId === source.fileId)) state.sources.push(source.source);
        for (const report of source.reports) {
          if (isFixtureSlug(report.slug)) continue;
          if (!report.catalogSnapshot) {
            state.unavailableReports.push({ fileId: source.fileId, purpose: source.purpose, slug: report.slug });
          } else state.reports.push({ fileId: source.fileId, subjectId: source.subjectId, purpose: source.purpose,
            completedAt: new Date(source.completedAt).toISOString(), report: { ...report, catalogSnapshot: report.catalogSnapshot } });
        }
      }
    }
    state.reports.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || a.fileId.localeCompare(b.fileId) || a.report.slug.localeCompare(b.report.slug));
    let closed = false;
    return { ...state, confirm: async (): Promise<SharedReportState> => {
      if (closed) return denied();
      try {
        if (await confirm()) return state;
      } catch { /* Exact receipt changed or an authority check refused. */ }
      closed = true; return denied();
    } };
  } catch { return { ...denied(), confirm: async () => denied() }; }
}

/** Before Tier-2 acknowledgement the RPC selects metadata mode: no outcome,
 * genotype, catalog or source provenance is transferred to the application. */
export type SharedReportReadinessSnapshot = SharedReportReadiness & { confirm(): Promise<SharedReportReadiness> };
const readinessCaptures = new WeakMap<SharedReportReadinessSnapshot, {
  capture: Awaited<ReturnType<typeof capture>>; options: SharedReportOptions; state: SharedReportReadiness;
  close(): void; isClosed(): boolean;
}>();
export async function loadSharedReportReadiness(db: Db, options: SharedReportOptions): Promise<SharedReportReadinessSnapshot> {
  try {
    const current = await capture(db, options, "readiness");
    const { captured, confirm } = current;
    const state: SharedReportReadiness = { authorized: true, access: [], hasReports: false };
    for (const page of captured.readiness) {
      if (!state.access.some(a => a.purpose === page.purpose)) state.access.push({ purpose: page.purpose, kind: page.legacyOnly ? "legacy-only" : "canonical" });
      state.hasReports ||= page.sources.some(s => s.hasReports);
    }
    let closed = false;
    const snapshot = { ...state, confirm: async (): Promise<SharedReportReadiness> => {
      if (closed) return deniedReadiness();
      try { if (await confirm()) return state; } catch { /* Deny. */ }
      closed = true; return deniedReadiness();
    } };
    readinessCaptures.set(snapshot, { capture: current, options, state, close: () => { closed = true; }, isClosed: () => closed });
    return snapshot;
  } catch { return { ...deniedReadiness(), confirm: async () => deniedReadiness() }; }
}

/** One final transaction for all Family cards. These objects are server-local;
 * callers cannot supply serialized receipts or turn a denied object into proof. */
export async function confirmSharedReportReadiness(snapshots: readonly SharedReportReadinessSnapshot[]): Promise<SharedReportReadiness[]> {
  if (!snapshots.length) return [];
  const items = snapshots.map(snapshot => readinessCaptures.get(snapshot));
  const refuse = () => { for (const item of items) item?.close(); return snapshots.map(deniedReadiness); };
  try {
    const first = items[0];
    if (!first || items.length > 100) return refuse();
    for (const item of items) {
      if (!item || item.isClosed() || item.capture.actor.accountId !== first.capture.actor.accountId
        || item.capture.actor.sessionId !== first.capture.actor.sessionId || !await item.capture.checkScope()) return refuse();
    }
    // No await follows this call. All successful inner row locks live through
    // the outer DB transaction, including while another adult is checked.
    const response = await first.capture.rpc("confirm_family_shared_readiness_v1", {
      p_account_id: first.capture.actor.accountId, p_session_id: first.capture.actor.sessionId,
      p_checks: items.map(item => ({ subjectId: item!.options.subjectId, expected: item!.capture.expected })),
    });
    return !response.error && response.data === true ? items.map(item => item!.state) : refuse();
  } catch { return refuse(); }
}
