import { z } from "zod";
import panelJson from "../../../data/embryo/test-statistical-score-panel.json";
import { resultBasis } from "../figures/result-basis";
import { embryoCarrierSourceSchema } from "./carrier-observation";
import { QC_THRESHOLDS } from "./qc-policy";
import type { CoverageFailureFinding } from "./policy";

/** Private measurement only. This module grants no reference, source, job or
 * read authority. A native worker must independently admit and recheck the
 * complete disposable TEST reference and current source before publication.
 * QC remains a separate gate; it cannot become missing score coverage. */
const variantSchema = z.object({
  id: z.string().regex(/^synthetic-row-\d{2}$/),
  chrom: z.number().int().min(1).max(22), pos: z.number().int().positive().safe(),
  effectAllele: z.enum(["A", "C", "G", "T"]), otherAllele: z.enum(["A", "C", "G", "T"]),
}).strict();
const panelSchema = z.object({
  version: z.literal("embryo-statistical-test-panel-v1"), panelId: z.literal("synthetic-score-coverage-v1"),
  conditionId: z.literal("SYNTHETIC:9001"), conditionName: z.literal("Synthetic score coverage"),
  referenceBuild: z.literal("GRCh38"), jurisdiction: z.literal("TEST-LOCAL"),
  purpose: z.literal("coverage-failure-only"), nVariants: z.literal(10),
  variants: z.array(variantSchema).length(10),
}).strict();
const expectedPanel = panelSchema.parse(panelJson);
const expectedPanelText = JSON.stringify(expectedPanel);
for (const row of expectedPanel.variants) Object.freeze(row);
Object.freeze(expectedPanel.variants);
Object.freeze(expectedPanel);

/** The entire immutable synthetic artifact, never a selectable subset. */
export const TEST_STATISTICAL_SCORE_PANEL = expectedPanel;

const callSchema = z.object({
  fileId: z.uuid(), chrom: z.number().int().min(1).max(22), pos: z.number().int().positive().safe(),
  ref: z.enum(["A", "C", "G", "T"]), alt: z.enum(["A", "C", "G", "T"]).nullable(),
  genotype: z.string().regex(/^(?:[ACGT]\/[ACGT]|--)$/), usable: z.boolean().optional(),
}).strict();
const callsSchema = z.array(callSchema).max(256);
export type StatisticalCoverageRowState = "matched" | "not_covered" | "invalid_call" | "source_call_disputed";
export type StatisticalCoverageMeasurement = {
  version: 1; producer: "embryo-test-score-coverage-v1";
  panelId: typeof expectedPanel.panelId;
  source: z.infer<typeof embryoCarrierSourceSchema>;
  matchedVariants: number; requiredVariants: 10; scoreCoverage: number;
  rows: { variantId: string; state: StatisticalCoverageRowState }[];
};
export type StatisticalCoverageResult =
  | { ok: false; reason: "invalid_reference" | "invalid_source" | "invalid_calls" }
  | { ok: true; measurement: StatisticalCoverageMeasurement; finding: CoverageFailureFinding | null };

/** Count only usable own calls against every row in the complete score panel.
 * Missing and unusable inputs stay in the denominator. No weights, frequency
 * reference, raw score, percentile, risk or interval are computed. At/above
 * the floor this producer returns no finding; coverage cannot unlock a model. */
export function measureEmbryoStatisticalCoverage(input: {
  panel: unknown; source: unknown; calls: unknown;
}): StatisticalCoverageResult {
  const panel = panelSchema.safeParse(input.panel);
  if (!panel.success || JSON.stringify(panel.data) !== expectedPanelText)
    return { ok: false, reason: "invalid_reference" };
  const source = embryoCarrierSourceSchema.safeParse(input.source);
  if (!source.success || source.data.normalization_source_revision !== source.data.upload_revision
    || source.data.source_binding_fingerprint !== source.data.source_sha256)
    return { ok: false, reason: "invalid_source" };
  const calls = callsSchema.safeParse(input.calls);
  if (!calls.success || calls.data.some(call => call.fileId !== source.data.file_id
    || call.ref === call.alt
    || !panel.data.variants.some(row => row.chrom === call.chrom && row.pos === call.pos)
    || (call.genotype !== "--" && call.genotype.split("/").some(allele => allele !== call.ref && allele !== call.alt))))
    return { ok: false, reason: "invalid_calls" };

  const rows = panel.data.variants.map(row => {
    const own = calls.data.filter(call => call.chrom === row.chrom && call.pos === row.pos);
    let state: StatisticalCoverageRowState;
    if (own.length === 0 || own.some(call => call.genotype === "--" || call.usable === false)) {
      state = "not_covered";
    } else if (own.some(call => ![row.effectAllele, row.otherAllele].includes(call.ref)
      || (call.alt !== null && ![row.effectAllele, row.otherAllele].includes(call.alt))
      || call.genotype.split("/").some(allele => allele !== row.effectAllele && allele !== row.otherAllele))) {
      state = "invalid_call";
    } else {
      // A disagreement is never resolved by taking the first call or by
      // counting an allele more than once. Repeated identical calls add no row.
      const doses = own.map(call => call.genotype.split("/").filter(allele => allele === row.effectAllele).length);
      state = new Set(doses).size === 1 ? "matched" : "source_call_disputed";
    }
    return { variantId: row.id, state };
  });
  const matchedVariants = rows.filter(row => row.state === "matched").length;
  const scoreCoverage = matchedVariants / panel.data.variants.length;
  return { ok: true, measurement: {
    version: 1, producer: "embryo-test-score-coverage-v1", panelId: panel.data.panelId,
    source: source.data, matchedVariants, requiredVariants: 10, scoreCoverage, rows,
  }, finding: scoreCoverage < QC_THRESHOLDS.scoreCoverageFloor ? {
    schema_version: 2, figure_basis: resultBasis("observed"), kind: "coverage_failure",
    metric: "score_coverage", measured_value: scoreCoverage, required_minimum: QC_THRESHOLDS.scoreCoverageFloor,
    display_copy_id: "embryo.result.insufficient-coverage",
  } : null };
}
