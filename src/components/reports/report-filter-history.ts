/** Only navigation preferences, never source calls, report results or authority tokens. */
export const REPORT_FILTER_HISTORY_KEY = "inheritReportFiltersV1";
export const MAX_REPORT_QUERY_LENGTH = 200;
export type ReportFilterState = { query: string; withResults: boolean };
export type ReportFilterLayer = "variant-call" | "estimate";
export const EMPTY_REPORT_FILTER_SNAPSHOT = JSON.stringify({ query: "", withResults: false });

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A primitive snapshot is stable across React reads, including the hydration pass. */
export function reportFilterSnapshot(state: unknown, subjectId: string, layer: ReportFilterLayer): string {
  if (!record(state)) return EMPTY_REPORT_FILTER_SNAPSHOT;
  const saved = state[REPORT_FILTER_HISTORY_KEY];
  if (!record(saved) || Object.keys(saved).length !== 4 || saved.subjectId !== subjectId || saved.layer !== layer
    || typeof saved.query !== "string" || saved.query.length > MAX_REPORT_QUERY_LENGTH
    || typeof saved.withResults !== "boolean") return EMPTY_REPORT_FILTER_SNAPSHOT;
  return JSON.stringify({ query: saved.query, withResults: saved.withResults });
}

/** Replaces one bounded preference record while retaining Next's opaque routing state. */
export function withReportFilters(state: unknown, subjectId: string, layer: ReportFilterLayer, filters: ReportFilterState): Record<string, unknown> {
  if (filters.query.length > MAX_REPORT_QUERY_LENGTH) throw new Error("Report search is too long");
  return { ...(record(state) ? state : {}), [REPORT_FILTER_HISTORY_KEY]: {
    subjectId, layer, query: filters.query, withResults: filters.withResults,
  } };
}
