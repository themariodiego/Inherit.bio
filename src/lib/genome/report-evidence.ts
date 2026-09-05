import type { ReportTemplate, ResolvedReport } from "./reports";

export type ReportMethod = "guideline-position" | "specific-position" | "position-association" | "polygenic-score" | "unavailable";

/** Template identity is not proof that a score has been calculated or validated. */
export function reportMethod(template: ReportTemplate): ReportMethod {
  if (template.layer === "variant_call") {
    return template.category === "pharmacogenomics" ? "guideline-position" : "specific-position";
  }
  const kind = template.estimate_kind ?? (template.pgs_id ? "polygenic_score" : "single_locus");
  if (kind === "polygenic_score") {
    return /^PGS\d{6}$/.test(template.pgs_id ?? "") ? "polygenic-score" : "unavailable";
  }
  return template.pgs_id ? "unavailable" : "position-association";
}

export const REPORT_CALL_STATES = ["interpreted", "conflicting", "no-call", "unrecognized", "unavailable"] as const;
export type ReportCallState = (typeof REPORT_CALL_STATES)[number];
export type ReportCallSummary = Record<ReportCallState, number>;

/**
 * Counts the report resolver's inputs, not assay coverage. The current store
 * does not expose every explicit VCF reference/no-call row. An absent row
 * must not become a negative finding, or a claim that the source never tested it.
 * Conflict takes precedence over all outcomes, including a retained call.
 */
export function summarizeReportCalls(
  report: ResolvedReport,
  conflicts: ReadonlySet<number>,
): ReportCallSummary {
  const summary: ReportCallSummary = { interpreted: 0, conflicting: 0, "no-call": 0, unrecognized: 0, unavailable: 0 };
  const states = new Map<number, ReportCallState>();
  // One position can be listed in multiple template entries. If any entry
  // yields a shown reading it is used; conflicts still override everything.
  const priority: Record<ReportCallState, number> = { conflicting: 5, interpreted: 4, unrecognized: 3, "no-call": 2, unavailable: 1 };
  for (const { variant, outcome } of report.variants) {
    const state = conflicts.has(variant.rsid) ? "conflicting"
      : outcome.status === "genotyped" ? "interpreted"
      : outcome.status === "not-covered" ? "unavailable" : outcome.status;
    const previous = states.get(variant.rsid);
    if (!previous || priority[state] > priority[previous]) states.set(variant.rsid, state);
  }
  for (const state of states.values()) summary[state] += 1;
  return summary;
}

/** Never fabricate a source-read date from a build, deployment or current date. */
export function validSourceReadDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
