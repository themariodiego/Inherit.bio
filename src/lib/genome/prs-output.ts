import type { Db } from "./load";

/**
 * Publication boundary for the current PRS engine. Its partial weighted sum
 * and analytic frequency-based reference are not a validated personal score,
 * percentile or risk model. Coverage never makes that reference eligible.
 * A future calibrated pipeline must supply a separately reviewed contract;
 * neither a non-null stored number nor a client flag may unlock this one.
 */
export const PRS_UNAVAILABLE_REASON = "no_validated_reference" as const;
export const PRS_UNAVAILABLE_EXPLANATION =
  "We cannot give you a score or risk from this calculation. It has no validated comparison group for your result.";
export const PRS_COVERAGE_EXPLANATION =
  "These counts describe positions used by the calculation, not a full check of your DNA or a measure of risk.";

export function serializePrsCoverage(
  row: { matched: number } | null | undefined,
  nVariants: number | null | undefined,
) {
  const validCounts = row != null && Number.isSafeInteger(row.matched) && row.matched >= 0 &&
    typeof nVariants === "number" && Number.isSafeInteger(nVariants) && nVariants > 0 && row.matched <= nVariants;
  return {
    status: "unavailable" as const,
    reason: PRS_UNAVAILABLE_REASON,
    explanation: PRS_UNAVAILABLE_EXPLANATION,
    coverage: validCounts ? { matched: row.matched, required: nVariants } : null,
    coverage_explanation: PRS_COVERAGE_EXPLANATION,
  };
}

/** The chat tool reads only coverage; forbidden legacy quantities never enter its context. */
export async function loadPrsForChat(db: Db, subjectId: string, scoreId: string, hasFiles: boolean) {
  if (!/^PGS\d{6}$/.test(scoreId)) return { error: "unknown score id" };
  const { data: meta, error: metaError } = await db
    .from("prs_scores")
    .select("pgs_id, name, trait, n_variants, ancestry_note, citation")
    .eq("pgs_id", scoreId)
    .maybeSingle();
  if (metaError) return { error: "score metadata unavailable" };
  if (!meta) return { error: "unknown score id" };

  let row: { matched: number } | undefined;
  if (hasFiles) {
    const { data, error } = await db
      .from("user_prs")
      .select("matched")
      .eq("subject_id", subjectId)
      .eq("pgs_id", scoreId)
      .order("computed_at", { ascending: false })
      .limit(1);
    if (error) return { error: "score coverage unavailable" };
    row = data?.[0];
  }
  return {
    pgs_id: meta.pgs_id,
    name: meta.name,
    trait: meta.trait,
    ancestry_note: meta.ancestry_note,
    citation: meta.citation,
    result: serializePrsCoverage(row, meta.n_variants),
  };
}

/** Account-scoped export, retaining per-file provenance but not unvalidated quantities. */
export async function loadPrsForExport(db: Db, userId: string) {
  const rows: { pgs_id: string; file_id: string; matched: number; computed_at: string }[] = [];
  // Advance by actual rows returned: PostgREST may cap the requested range.
  for (let from = 0; ; ) {
    const { data, error } = await db
      .from("user_prs")
      .select("pgs_id, file_id, matched, computed_at")
      .eq("user_id", userId)
      .order("computed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error("score coverage export unavailable");
    if (!data?.length) break;
    rows.push(...data);
    from += data.length;
  }
  if (!rows.length) return [];
  const { data: metas, error } = await db
    .from("prs_scores")
    .select("pgs_id, name, trait, n_variants, ancestry_note")
    .in("pgs_id", [...new Set(rows.map((row) => row.pgs_id))]);
  if (error) throw new Error("score metadata export unavailable");
  const metaById = new Map((metas ?? []).map((meta) => [meta.pgs_id, meta]));
  return rows.map((row) => {
    const meta = metaById.get(row.pgs_id);
    return {
      pgs_id: row.pgs_id,
      name: meta?.name ?? null,
      trait: meta?.trait ?? null,
      ancestry_note: meta?.ancestry_note ?? null,
      file_id: row.file_id,
      computed_at: row.computed_at,
      ...serializePrsCoverage(row, meta?.n_variants),
    };
  });
}
