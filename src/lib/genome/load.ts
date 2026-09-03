// Server-side data loading helpers shared by reports, browse, ancestry and
// the copilot tools. All queries run under the user's own session (RLS).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { ReportTemplate } from "./reports";

export type Db = SupabaseClient<Database>;

export async function getProcessedFiles(supabase: Db) {
  const { data } = await supabase
    .from("genome_files")
    .select("id, original_name, file_type, status, variant_count, created_at")
    .eq("status", "annotated")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getSubjectProcessedFiles(supabase: Db, subjectId: string) {
  const { data } = await supabase
    .from("genome_files")
    .select("id, original_name, file_type, status, variant_count, created_at, subject_id")
    .eq("subject_id", subjectId)
    .eq("status", "annotated")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Every file in the record, whatever its status: the count /files shows. */
export async function getSubjectFileCount(supabase: Db, subjectId: string): Promise<number> {
  const { count } = await supabase
    .from("genome_files")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", subjectId);
  return count ?? 0;
}

export async function getProcessedFileById(supabase: Db, fileId: string) {
  const { data } = await supabase
    .from("genome_files")
    .select("id, original_name, file_type, status, variant_count, created_at, subject_id")
    .eq("id", fileId)
    .eq("status", "annotated")
    .maybeSingle();
  return data;
}

export async function getPublishedTemplates(
  supabase: Db,
): Promise<ReportTemplate[]> {
  const { data } = await supabase
    .from("report_templates")
    .select(
      "slug, category, title, summary, evidence, variants, pgs_id, citations, layer, estimate_kind",
    )
    .eq("status", "published")
    .order("category")
    .order("title");
  return (data ?? []) as unknown as ReportTemplate[];
}

/** Genotypes for a file at the given rsIDs, chunked to keep URLs sane. */
export async function getGenotypesByRsid(
  supabase: Db,
  fileId: string,
  rsids: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const CHUNK = 200;
  for (let i = 0; i < rsids.length; i += CHUNK) {
    const { data } = await supabase
      .from("user_variants")
      .select("rsid, genotype")
      .eq("file_id", fileId)
      .in("rsid", rsids.slice(i, i + CHUNK));
    for (const row of data ?? []) {
      if (row.rsid != null && !map.has(row.rsid)) {
        map.set(row.rsid, row.genotype);
      }
    }
  }
  return map;
}

/**
 * Resolve a subject's files newest-first. A position present in more than one
 * file is usable only when every observed genotype agrees.
 */
export async function getSubjectGenotypesByRsid(
  supabase: Db,
  subjectId: string,
  rsids: number[],
): Promise<{
  genotypes: Map<number, string>;
  conflicts: Set<number>;
  fileCount: number;
}> {
  const files = await getSubjectProcessedFiles(supabase, subjectId);
  const genotypes = new Map<number, string>();
  const conflicts = new Set<number>();
  const CHUNK = 200;

  if (files.length === 0) return { genotypes, conflicts, fileCount: 0 };

  for (let i = 0; i < rsids.length; i += CHUNK) {
    const { data } = await supabase
      .from("user_variants")
      .select("rsid, genotype, file_id")
      .eq("subject_id", subjectId)
      .in("file_id", files.map((file) => file.id))
      .in("rsid", rsids.slice(i, i + CHUNK));

    const fileOrder = new Map(files.map((file, index) => [file.id, index]));
    const rows = [...(data ?? [])].sort(
      (a, b) => (fileOrder.get(a.file_id) ?? 0) - (fileOrder.get(b.file_id) ?? 0),
    );
    for (const row of rows) {
      if (row.rsid == null || conflicts.has(row.rsid)) continue;
      const current = genotypes.get(row.rsid);
      if (current == null) genotypes.set(row.rsid, row.genotype);
      else if (current !== row.genotype) {
        genotypes.delete(row.rsid);
        conflicts.add(row.rsid);
      }
    }
  }

  return { genotypes, conflicts, fileCount: files.length };
}

export function templateRsids(templates: ReportTemplate[]): number[] {
  const set = new Set<number>();
  for (const t of templates) {
    for (const v of t.variants) set.add(v.rsid);
  }
  return [...set];
}
