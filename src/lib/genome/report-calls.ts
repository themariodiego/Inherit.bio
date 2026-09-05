import "server-only";
import type { Db } from "./load";
import { getSubjectProcessedFiles } from "./load";
import { OBSERVED_CALL_VERSION } from "./observed-calls";
import { genotypeKey, type ReportTemplate, type TemplateVariant } from "./reports";

export interface ReportCall {
  file_id: string;
  rsid: number | null;
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  genotype: string;
  usable?: boolean;
}

export function callMatchesTemplate(call: ReportCall, variant: TemplateVariant): boolean {
  return call.chrom === variant.chrom && call.pos === variant.pos38 &&
    (call.ref === null || call.ref === variant.ref) &&
    (call.alt === null || call.alt === variant.alt);
}

/** A repeated position is evidence once; disagreement or unusable evidence wins. */
export function resolveReportCalls(calls: readonly ReportCall[], templates: readonly ReportTemplate[]) {
  const genotypes = new Map<number, string>();
  const conflicts = new Set<number>();
  const unusable = new Set<number>();
  for (const variant of templates.flatMap((template) => template.variants)) {
    if (conflicts.has(variant.rsid)) continue;
    for (const call of calls.filter((row) => row.rsid === variant.rsid)) {
      const key = genotypeKey(call.genotype);
      const current = genotypes.get(variant.rsid);
      if (callMatchesTemplate(call, variant) && (call.usable === false || call.genotype === "--")) {
        unusable.add(variant.rsid);
        continue;
      }
      if (!callMatchesTemplate(call, variant) || !key ||
          (current !== undefined && genotypeKey(current) !== key)) {
        genotypes.delete(variant.rsid);
        conflicts.add(variant.rsid);
        break;
      }
      genotypes.set(variant.rsid, call.genotype);
    }
  }
  for (const rsid of unusable) if (!conflicts.has(rsid)) genotypes.set(rsid, "--");
  return { genotypes, conflicts };
}

/** Shared report-only read. Callers must authorize the subject before an admin read. */
export async function loadReportCallRows(db: Db, subjectId: string, rsids: readonly number[], ownerId?: string) {
  const files = (await getSubjectProcessedFiles(db, subjectId))
    .filter((file) => file.build === "GRCh37" || file.build === "GRCh38");
  const calls: ReportCall[] = [];
  if (!files.length || !rsids.length) return { calls, fileCount: files.length };
  const fileIds = files.map((file) => file.id);
  for (let i = 0; i < rsids.length; i += 200) {
    const chunk = rsids.slice(i, i + 200);
    let variantQuery = db.from("user_variants").select("file_id,rsid,chrom,pos,ref,alt,genotype")
      .eq("subject_id", subjectId).in("file_id", fileIds).in("rsid", chunk);
    let observedQuery = db.from("report_observed_calls")
      .select("file_id,rsid,chrom,pos,ref,alt,genotype,usable,source_sha256,extraction_version,source_build")
      .eq("subject_id", subjectId).in("file_id", fileIds).in("rsid", chunk);
    if (ownerId) {
      variantQuery = variantQuery.eq("user_id", ownerId);
      observedQuery = observedQuery.eq("user_id", ownerId);
    }
    const [variants, observations] = await Promise.all([variantQuery, observedQuery]);
    if (variants.error || observations.error) return { calls: [], fileCount: files.length };
    const certified = (observations.data ?? []).filter((row) => {
      const file = files.find((candidate) => candidate.id === row.file_id);
      return file?.observed_call_version === OBSERVED_CALL_VERSION &&
        row.extraction_version === file.observed_call_version && row.source_build === file.build &&
        /^[0-9a-f]{64}$/.test(row.source_sha256) && row.source_sha256 === file.observed_call_sha256;
    });
    // Compare observed calls with existing rows too: a conflicting or failed
    // extraction must not be hidden by selecting only one source of evidence.
    calls.push(...(variants.data ?? []), ...certified);
  }
  return { calls, fileCount: files.length };
}

export async function getSubjectReportCalls(db: Db, subjectId: string, templates: readonly ReportTemplate[]) {
  const rsids = [...new Set(templates.flatMap((template) => template.variants.map((variant) => variant.rsid)))];
  const { calls, fileCount } = await loadReportCallRows(db, subjectId, rsids);
  return { ...resolveReportCalls(calls, templates), calls, fileCount };
}
