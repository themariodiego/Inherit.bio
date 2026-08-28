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

export async function getActiveFile(supabase: Db, fileId?: string) {
  const files = await getProcessedFiles(supabase);
  if (fileId) {
    const chosen = files.find((f) => f.id === fileId);
    if (chosen) return chosen;
  }
  return files[0] ?? null;
}

export async function getPublishedTemplates(
  supabase: Db,
): Promise<ReportTemplate[]> {
  const { data } = await supabase
    .from("report_templates")
    .select("slug, category, title, summary, evidence, variants, pgs_id, citations")
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

export function templateRsids(templates: ReportTemplate[]): number[] {
  const set = new Set<number>();
  for (const t of templates) {
    for (const v of t.variants) set.add(v.rsid);
  }
  return [...set];
}
