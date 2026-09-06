import "server-only";
import type { Db } from "@/lib/genome/load";
import { loadInputSources } from "@/lib/genome/input-sources";
import { UNKNOWN_EMBRYO_INPUT, type EmbryoInputFacts } from "./input-facts";

/** Called after cohort/subject authority; never borrow another ordinal's source. */
export async function loadEmbryoInputFacts(db: Db, cohortId: string, subjectId: string): Promise<EmbryoInputFacts> {
  const { data, error } = await db.from("genome_files").select("id")
    .eq("cohort_id", cohortId).eq("subject_id", subjectId).eq("source_publication_state", "published").order("id").limit(1001);
  if (error || !data?.length || data.length > 1000) return { ...UNKNOWN_EMBRYO_INPUT };
  const sources = await loadInputSources(db, subjectId, data.map((file) => file.id));
  if (!sources.length || sources.some((source) => !source.snapshot)) return { ...UNKNOWN_EMBRYO_INPUT };
  const builds = new Set(sources.map((source) => source.snapshot!.sourceBuild));
  return { ...UNKNOWN_EMBRYO_INPUT, coordinate_conversion: builds.size > 1 ? "mixed" : builds.has("GRCh37") ? "converted" : "not-needed" };
}
