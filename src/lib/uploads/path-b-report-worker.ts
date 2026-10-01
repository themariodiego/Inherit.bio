import "server-only";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { resolveReportCalls, type ReportCall } from "../genome/report-calls";
import { resolveTemplate } from "../genome/reports";
import { reportCatalogTemplateSchema } from "../genome/report-catalog-snapshot";
import { computePrs } from "../genome/prs";
import { createPrsCallLookup } from "../genome/prs-call-lookup";
import { ALL_PRS_SCORES } from "../genome/prs-data";

const purpose = z.enum(["reports.monogenic", "reports.polygenic"]);
const revision = z.number().int().positive().safe();
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const claimSchema = z.object({ jobId: z.uuid(), claim: z.uuid(), claimExpiresAt: z.iso.datetime({ offset: true }),
  fileId: z.uuid(), subjectId: z.uuid(), purpose, bindingRevision: revision, sourceRevision: revision,
  sourceSha256: sha, normalizedAt: z.iso.datetime({ offset: true }),
  computationRevision: z.string().regex(/^path-b-reports-v1:[0-9a-f]{64}$/), authoritySha256: sha,
}).strict();
const callSchema = z.object({ file_id: z.uuid(), rsid: z.number().int().positive().safe().nullable(),
  chrom: z.number().int().min(1).max(25), pos: z.number().int().positive().safe(),
  ref: z.string().max(1000).nullable(), alt: z.string().max(1000).nullable(),
  genotype: z.string().max(64), usable: z.boolean().optional(),
}).strict();
type Operation = "claim" | "check" | "read-variants" | "read-observed" | "stage" | "complete" | "fail";
export type PathBReportRpc = (args: { p_operation: Operation; p_job_id: string | null;
  p_claim_hash: string; p_claim: string | null; p_payload: unknown; p_test_jurisdiction: true },
  signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
const unavailable = () => new Error("path_b_report_unavailable");

/** One finite, queued TEST-LOCAL operation. Public templates and existing pure
 * report arithmetic are reused; every genetic byte comes from the dedicated
 * current-binding RPC. This never calls own-report execution or supplies an
 * account/session selected after the person signed their purpose grant.
 */
export async function runPathBReportWorker({ testJurisdiction, signal, rpc, loadTemplates }: {
  testJurisdiction: boolean; signal: AbortSignal; rpc: PathBReportRpc;
  loadTemplates: (signal: AbortSignal) => Promise<unknown>;
}): Promise<{ status: "idle" } | { status: "complete"; purpose: z.infer<typeof purpose> }> {
  if (!testJurisdiction || signal.aborted) throw unavailable();
  const hash = randomBytes(32).toString("hex");
  let claim: z.infer<typeof claimSchema> | null = null;
  let boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const call = async (operation: Operation, payload: unknown = null, callSignal = boundedSignal) => {
    if (callSignal.aborted) throw unavailable();
    const response = await rpc({ p_operation: operation, p_job_id: claim?.jobId ?? null,
      p_claim_hash: hash, p_claim: claim?.claim ?? null, p_payload: payload, p_test_jurisdiction: true }, callSignal);
    if (callSignal.aborted || response.error) throw unavailable();
    return response.data;
  };
  const check = async () => {
    const current = claimSchema.safeParse(await call("check"));
    if (!current.success || !isDeepStrictEqual(current.data, claim)) throw unavailable();
  };
  try {
    const start = await call("claim");
    if (start === null) return { status: "idle" };
    claim = claimSchema.parse(start);
    const remaining = Date.parse(claim.claimExpiresAt) - Date.now();
    if (remaining <= 0 || remaining > 300_000) throw unavailable();
    boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
    await check();
    const publicRows = z.array(reportCatalogTemplateSchema).max(1000).parse(await loadTemplates(boundedSignal));
    const templates = publicRows.filter(template => template.layer ===
      (claim!.purpose === "reports.monogenic" ? "variant_call" : "estimate"));
    if (new Set(templates.map(template => template.slug)).size !== templates.length) throw unavailable();
    await check();
    const pointsByKey = new Map<string, { chrom: number; pos: number }>();
    for (const template of templates) for (const variant of template.variants) {
      pointsByKey.set(`${variant.chrom}:${variant.pos38}`, { chrom: variant.chrom, pos: variant.pos38 });
    }
    if (claim.purpose === "reports.polygenic") for (const score of ALL_PRS_SCORES) for (const variant of score.variants) {
      pointsByKey.set(`${variant.chrom}:${variant.pos38}`, { chrom: variant.chrom, pos: variant.pos38 });
    }
    if (pointsByKey.size > 100_000) throw unavailable();
    const points = [...pointsByKey.values()], variants: ReportCall[] = [], observations: ReportCall[] = [];
    let recordCount = 0, byteCount = 0;
    for (let index = 0; index < points.length; index += 200) {
      const loci = points.slice(index, index + 200), requested = new Set(loci.map(point => `${point.chrom}:${point.pos}`));
      for (const operation of ["read-variants", "read-observed"] as const) {
        for (let offset = 0; ; offset += 1000) {
          await check();
          const response = await call(operation, { loci, offset });
          const rows = z.array(callSchema).max(1000).parse(response);
          recordCount += rows.length; byteCount += Buffer.byteLength(JSON.stringify(response));
          if (recordCount > 100_000 || byteCount > 16_000_000 || rows.some(row => row.file_id !== claim!.fileId
            || !requested.has(`${row.chrom}:${row.pos}`) || (operation === "read-observed" && typeof row.usable !== "boolean")))
            throw unavailable();
          await check();
          (operation === "read-variants" ? variants : observations).push(...rows);
          if (rows.length < 1000) break;
        }
      }
    }
    const resolved = resolveReportCalls([...variants, ...observations], templates);
    const reports = templates.map(template => {
      const report = resolveTemplate(template, rsid => resolved.genotypes.get(rsid));
      return { slug: template.slug, covered: report.covered, catalogSnapshot: { schemaVersion: 1, template },
        variants: report.variants.map(row => ({ rsid: row.variant.rsid, outcome: row.outcome })),
        conflictingRsids: [...resolved.conflicts].filter(rsid => template.variants.some(variant => variant.rsid === rsid)) };
    });
    const lookup = createPrsCallLookup(variants, observations);
    const prs = claim.purpose === "reports.polygenic" ? ALL_PRS_SCORES.map(score => {
      const result = computePrs(lookup, score);
      return { pgs_id: score.pgs_id, raw_score: result.raw, coverage: result.coverage, matched: result.matched };
    }) : [];
    const payload = { reports, prs };
    if (Buffer.byteLength(JSON.stringify(payload)) > 4_000_000) throw unavailable();
    await check();
    if (await call("stage", payload) !== true) throw unavailable();
    await check();
    const done = z.object({ status: z.literal("complete"), purpose }).strict().parse(await call("complete"));
    if (done.purpose !== claim.purpose) throw unavailable();
    return done;
  } catch {
    if (claim) {
      try { await call("fail", null, AbortSignal.timeout(5_000)); } catch { /* One bounded cleanup attempt; no write replay. */ }
    }
    throw unavailable();
  }
}
