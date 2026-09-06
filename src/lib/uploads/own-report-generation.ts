import "server-only";
import { z } from "zod";
import { hasEmptyRequestBody } from "../empty-request-body";
import { createAdminClient } from "../supabase/admin";
import { getPublishedTemplates } from "../genome/load";
import { resolveReportCalls, type ReportCall } from "../genome/report-calls";
import { resolveTemplate } from "../genome/reports";
import { computePrs } from "../genome/prs";
import { ALL_PRS_SCORES } from "../genome/prs-data";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";
import { subjectNormalizationReceipt, subjectSynchronousReportReceipt } from "./subject-upload-contract";
import { ownReportSnapshot } from "./own-report-token";

const PURPOSES = ["reports.monogenic", "reports.polygenic"] as const;
type Purpose = (typeof PURPOSES)[number];
const uuid = z.uuid().regex(/^[0-9a-f-]+$/), revision = z.number().int().positive().safe();
const authorization = z.object({ context: ownReportSnapshot, grantId: uuid, grantRevision: revision,
  sourceRevision: revision, sourceSha256: z.string().regex(/^[0-9a-f]{64}$/), normalizedAt: z.iso.datetime({ offset: true }), subjectId: uuid,
}).strict();
const claimSchema = z.object({ status: z.literal("authorized"), claim: uuid, purpose: z.enum(PURPOSES), authorization }).strict();
const doneSchema = z.object({ status: z.literal("complete"), purpose: z.enum(PURPOSES) }).strict();
const absentSchema = z.object({ status: z.literal("not_selected") }).strict();
const callSchema = z.object({ file_id: uuid, rsid: z.number().int().positive().nullable(), chrom: z.number().int().min(1).max(25),
  pos: z.number().int().positive(), ref: z.string().nullable(), alt: z.string().nullable(), genotype: z.string(), usable: z.boolean().optional(),
}).strict();
type Operation = "begin" | "check" | "read-variants" | "read-observed" | "complete" | "fail";
type Rpc = (name: "own_report_generation_v1", args: { p_operation: Operation; p_account_id: string;
  p_session_id: string; p_file_id: string; p_purpose: Purpose; p_claim: string | null; p_payload: unknown }) =>
  PromiseLike<{ data: unknown; error: { code?: string } | null }>;
const unavailable = () => ownUploadJson({ error: "unavailable" }, 503);

/** The browser never chooses a weaker analytic operation. Each supported
 * purpose is resolved independently from the live canonical consent pair. */
export async function generateOwnReports(request: Request, fileId: string) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") !== "same-origin") {
    return ownUploadJson({ error: "forbidden" }, 403);
  }
  if (new URL(request.url).search || !uuid.safeParse(fileId).success || !(await hasEmptyRequestBody(request))) {
    return ownUploadJson({ error: "invalid_request" }, 422);
  }
  let actor: Awaited<ReturnType<typeof currentOwnUploadAccount>>, admin: ReturnType<typeof createAdminClient>;
  try { actor = await currentOwnUploadAccount(); admin = createAdminClient(); } catch { return unavailable(); }
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_file_id: fileId };
  let generated = 0, existing = 0;
  const completedPurposes: Purpose[] = [];
  for (const purpose of PURPOSES) {
    let claim: z.infer<typeof claimSchema> | null = null;
    const call = (operation: Operation, payload: unknown = null) => rpc("own_report_generation_v1", {
      ...args, p_operation: operation, p_purpose: purpose, p_claim: claim?.claim ?? null, p_payload: payload });
    try {
      const start = await call("begin"); if (start.error) return unavailable();
      if (absentSchema.safeParse(start.data).success) continue;
      const previous = doneSchema.safeParse(start.data);
      if (previous.success && previous.data.purpose === purpose) { existing++; completedPurposes.push(purpose); continue; }
      const parsed = claimSchema.safeParse(start.data);
      if (!parsed.success || parsed.data.purpose !== purpose) return unavailable();
      claim = parsed.data;
      // Published templates are public reference material; actual genetic reads
      // happen exclusively through the checked, file-bound RPC below.
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
          variants: report.variants.map(row => ({ rsid: row.variant.rsid, outcome: row.outcome })),
          conflictingRsids: [...resolved.conflicts].filter(rsid => template.variants.some(v => v.rsid === rsid)) };
      });
      const lookup = new Map(variants.map(row => [`${row.chrom}:${row.pos}`, { genotype: row.genotype, ref: row.ref, alt: row.alt }]));
      // Keep disputed, filtered and missing calls out of score matching too.
      const unusablePositions = new Set<string>();
      for (const row of observations) {
        const key = `${row.chrom}:${row.pos}`, prior = lookup.get(key);
        if (row.usable === false || row.genotype === "--" || (prior && prior.genotype !== row.genotype)) unusablePositions.add(key);
        else if (!prior) lookup.set(key, { genotype: row.genotype, ref: row.ref, alt: row.alt });
      }
      for (const key of unusablePositions) lookup.delete(key);
      const prs = purpose === "reports.polygenic" ? ALL_PRS_SCORES.map(score => {
        const result = computePrs(lookup, score);
        return { pgs_id: score.pgs_id, raw_score: result.raw, coverage: result.coverage, matched: result.matched };
      }) : [];
      const finished = await call("complete", { reports, prs });
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
      const result = await rpc("own_report_generation_v1", { ...args, p_operation: "check", p_purpose: purpose, p_claim: null, p_payload: null });
      const checked = doneSchema.safeParse(result.data);
      if (result.error || !checked.success || checked.data.purpose !== purpose) return unavailable();
    } catch { return unavailable(); }
  }
  return generated || existing
    ? ownUploadJson(subjectSynchronousReportReceipt.parse({ fileId, status: generated ? "processed" : "already_processed", analysisState: "active" }))
    : ownUploadJson(subjectNormalizationReceipt.parse({ fileId, status: "normalization_complete", analysisState: "not_generated" }));
}
