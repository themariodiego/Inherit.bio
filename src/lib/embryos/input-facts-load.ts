import "server-only";
import type { Db } from "@/lib/genome/load";
import { loadInputSources } from "@/lib/genome/input-sources";
import { UNKNOWN_EMBRYO_INPUT, type EmbryoInputFacts } from "./input-facts";

/** The validator every per-embryo canonical source row carries
 * (`20260930123000_embryo_canonical_sources.sql`). */
const EMBRYO_CANONICAL_SOURCE = "embryo-ordinal-fragment-v1";

/**
 * Called after cohort/subject authority; never borrow another ordinal's source.
 * A per-embryo source row names the embryo's own subject and never a cohort
 * (`genome_files_subject_or_cohort`), so the cohort is checked on the subject.
 */
export async function loadEmbryoInputFacts(db: Db, cohortId: string, subjectId: string): Promise<EmbryoInputFacts> {
  const subject = await db.from("subjects").select("id").eq("id", subjectId).eq("cohort_id", cohortId)
    .eq("subject_class", "embryo").limit(2);
  if (subject.error || subject.data?.length !== 1) return { ...UNKNOWN_EMBRYO_INPUT };
  const { data, error } = await db.from("genome_files").select("id,build,canonical_build,structural_validator_version")
    .eq("subject_id", subjectId).eq("source_publication_state", "published").order("id").limit(1001);
  if (error || !data?.length || data.length > 1000) return { ...UNKNOWN_EMBRYO_INPUT };
  // A canonical source keeps the calls in the build its file declared; no
  // coordinate is changed. Only a GRCh38 source makes that "not needed".
  if (data.every((file) => file.structural_validator_version === EMBRYO_CANONICAL_SOURCE)) {
    return { ...UNKNOWN_EMBRYO_INPUT, coordinate_conversion: data.every((file) =>
      file.build === "GRCh38" && file.canonical_build === "GRCh38") ? "not-needed" : "not-recorded" };
  }
  if (data.some((file) => file.structural_validator_version === EMBRYO_CANONICAL_SOURCE)) return { ...UNKNOWN_EMBRYO_INPUT };
  const sources = await loadInputSources(db, subjectId, data.map((file) => file.id));
  if (!sources.length || sources.some((source) => !source.snapshot)) return { ...UNKNOWN_EMBRYO_INPUT };
  const builds = new Set(sources.map((source) => source.snapshot!.sourceBuild));
  return { ...UNKNOWN_EMBRYO_INPUT, coordinate_conversion: builds.size > 1 ? "mixed" : builds.has("GRCh37") ? "converted" : "not-needed" };
}
