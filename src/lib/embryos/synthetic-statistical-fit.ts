import { z } from "zod";
import artifactJson from "../../../data/embryo/test-statistical-fit-population.json";
import { measureEmbryoStatisticalCoverage, TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";
import { QC_THRESHOLDS } from "./qc-policy";

/** Pure invented-data experiment. No native admission, worker, clinical
 * registry, finding renderer or publication path imports this module. */
const dosesSchema = z.array(z.number().int().min(0).max(2)).length(10);
const observedRow = z.object({ id: z.string().min(1), dosages: dosesSchema,
  liability: z.number().finite().min(-20).max(20) }).strict();
const artifactSchema = z.object({
  version: z.literal("embryo-synthetic-fit-v1"), purpose: z.literal("pure-fitting-controls-only"),
  provenance: z.literal("entirely-invented-no-human-observations"),
  panelId: z.literal("synthetic-score-coverage-v1"),
  panelSourceSha256: z.literal("c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f"),
  variantIds: z.array(z.string()).length(10), sexBasis: z.literal("combined"), ageBand: z.literal("lifetime"),
  birthCohort: z.literal("Invented combined-sex lifetime toy cohort"),
  calibrationCohort: z.literal("Invented binary calibration controls"),
  construction: z.object({ algorithm: z.literal("lcg1664525-1013904223-u32-v1"),
    trainingSeed: z.literal(101), holdoutSeed: z.literal(202), referenceSeed: z.literal(303),
    familySeed: z.literal(404), calibrationSeed: z.literal(505),
    outcome: z.literal("invented-linear-signal-plus-bounded-noise"),
    familyDesign: z.literal("arbitrary-invented-pairs-not-siblings"),
    bootstrapSeed: z.literal(606), bootstrapReplicates: z.literal(256) }).strict(),
  training: z.array(observedRow).length(64), holdout: z.array(observedRow).length(48),
  reference: z.array(z.object({ id: z.string().min(1), dosages: dosesSchema }).strict()).length(96),
  familyControls: z.array(observedRow.extend({ familyId: z.string().min(1) }).strict()).length(32),
  calibration: z.array(z.object({ id: z.string().min(1), event: z.boolean() }).strict()).length(200),
}).strict();
const artifact = artifactSchema.parse(artifactJson);
const artifactText = JSON.stringify(artifact);
if (JSON.stringify(artifact.variantIds) !== JSON.stringify(TEST_STATISTICAL_SCORE_PANEL.variants.map(row => row.id)))
  throw new Error("synthetic fit panel mismatch");
const ids = [...artifact.training, ...artifact.holdout, ...artifact.reference,
  ...artifact.familyControls, ...artifact.calibration].map(row => row.id);
if (new Set(ids).size !== ids.length) throw new Error("synthetic fit identities overlap");
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
export const SYNTHETIC_FIT_POPULATION = freeze(artifact);
const Z95 = 1.959963984540054;
const MAX_COLUMNS = 11;
function refuse(): never { throw new Error("synthetic fit refused"); }
const finite = (values: readonly number[]) => values.every(Number.isFinite);
const dot = (a: readonly number[], b: readonly number[]) => {
  if (a.length !== b.length || !finite(a) || !finite(b)) refuse();
  const value = a.reduce((sum, x, i) => sum + x * b[i], 0);
  if (!Number.isFinite(value)) refuse(); return value;
};
const mean = (values: readonly number[]) => {
  if (values.length === 0 || !finite(values)) refuse(); return values.reduce((a, b) => a + b, 0) / values.length;
};
const transpose = (matrix: readonly (readonly number[])[]) => matrix[0].map((_, column) => matrix.map(row => row[column]));
function inverse(matrix: number[][]): number[][] {
  const n = matrix.length;
  const work = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => Number(i === j))]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
    if (Math.abs(work[pivot][column]) < 1e-12) refuse();
    [work[column], work[pivot]] = [work[pivot], work[column]];
    const scale = work[column][column]; work[column] = work[column].map(value => value / scale);
    for (let row = 0; row < n; row++) if (row !== column) {
      const factor = work[row][column];
      work[row] = work[row].map((value, j) => value - factor * work[column][j]);
    }
  }
  const result = work.map(row => row.slice(n));
  if (!result.every(finite)) refuse(); return result;
}

/** Bounded OLS arithmetic, exposed only for analytic regression controls.
 * This supplies no inference, reference or subject authority. */
export function fitSyntheticLeastSquares(design: number[][], outcomes: number[]) {
  const p = design[0]?.length ?? 0;
  if (p < 1 || p > MAX_COLUMNS || design.length <= p || design.length > 200
    || outcomes.length !== design.length || !finite(outcomes)
    || design.some(row => row.length !== p || !finite(row) || row.some(value => Math.abs(value) > 20))) refuse();
  const columns = transpose(design);
  const gram = columns.map(a => columns.map(b => dot(a, b)));
  const gramInverse = inverse(gram);
  const rhs = columns.map(column => dot(column, outcomes));
  const coefficients = gramInverse.map(row => dot(row, rhs));
  const residuals = design.map((row, i) => outcomes[i] - dot(row, coefficients));
  const residualVariance = dot(residuals, residuals) / (design.length - p);
  const covariance = gramInverse.map(row => row.map(value => value * residualVariance));
  return freeze({ coefficients, covariance, residualVariance, degreesOfFreedom: design.length - p,
    observations: design.length });
}
function quadratic(vector: number[], covariance: readonly (readonly number[])[]) {
  if (covariance.length !== vector.length || covariance.some(row => row.length !== vector.length)) refuse();
  const value = dot(vector, covariance.map(row => dot(row, vector)));
  if (value < -1e-10) refuse(); return Math.max(0, value);
}
function sampleCovariance(rows: readonly (readonly number[])[]) {
  const columns = transpose(rows), centers = columns.map(mean);
  const centered = columns.map((column, i) => column.map(value => value - centers[i]));
  return { centers, covariance: centered.map(a => centered.map(b => dot(a, b) / (rows.length - 1))) };
}
const predictionR2 = (observed: number[], predicted: number[]) => {
  if (observed.length < 3 || observed.length !== predicted.length) refuse();
  const center = mean(observed), total = observed.reduce((sum, value) => sum + (value - center) ** 2, 0);
  if (total <= 0) refuse();
  return 1 - observed.reduce((sum, value, i) => sum + (value - predicted[i]) ** 2, 0) / total;
};
function quantile(sorted: number[], fraction: number) {
  const index = fraction * (sorted.length - 1), low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
function performance(observed: number[], predicted: number[]) {
  let state: number = artifact.construction.bootstrapSeed;
  const bootstrap = Array.from({ length: artifact.construction.bootstrapReplicates }, () => {
    const indices = Array.from({ length: observed.length }, () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return Math.floor(state / 4294967296 * observed.length);
    });
    return predictionR2(indices.map(i => observed[i]), indices.map(i => predicted[i]));
  }).sort((a, b) => a - b);
  const interval = [quantile(bootstrap, .025), quantile(bootstrap, .975)] as const;
  if (!finite(interval) || interval[0] >= interval[1]) refuse();
  return freeze({ r2: predictionR2(observed, predicted), interval, n: observed.length,
    method: "invented-holdout-percentile-bootstrap-256" as const });
}
const logit = (value: number) => {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) refuse(); return Math.log(value / (1 - value));
};
const logistic = (value: number) => 1 / (1 + Math.exp(-value));

/** Wilson arithmetic over invented binary controls, not a population source. */
export function syntheticBaselineInterval(events: number, n: number) {
  if (!Number.isSafeInteger(events) || !Number.isSafeInteger(n) || n < 3 || n > 10000 || events <= 0 || events >= n) refuse();
  const point = events / n, denominator = 1 + Z95 ** 2 / n;
  const center = (point + Z95 ** 2 / (2 * n)) / denominator;
  const half = Z95 * Math.sqrt(point * (1 - point) / n + Z95 ** 2 / (4 * n ** 2)) / denominator;
  return freeze({ point, interval: [center - half, center + half] as const, n, events,
    method: "invented-binary-Wilson-95" as const });
}
function buildPackage() {
  const reference = sampleCovariance(artifact.reference.map(row => row.dosages));
  const centered = (dosages: number[]) => dosages.map((dose, i) => dose - reference.centers[i]);
  const fit = fitSyntheticLeastSquares(artifact.training.map(row => [1, ...centered(row.dosages)]), artifact.training.map(row => row.liability));
  const predict = (dosages: number[]) => dot([1, ...centered(dosages)], fit.coefficients);
  const holdout = performance(artifact.holdout.map(row => row.liability), artifact.holdout.map(row => predict(row.dosages)));
  // These paired algorithm controls are not siblings or published validation.
  const pairIds = [...new Set(artifact.familyControls.map(row => row.familyId))];
  const differences = pairIds.map(id => {
    const pair = artifact.familyControls.filter(row => row.familyId === id);
    if (pair.length !== 2) refuse();
    return { observed: pair[0].liability - pair[1].liability, predicted: predict(pair[0].dosages) - predict(pair[1].dosages) };
  });
  const internalPairR2 = predictionR2(differences.map(row => row.observed), differences.map(row => row.predicted));
  const baseline = syntheticBaselineInterval(artifact.calibration.filter(row => row.event).length, artifact.calibration.length);
  return freeze({ version: "embryo-synthetic-fit-package-v1" as const,
    provenance: artifact.provenance, panelId: artifact.panelId, sexBasis: artifact.sexBasis, ageBand: artifact.ageBand,
    birthCohort: artifact.birthCohort, calibrationCohort: artifact.calibrationCohort,
    fit, holdout, reference: { ...reference, n: artifact.reference.length }, baseline,
    internalInventedPairControls: { r2: internalPairR2, pairs: pairIds.length, evidence: "invented-pairs-not-human-siblings" as const },
    withinFamily: { status: "not_measured" as const, enabledByDefault: false as const,
      betaRatio: null, interval: null, familyCount: null, citation: null },
    publicationEligible: false as const, clinicalRegistryEligible: false as const,
  });
}
const fittedPackage = buildPackage();
export function fitSyntheticStatisticalPackage(input: unknown) {
  const parsed = artifactSchema.safeParse(input);
  if (!parsed.success || JSON.stringify(parsed.data) !== artifactText) return { ok: false as const, reason: "invalid_synthetic_artifact" as const };
  return { ok: true as const, package: fittedPackage };
}

const qcSchema = z.object({ callRate: z.number().finite().min(0).max(1),
  contamination: z.number().finite().min(0).max(1).nullable(),
  alleleDropout: z.number().finite().min(0).max(1).nullable() }).strict();
const experimentInput = z.object({ artifact: z.unknown(), panel: z.unknown(),
  source: z.unknown(), calls: z.unknown(), qc: z.unknown() }).strict();

/** Internal toy probability only. It cannot be an EmbryoFinding or a public
 * numeric DTO. Missing own rows stay zero-centered and contribute their full
 * reference covariance; parent or sibling values are not accepted. */
export function evaluateSyntheticStatisticalFit(raw: unknown) {
  const parsed = experimentInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, reason: "invalid_experiment_input" as const };
  const input = parsed.data;
  const selected = fitSyntheticStatisticalPackage(input.artifact);
  if (!selected.ok) return selected;
  const qc = qcSchema.safeParse(input.qc);
  if (!qc.success) return { ok: false as const, reason: "invalid_qc" as const };
  if (qc.data.callRate < QC_THRESHOLDS.callRateNoFigure
    || (qc.data.contamination !== null && qc.data.contamination > QC_THRESHOLDS.contaminationCeiling)
    || (qc.data.alleleDropout !== null && qc.data.alleleDropout > QC_THRESHOLDS.dropoutCeiling))
    return { ok: false as const, reason: "qc_not_reportable" as const };
  const measured = measureEmbryoStatisticalCoverage({ panel: input.panel, source: input.source, calls: input.calls });
  if (!measured.ok) return measured;
  if (measured.measurement.scoreCoverage < QC_THRESHOLDS.scoreCoverageFloor) return { ok: false as const, reason: "below_coverage_floor" as const };
  const pkg = selected.package;
  if (pkg.holdout.r2 <= 0 || pkg.holdout.interval[0] <= 0 || pkg.holdout.interval[1] >= 1)
    return { ok: false as const, reason: "synthetic_performance_unavailable" as const };
  const calls = input.calls as { chrom: number; pos: number; genotype: string }[];
  const x = TEST_STATISTICAL_SCORE_PANEL.variants.map((row, i) => {
    if (measured.measurement.rows[i].state !== "matched") return 0;
    const call = calls.find(call => call.chrom === row.chrom && call.pos === row.pos);
    if (!call) refuse();
    return call.genotype.split("/").filter(allele => allele === row.effectAllele).length - pkg.reference.centers[i];
  });
  const weights = pkg.fit.coefficients.slice(1), contrast = dot(x, weights);
  const scale = Math.sqrt(pkg.holdout.r2);
  const performanceSE = (Math.sqrt(pkg.holdout.interval[1]) - Math.sqrt(pkg.holdout.interval[0])) / (2 * Z95);
  // Ordered brief components, all on one log-liability experiment scale.
  const modelAccuracy = quadratic([0, ...x], pkg.fit.covariance) * scale ** 2 + contrast ** 2 * performanceSE ** 2;
  const referenceSampling = quadratic(weights, pkg.reference.covariance) * scale ** 2 / pkg.reference.n;
  const baselineSampling = ((logit(pkg.baseline.interval[1]) - logit(pkg.baseline.interval[0])) / (2 * Z95)) ** 2;
  const missingWeights = weights.map((weight, i) => measured.measurement.rows[i].state === "matched" ? 0 : weight);
  const missingCoverage = quadratic(missingWeights, pkg.reference.covariance) * scale ** 2;
  const varianceComponents = { modelAccuracy, referenceSampling, baselineSampling, missingCoverage };
  const totalVariance = Object.values(varianceComponents).reduce((sum, value) => sum + value, 0);
  if (!finite([contrast, totalVariance]) || totalVariance <= 0) refuse();
  const dropoutMultiplier = qc.data.alleleDropout === null ? QC_THRESHOLDS.dropoutUnmeasuredWidening : 1;
  const center = logit(pkg.baseline.point) + scale * contrast;
  const half = Z95 * Math.sqrt(totalVariance) * dropoutMultiplier;
  const logBounds = [center - half, center + half] as const;
  return { ok: true as const, experiment: freeze({
    provenance: artifact.provenance, kind: "synthetic-internal-probability" as const,
    coverage: measured.measurement.scoreCoverage, matchedVariants: measured.measurement.matchedVariants, requiredVariants: 10 as const,
    varianceComponents, totalVariance, dropoutMultiplier, logPoint: center, logBounds,
    point: logistic(center), interval: [logistic(logBounds[0]), logistic(logBounds[1])] as const,
    withinFamily: pkg.withinFamily, publicationEligible: false as const,
    clinicalRegistryEligible: false as const, publicFinding: null,
  }) };
}
