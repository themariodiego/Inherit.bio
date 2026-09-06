import "server-only";
import type { Db } from "./load";
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

const PAGE = 1000;
async function allPages<T>(query: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await query(offset);
    if (page.error) return null;
    rows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < PAGE) return rows;
  }
}

/** Shared report-only read. Callers must authorize the subject before an admin read. */
export async function loadReportCallRows(db: Db, subjectId: string, rsids: readonly number[], ownerId?: string) {
  const files = await allPages((offset) => db.from("genome_files")
    .select("id,build,observed_call_sha256,observed_call_version")
    .eq("subject_id", subjectId).eq("status", "annotated")
    .in("build", ["GRCh37", "GRCh38"]).order("id").range(offset, offset + PAGE - 1));
  const calls: ReportCall[] = [];
  const checkedFileIds = files?.map((file) => file.id) ?? [];
  if (!files) return { calls, fileCount: 0, checkedFileIds };
  if (!files.length || !rsids.length) return { calls, fileCount: files.length, checkedFileIds };
  const byFile = new Map(files.map((file) => [file.id, file]));
  // Bound both IN lists, and exhaust each deterministic page before resolving.
  for (let fileOffset = 0; fileOffset < files.length; fileOffset += 100) {
    const fileIds = files.slice(fileOffset, fileOffset + 100).map((file) => file.id);
    for (let i = 0; i < rsids.length; i += 200) {
      const chunk = rsids.slice(i, i + 200);
      const [variants, observations] = await Promise.all([
        allPages((offset) => {
          let query = db.from("user_variants").select("file_id,rsid,chrom,pos,ref,alt,genotype")
            .eq("subject_id", subjectId).in("file_id", fileIds).in("rsid", chunk)
            .order("file_id").order("id").range(offset, offset + PAGE - 1);
          if (ownerId) query = query.eq("user_id", ownerId);
          return query;
        }),
        allPages((offset) => {
          let query = db.from("report_observed_calls")
            .select("file_id,rsid,chrom,pos,ref,alt,genotype,usable,source_sha256,extraction_version,source_build")
            .eq("subject_id", subjectId).in("file_id", fileIds).in("rsid", chunk)
            .order("file_id").order("source_line").range(offset, offset + PAGE - 1);
          if (ownerId) query = query.eq("user_id", ownerId);
          return query;
        }),
      ]);
      if (!variants || !observations) return { calls: [], fileCount: files.length, checkedFileIds };
      const certified = observations.filter((row) => {
        const file = byFile.get(row.file_id);
        return file?.observed_call_version === OBSERVED_CALL_VERSION &&
          row.extraction_version === file.observed_call_version && row.source_build === file.build &&
          /^[0-9a-f]{64}$/.test(row.source_sha256) && row.source_sha256 === file.observed_call_sha256;
      });
      // Do not hide conflicting or unusable evidence by picking one store.
      calls.push(...variants, ...certified);
    }
  }
  return { calls, fileCount: files.length, checkedFileIds };
}

export async function getSubjectReportCalls(db: Db, subjectId: string, templates: readonly ReportTemplate[]) {
  const rsids = [...new Set(templates.flatMap((template) => template.variants.map((variant) => variant.rsid)))];
  const { calls, fileCount, checkedFileIds } = await loadReportCallRows(db, subjectId, rsids);
  return { ...resolveReportCalls(calls, templates), calls, fileCount, checkedFileIds };
}
