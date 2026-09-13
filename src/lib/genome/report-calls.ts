import "server-only";
import type { Db } from "./load";
import { OBSERVED_CALL_VERSION } from "./observed-calls";
import { genotypeKey, type ReportTemplate, type TemplateVariant } from "./reports";
import { filterOwnAnalysisFiles, loadOwnReportCallPage } from "./own-analysis-access";
import type { OwnReportPurpose } from "@/lib/uploads/own-report-purpose";

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

/**
 * Shared report-only read. Callers must authorize the subject before an admin
 * read.
 *
 * `gateLegacy` is D-099, closed 2026-09-13. It is what makes a revoked
 * `reports.monogenic` or `reports.polygenic` refuse results derived from a
 * LEGACY source, exactly as `ancestry` has since D-097. It is a parameter
 * rather than a default because this function serves two readers with two
 * different authorities: the account reading its OWN record, where the live
 * subject-level grant is the right question, and the Family surfaces reading
 * a relative's record, where the reader holds no own-subject grant on that
 * subject and the authority is the counterpart's Family permission, checked
 * before this call. Defaulting it on would answer the Family question with
 * the wrong grant and remove legacy sharing rather than gate it.
 */
export async function loadReportCallRows(db: Db, subjectId: string, rsids: readonly number[], ownerId?: string,
  purpose: OwnReportPurpose | null = null, { gateLegacy = false }: { gateLegacy?: boolean } = {}) {
  const candidates = await allPages((offset) => db.from("genome_files")
    .select("id,build,status,observed_call_sha256,observed_call_version,single_logical_sample_verified_at")
    .eq("subject_id", subjectId).in("status", ["annotated", "stored"])
    .in("build", ["GRCh37", "GRCh38"]).order("id").range(offset, offset + PAGE - 1));
  const files = candidates ? await filterOwnAnalysisFiles(db, subjectId, purpose, candidates, { gateLegacy }) : null;
  const calls: ReportCall[] = [];
  const checkedFileIds = files?.map((file) => file.id) ?? [];
  if (!files) return { calls, fileCount: 0, checkedFileIds };
  if (!files.length || !rsids.length) return { calls, fileCount: files.length, checkedFileIds };
  const byFile = new Map(files.map((file) => [file.id, file]));
  const legacyFiles = files.filter(file => file.single_logical_sample_verified_at === null);
  const failedModern = new Set<string>();
  if (purpose) for (const file of files.filter(file => file.single_logical_sample_verified_at != null)) {
    const fileCalls: ReportCall[] = [];
    for (let offset = 0; offset < rsids.length; offset += 200) {
      const rows = await allPages(page => loadOwnReportCallPage(db, file.id, purpose, rsids.slice(offset, offset + 200), page));
      if (!rows) { failedModern.add(file.id); break; }
      fileCalls.push(...rows);
    }
    if (!failedModern.has(file.id)) calls.push(...fileCalls);
  }
  // Bound both IN lists, and exhaust each deterministic page before resolving.
  for (let fileOffset = 0; fileOffset < legacyFiles.length; fileOffset += 100) {
    const fileIds = legacyFiles.slice(fileOffset, fileOffset + 100).map((file) => file.id);
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
  // A withdrawal during the paged read must not escape as an analytic response.
  const current = await filterOwnAnalysisFiles(db, subjectId, purpose, files.filter(f => !failedModern.has(f.id)), { gateLegacy });
  const currentIds = new Set(current.map(f => f.id));
  return { calls: calls.filter(c => currentIds.has(c.file_id)), fileCount: current.length,
    checkedFileIds: checkedFileIds.filter(id => currentIds.has(id)) };
}

export async function getSubjectReportCalls(db: Db, subjectId: string, templates: readonly ReportTemplate[],
  { gateLegacy = false }: { gateLegacy?: boolean } = {}) {
  const rsids = [...new Set(templates.flatMap((template) => template.variants.map((variant) => variant.rsid)))];
  // One load, one layer: mixing purposes into one genotype map would let an
  // allowed estimate reveal an unselected variant-call layer (or vice versa).
  const layers = new Set(templates.map(t => t.layer ?? "estimate"));
  const purpose = layers.size === 1 ? layers.has("variant_call") ? "reports.monogenic" : "reports.polygenic" : null;
  const { calls, fileCount, checkedFileIds } = await loadReportCallRows(db, subjectId, rsids, undefined, purpose, { gateLegacy });
  return { ...resolveReportCalls(calls, templates), calls, fileCount, checkedFileIds };
}
