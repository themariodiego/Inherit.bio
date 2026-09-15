import { REGION_CODES } from "./seven-region-reference";

export type ReportingRule = "seven-regions" | "earlier-hot-only" | "accepted-all-three" | "global-all-three";
export interface ReportedRow { members: number[]; share: number }
const CONFUSABLE = ["EUR", "MID", "CSA"].map((r) => REGION_CODES.indexOf(r as (typeof REGION_CODES)[number]));

/** The accepted decision merges all three after two unrounded shares exceed 0.10. */
export function reportedRows(q: readonly number[], rule: ReportingRule): ReportedRow[] {
  if (q.length !== REGION_CODES.length || q.some((v) => !Number.isFinite(v) || v < 0 || v > 1) || Math.abs(q.reduce((a, b) => a + b, 0) - 1) > 1e-8) throw new Error("Expected a seven-region probability vector");
  const hot = CONFUSABLE.filter((k) => rule === "earlier-hot-only" ? q[k] >= 0.10 : q[k] > 0.10);
  const merged = rule === "global-all-three" ? CONFUSABLE
    : rule === "accepted-all-three" && hot.length >= 2 ? CONFUSABLE
    : rule === "earlier-hot-only" && hot.length >= 2 ? hot : [];
  const rows: ReportedRow[] = merged.length ? [{ members: [...merged], share: merged.reduce((sum, k) => sum + q[k], 0) }] : [];
  q.forEach((share, k) => { if (!merged.includes(k)) rows.push({ members: [k], share }); });
  return rows;
}
