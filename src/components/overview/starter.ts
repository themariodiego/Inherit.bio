// Starter reading list (brief §2 §7.2, X5.3, §8 A10): up to five covered
// reports chosen deterministically, ordered by category rank then slug. The
// count is never padded with uncovered or out-of-set reports.

import { CATEGORY_TAXONOMY, categoryFor, type CategoryId } from "@/lib/genome/taxonomy";
import type { ReportTemplate, ResolvedReport } from "@/lib/genome/reports";

export const STARTER_LIMIT = 5;

/** X5.3: `established` alone returns zero on the seed, so the set is three-wide. */
export const STARTER_EVIDENCE: ReadonlySet<string> = new Set([
  "clinical",
  "established",
  "emerging",
]);

/** §2 §7.2: never a brain/mood or cancer report on day one. */
export const STARTER_EXCLUDED_CATEGORIES: ReadonlySet<CategoryId> = new Set<CategoryId>([
  "brain-memory-mood",
  "cancer",
]);

const CATEGORY_RANK = new Map<string, number>(
  CATEGORY_TAXONOMY.map((category, index) => [category.id, index]),
);

export function categoryRankOf(id: CategoryId): number {
  return CATEGORY_RANK.get(id) ?? CATEGORY_TAXONOMY.length;
}

/**
 * A10 layer clause: `variant_call`, or a single-locus `estimate` (the seed's
 * rows before any row is relabelled `variant_call`). Rows selected without
 * the layer columns are treated as single-locus estimates, matching the
 * seed's derivation.
 */
export function isStarterLayer(template: Pick<ReportTemplate, "layer" | "estimate_kind" | "pgs_id">): boolean {
  const layer = template.layer ?? "estimate";
  if (layer === "variant_call") return true;
  const kind = template.estimate_kind ?? (template.pgs_id ? "polygenic_score" : "single_locus");
  return kind === "single_locus";
}

export function isStarterCandidate(template: ReportTemplate): boolean {
  return (
    isStarterLayer(template) &&
    STARTER_EVIDENCE.has(template.evidence) &&
    !STARTER_EXCLUDED_CATEGORIES.has(categoryFor(template))
  );
}

/** Covered candidates, ordered by category rank then slug, capped at five. */
export function selectStarterReports(resolved: readonly ResolvedReport[]): ReportTemplate[] {
  return resolved
    .filter((report) => report.covered && isStarterCandidate(report.template))
    .map((report) => report.template)
    .sort((a, b) => {
      const rank = categoryRankOf(categoryFor(a)) - categoryRankOf(categoryFor(b));
      return rank !== 0 ? rank : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    })
    .slice(0, STARTER_LIMIT);
}
