import "server-only";
import { z } from "zod";
import { createAdminClient } from "../supabase/admin";
import { getPublishedTemplates } from "../genome/load";
import { resolveReportCalls, type ReportCall } from "../genome/report-calls";
import { resolveTemplate } from "../genome/reports";
import { computePrs } from "../genome/prs";
import { createPrsCallLookup } from "../genome/prs-call-lookup";
import { preparedReportSourceSchema, readOwnPreparedReportPages } from "../genome/prepared-source/report-call-pages";
import { createPreparedReportEvidenceBudget } from "../genome/prepared-source/report-evidence-budget";
import { ALL_PRS_SCORES } from "../genome/prs-data";
import { ownUploadJson } from "./own-upload-context";
import { subjectNormalizationReceipt, subjectSynchronousReportReceipt } from "./subject-upload-contract";
import { ownReportSnapshot } from "./own-report-token";
import type { ownReportReadyEnvelope } from "./own-report-ready-envelope";
import { reportCatalogTemplateSchema } from "../genome/report-catalog-snapshot";
import { computeOwnAncestryContent, CURRENT_OWN_ANCESTRY_PANEL, type OwnAncestryCall } from "./own-ancestry-content";

const REPORT_PURPOSES = ["reports.monogenic", "reports.polygenic"] as const;
const PURPOSES = [...REPORT_PURPOSES, "ancestry"] as const;
type Purpose = (typeof PURPOSES)[number];
const uuid = z.uuid().regex(/^[0-9a-f-]+$/), revision = z.number().int().positive().safe();
const authorization = z.object({ context: ownReportSnapshot, grantId: uuid, grantRevision: revision,
  sourceRevision: revision, sourceSha256: z.string().regex(/^[0-9a-f]{64}$/), normalizedAt: z.iso.datetime({ offset: true }), subjectId: uuid, preparedSource: preparedReportSourceSchema.optional(),
}).strict();
const ancestrySourceSchema = z.object({ fileId: uuid,
  fileType: z.enum(["vcf", "gvcf", "array_23andme", "array_ancestry", "array_myheritage", "array_ftdna"]),
  normalizedBuild: z.literal("GRCh38"), callEncoding: z.enum(["vcf-literal", "array-genotype"]),
}).strict();
const claimSchema = z.union([
  z.object({ status: z.literal("authorized"), claim: uuid, purpose: z.enum(REPORT_PURPOSES), authorization }).strict(),
  z.object({ status: z.literal("authorized"), claim: uuid, purpose: z.literal("ancestry"), authorization, source: ancestrySourceSchema }).strict(),
]);
const doneSchema = z.object({ status: z.literal("complete"), purpose: z.enum(PURPOSES) }).strict();
const absentSchema = z.object({ status: z.literal("not_selected") }).strict();
const callSchema = z.object({ file_id: uuid, rsid: z.number().int().positive().nullable(), chrom: z.number().int().min(1).max(25),
  pos: z.number().int().positive(), ref: z.string().nullable(), alt: z.string().nullable(), genotype: z.string(), usable: z.boolean().optional(),
}).strict();
type Operation = "begin" | "check" | "read-variants" | "read-observed" | "complete" | "fail" | "ready";
type Rpc = (name: "own_report_generation_with_mail_v1", args: { p_operation: Operation; p_account_id: string;
  p_session_id: string; p_file_id: string; p_purpose: Purpose; p_claim: string | null; p_payload: unknown }) =>
  PromiseLike<{ data: unknown; error: { code?: string } | null }>;
const unavailable = () => ownUploadJson({ error: "unavailable" }, 503);

/** Internal server execution shared by HTTP and preparation workers. The actor
 * must come from the caller's authenticated session, never a browser body.
 * Actor IDs select authority; they do not grant it: every begin/check/read/commit
 * goes through the existing session, consent, source and purpose RPC checks.
 * readyMailEnvelope only prepares encrypted metadata for that atomic RPC; it
 * must not send mail. This module does not enqueue or admit preparation jobs.
 */
export async function generateOwnReportResults({ actor, fileId, signal, readyMailEnvelope }: {
  actor: { accountId: string; sessionId: string };
  fileId: string;
  signal: AbortSignal;
  readyMailEnvelope: () => ReturnType<typeof ownReportReadyEnvelope>;
}) {
  if (!uuid.safeParse(actor.accountId).success || !uuid.safeParse(actor.sessionId).success
    || !uuid.safeParse(fileId).success || signal.aborted) return unavailable();
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return unavailable(); }
  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: fileId };
  let generated = 0, existing = 0;
  const completedPurposes: Purpose[] = [];
  let readyMail: Awaited<ReturnType<typeof ownReportReadyEnvelope>> | null = null;
  const envelope = async () => readyMail ??= await readyMailEnvelope();
  for (const purpose of PURPOSES) {
    let claim: z.infer<typeof claimSchema> | null = null;
    const call = (operation: Operation, payload: unknown = null) => rpc("own_report_generation_with_mail_v1", {
      ...args, p_operation: operation, p_purpose: purpose, p_claim: claim?.claim ?? null, p_payload: payload });
    try {
      const start = await call("begin"); if (start.error) return unavailable();
      if (absentSchema.safeParse(start.data).success) continue;
      const previous = doneSchema.safeParse(start.data);
      if (previous.success && previous.data.purpose === purpose) { existing++; completedPurposes.push(purpose); continue; }
      const parsed = claimSchema.safeParse(start.data);
      if (!parsed.success || parsed.data.purpose !== purpose) return unavailable();
      claim = parsed.data;
      const preparedSource = claim.authorization.preparedSource;
      const checkPreparedClaim = async (signal: AbortSignal) => {
        if (signal.aborted) throw new Error("unavailable");
        const pending = call("check") as ReturnType<Rpc> & {
          abortSignal?: (signal: AbortSignal) => ReturnType<Rpc>;
        };
        // The installed PostgREST builder supports abortSignal. A missing
        // cancellable transport must not silently bypass the page deadline.
        if (typeof pending.abortSignal !== "function") throw new Error("unavailable");
        const checked = await pending.abortSignal(signal), same = claimSchema.safeParse(checked.data);
        if (signal.aborted || checked.error || !same.success || JSON.stringify(same.data) !== JSON.stringify(claim))
          throw new Error("unavailable");
      };
      const preparedBudget = createPreparedReportEvidenceBudget();
      const preparedPages = async function* (loci: { chrom: number; pos: number }[]) {
        if (!preparedSource || !claim) throw new Error("unavailable");
        const pages = readOwnPreparedReportPages(actor, { fileId, subjectId: claim.authorization.subjectId,
          sourceRevision: claim.authorization.sourceRevision, sourceSha256: claim.authorization.sourceSha256,
          normalizedAt: claim.authorization.normalizedAt, preparedSource }, loci,
        { checkOperation: checkPreparedClaim, signal });
        for await (const page of pages) { preparedBudget.consume(page); yield page; }
      };
      if (claim.purpose === "ancestry") {
        const source = claim.source;
        const encoding = source.fileType === "vcf" || source.fileType === "gvcf" ? "vcf-literal" : "array-genotype";
        if (source.fileId !== fileId || source.callEncoding !== encoding) throw new Error("unavailable");
        const points = CURRENT_OWN_ANCESTRY_PANEL.markers.map(marker => ({ chrom: marker.chrom, pos: marker.pos38 }));
        const calls: OwnAncestryCall[] = [];
        const operation = encoding === "vcf-literal" ? "read-observed" : "read-variants";
        for (let index = 0; index < points.length; index += 200) {
          const loci = points.slice(index, index + 200);
          const requested = new Set(loci.map(point => `${point.chrom}:${point.pos}`));
          if (preparedSource) {
            if (encoding !== "vcf-literal") throw new Error("unavailable");
            for await (const page of preparedPages(loci)) {
              calls.push(...page.observations.map(({ call: row }) => ({ file_id: row.file_id,
                chrom: row.chrom, pos: row.pos, ref: row.ref, alt: row.alt, genotype: row.genotype, usable: row.usable! })));
            }
            continue;
          }
          for (let offset = 0; ; offset += 1000) {
            const response = await call(operation, { loci, offset });
            const rows = z.array(callSchema).max(1000).safeParse(response.data);
            if (response.error || !rows.success || rows.data.some(row => row.file_id !== fileId
              || !requested.has(`${row.chrom}:${row.pos}`) || (encoding === "vcf-literal" && typeof row.usable !== "boolean")))
              throw new Error("unavailable");
            calls.push(...rows.data.map(row => ({ file_id: row.file_id, chrom: row.chrom, pos: row.pos,
              ref: row.ref, alt: row.alt, genotype: row.genotype, usable: row.usable ?? true })));
            if (rows.data.length < 1000) break;
          }
        }
        const checked = await call("check"), same = claimSchema.safeParse(checked.data);
        if (checked.error || !same.success || JSON.stringify(same.data) !== JSON.stringify(claim)) throw new Error("unavailable");
        const ancestry = computeOwnAncestryContent({ source: { fileId, subjectId: claim.authorization.subjectId,
          normalizedBuild: source.normalizedBuild, callEncoding: encoding, sourceRevision: claim.authorization.sourceRevision,
          sourceSha256: claim.authorization.sourceSha256, normalizedAt: claim.authorization.normalizedAt },
          calls, panel: CURRENT_OWN_ANCESTRY_PANEL });
        const finished = await call("complete", { ancestry, readyMail: await envelope() });
        const done = doneSchema.safeParse(finished.data);
        if (finished.error || !done.success || done.data.purpose !== purpose) throw new Error("unavailable");
        generated++; completedPurposes.push(purpose);
        continue;
      }
      // Public reference templates are separate from genetic reads. The claim
      // selects a checked database source or the exact published object source.
      const templates = (await getPublishedTemplates(admin)).filter(template => purpose === "reports.monogenic"
        ? template.layer === "variant_call" : template.layer === "estimate");
      if (!templates.length) throw new Error("unavailable");
      const loci = new Map<string, { chrom: number; pos: number }>();
      for (const template of templates) for (const variant of template.variants) {
        loci.set(`${variant.chrom}:${variant.pos38}`, { chrom: variant.chrom, pos: variant.pos38 });
      }
      if (purpose === "reports.polygenic") for (const score of ALL_PRS_SCORES) for (const variant of score.variants) {
        loci.set(`${variant.chrom}:${variant.pos38}`, { chrom: variant.chrom, pos: variant.pos38 });
      }
      const points = [...loci.values()];
      const variants: ReportCall[] = [], observations: ReportCall[] = [];
      for (let index = 0; index < points.length; index += 200) {
        if (preparedSource) {
          for await (const page of preparedPages(points.slice(index, index + 200))) {
            variants.push(...page.variants.map(row => row.call));
            observations.push(...page.observations.map(row => row.call));
          }
          continue;
        }
        for (const operation of ["read-variants", "read-observed"] as const) {
          for (let offset = 0; ; offset += 1000) {
            const response = await call(operation, { loci: points.slice(index, index + 200), offset });
            const rows = z.array(callSchema).max(1000).safeParse(response.data);
            if (response.error || !rows.success || rows.data.some(row => row.file_id !== fileId)) throw new Error("unavailable");
            (operation === "read-variants" ? variants : observations).push(...rows.data);
            if (rows.data.length < 1000) break;
          }
        }
      }
      const checked = await call("check");
      const same = claimSchema.safeParse(checked.data);
      if (checked.error || !same.success || JSON.stringify(same.data) !== JSON.stringify(claim)) throw new Error("unavailable");
      const resolved = resolveReportCalls([...variants, ...observations], templates);
      const reports = templates.map(template => {
        const report = resolveTemplate(template, rsid => resolved.genotypes.get(rsid));
        // Materialize the selected interpretation, not a false "all reports"
        // flag. Public readers still recheck purpose before any serialization.
        return { slug: template.slug, covered: report.covered,
          catalogSnapshot: { schemaVersion: 1, template: reportCatalogTemplateSchema.parse(template) },
          variants: report.variants.map(row => ({ rsid: row.variant.rsid, outcome: row.outcome })),
          conflictingRsids: [...resolved.conflicts].filter(rsid => template.variants.some(v => v.rsid === rsid)) };
      });
      const lookup = createPrsCallLookup(variants, observations);
      const prs = purpose === "reports.polygenic" ? ALL_PRS_SCORES.map(score => {
        const result = computePrs(lookup, score);
        return { pgs_id: score.pgs_id, raw_score: result.raw, coverage: result.coverage, matched: result.matched };
      }) : [];
      const finished = await call("complete", { reports, prs, readyMail: await envelope() });
      const done = doneSchema.safeParse(finished.data);
      if (finished.error || !done.success || done.data.purpose !== purpose) throw new Error("unavailable");
      generated++; completedPurposes.push(purpose);
    } catch {
      if (claim) { try { await call("fail"); } catch { /* no sensitive error text */ } }
      return unavailable();
    }
  }
  // A concurrently withdrawn purpose cannot leave a fresh success receipt.
  for (const purpose of completedPurposes) {
    try {
      const result = await rpc("own_report_generation_with_mail_v1", { ...args, p_operation: "check", p_purpose: purpose, p_claim: null, p_payload: null });
      const checked = doneSchema.safeParse(result.data);
      if (result.error || !checked.success || checked.data.purpose !== purpose) return unavailable();
    } catch { return unavailable(); }
  }
  if (completedPurposes.length) {
    try {
      const notice = await rpc("own_report_generation_with_mail_v1", { ...args, p_operation: "ready",
        p_purpose: completedPurposes[0], p_claim: null, p_payload: await envelope() });
      if (notice.error || notice.data !== true) return unavailable();
    } catch { return unavailable(); }
  }
  return generated || existing
    ? ownUploadJson(subjectSynchronousReportReceipt.parse({ fileId, status: generated ? "processed" : "already_processed", analysisState: "active" }))
    : ownUploadJson(subjectNormalizationReceipt.parse({ fileId, status: "normalization_complete", analysisState: "not_generated" }));
}
