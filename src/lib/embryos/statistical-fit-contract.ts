import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { evaluateSyntheticStatisticalFit, fitSyntheticStatisticalPackage,
  SYNTHETIC_FIT_POPULATION } from "./synthetic-statistical-fit";
import { TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";
import { embryoCarrierSourceSchema } from "./carrier-observation";
import { QC_REASON_IDS, QC_THRESHOLDS, RESULT_NOT_REPORTABLE_REASON_IDS } from "./qc-policy";

/** Data correspondence only. Neither a digest nor this pure computation
 * supplies the separate native fitted admission, claim or current-read authority. */
export const STATISTICAL_FIT_ARTIFACT_SHA256 = "5355327cfe90cda24ca2d27cd3afab2e53d26b5d6995b69cb296d3b975c6d408";
export const STATISTICAL_FIT_PANEL_SHA256 = "c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f";
export const statisticalFitArtifactSchema = z.json().refine(value => isDeepStrictEqual(value, SYNTHETIC_FIT_POPULATION));

/** Quantize output only; every fit and uncertainty intermediate remains raw.
 * The native producer uses the same half-away-from-zero, fixed-nine encoding. */
export function statisticalFitFixed9(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1_000_000) throw new Error("statistical_fit_refused");
  const integer = Math.floor(Math.abs(value) * 1_000_000_000 + 0.5);
  if (!Number.isSafeInteger(integer) || integer >= 1_000_000_000_000_000) throw new Error("statistical_fit_refused");
  return `${value < 0 && integer !== 0 ? "-" : ""}${Math.floor(integer / 1_000_000_000)}.${String(integer % 1_000_000_000).padStart(9, "0")}`;
}
const fixed9 = z.string().regex(/^-?(?:0|[1-9]\d{0,5})\.\d{9}$/)
  .refine(value => value !== "-0.000000000");
const nonnegative = fixed9.refine(value => Number(value) >= 0);
const positive = fixed9.refine(value => Number(value) > 0);
const probability = fixed9.refine(value => Number(value) > 0 && Number(value) < 1);
const interval = z.tuple([probability, probability]).refine(value => Number(value[0]) < Number(value[1]));
export const statisticalWithinFamilySchema = z.object({ status: z.literal("not_measured"),
  enabledByDefault: z.literal(false), betaRatio: z.null(), interval: z.null(),
  familyCount: z.null(), citation: z.null() }).strict();
const rawPackageSchema = z.object({ version: z.literal("embryo-synthetic-fit-package-v1"),
  provenance: z.literal("entirely-invented-no-human-observations"), panelId: z.literal("synthetic-score-coverage-v1"),
  sexBasis: z.literal("combined"), ageBand: z.literal("lifetime"),
  birthCohort: z.literal("Invented combined-sex lifetime toy cohort"),
  calibrationCohort: z.literal("Invented binary calibration controls"),
  fit: z.object({ coefficients: z.array(fixed9).length(11), covariance: z.array(z.array(fixed9).length(11)).length(11),
    residualVariance: positive, degreesOfFreedom: z.literal(53), observations: z.literal(64) }).strict(),
  holdout: z.object({ r2: probability, interval, n: z.literal(48),
    method: z.literal("invented-holdout-percentile-bootstrap-256") }).strict(),
  reference: z.object({ centers: z.array(nonnegative).length(10), covariance: z.array(z.array(fixed9).length(10)).length(10),
    n: z.literal(96) }).strict(),
  baseline: z.object({ point: probability, interval, n: z.literal(200), events: z.number().int().min(1).max(199),
    method: z.literal("invented-binary-Wilson-95") }).strict(),
  internalInventedPairControls: z.object({ r2: fixed9, pairs: z.literal(16),
    evidence: z.literal("invented-pairs-not-human-siblings") }).strict(),
  withinFamily: statisticalWithinFamilySchema, publicationEligible: z.literal(false), clinicalRegistryEligible: z.literal(false),
}).strict();
const selected = fitSyntheticStatisticalPackage(SYNTHETIC_FIT_POPULATION);
if (!selected.ok) throw new Error("statistical_fit_refused");
const fitted = selected.package;
const canonicalPackage = rawPackageSchema.parse({ ...fitted,
  fit: { ...fitted.fit, coefficients: fitted.fit.coefficients.map(statisticalFitFixed9),
    covariance: fitted.fit.covariance.map(row => row.map(statisticalFitFixed9)), residualVariance: statisticalFitFixed9(fitted.fit.residualVariance) },
  holdout: { ...fitted.holdout, r2: statisticalFitFixed9(fitted.holdout.r2), interval: fitted.holdout.interval.map(statisticalFitFixed9) },
  reference: { ...fitted.reference, centers: fitted.reference.centers.map(statisticalFitFixed9),
    covariance: fitted.reference.covariance.map(row => row.map(statisticalFitFixed9)) },
  baseline: { ...fitted.baseline, point: statisticalFitFixed9(fitted.baseline.point), interval: fitted.baseline.interval.map(statisticalFitFixed9) },
  internalInventedPairControls: { ...fitted.internalInventedPairControls, r2: statisticalFitFixed9(fitted.internalInventedPairControls.r2) },
});
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze);Object.freeze(value); }
  return value;
}
freeze(canonicalPackage);
export const statisticalFitPackageSchema = rawPackageSchema.refine(value => JSON.stringify(value) === JSON.stringify(canonicalPackage));
export type StatisticalFitPackage = z.infer<typeof statisticalFitPackageSchema>;
export function canonicalStatisticalFitPackage(): StatisticalFitPackage { return canonicalPackage; }

/** Arrays of fixed strings, with an explicit field order. The native producer
 * recursively encodes these same arrays; jsonb object ordering is irrelevant. */
export function statisticalFitPackageProjection(value: StatisticalFitPackage): string {
  const pkg = statisticalFitPackageSchema.parse(value);
  return JSON.stringify([pkg.version, pkg.fit.coefficients, pkg.fit.covariance, pkg.fit.residualVariance,
    pkg.holdout.r2, pkg.holdout.interval, pkg.reference.centers, pkg.reference.covariance,
    pkg.baseline.point, pkg.baseline.interval, pkg.internalInventedPairControls.r2]);
}
export function statisticalFitPackageDigest(value: StatisticalFitPackage): string {
  return createHash("sha256").update(statisticalFitPackageProjection(value)).digest("hex");
}

export const statisticalFitResultSchema = z.object({ version: z.literal(1), kind: z.literal("synthetic-test-probability"),
  figureBasis: z.object({ version: z.literal(1), basis: z.literal("modelled") }).strict(),
  coverageBasis: z.object({ version: z.literal(1), basis: z.literal("observed") }).strict(),
  point: probability, interval,
  varianceComponents: z.object({ modelAccuracy: nonnegative, referenceSampling: nonnegative,
    baselineSampling: positive, missingCoverage: nonnegative }).strict(), totalVariance: positive,
  dropoutMultiplier: z.enum(["1.000000000", "1.500000000"]), logPoint: fixed9,
  logBounds: z.tuple([fixed9, fixed9]).refine(value => Number(value[0]) < Number(value[1])),
  withinFamily: statisticalWithinFamilySchema, clinicalPublication: z.literal(false),
}).strict().superRefine((value, ctx) => {
  const point = Number(value.point), low = Number(value.interval[0]), high = Number(value.interval[1]);
  const logPoint = Number(value.logPoint), logLow = Number(value.logBounds[0]), logHigh = Number(value.logBounds[1]);
  // This decoder supplies no arithmetic authority. Native save/current read
  // independently recompute and compare every canonical field exactly.
  if (!(low < point && point < high && logLow < logPoint && logPoint < logHigh))
    ctx.addIssue({ code: "custom", message: "Canonical synthetic interval required" });
});
export type StatisticalFitResult = z.infer<typeof statisticalFitResultSchema>;
const fitInputSchema = z.object({ source: z.unknown(), calls: z.unknown(),
  qc: z.object({ callRate: z.number().finite().min(0).max(1), contamination: z.number().finite().min(0).max(1).nullable(),
    alleleDropout: z.number().finite().min(0).max(1).nullable() }).strict() }).strict();
export function evaluateStatisticalFitResult(input: { source: unknown; calls: unknown;
  qc: { callRate: number; contamination: number | null; alleleDropout: number | null } }) {
  const parsed = fitInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "invalid_experiment_input" as const };
  const result = evaluateSyntheticStatisticalFit({ artifact: SYNTHETIC_FIT_POPULATION,
    panel: TEST_STATISTICAL_SCORE_PANEL, ...parsed.data });
  if (!result.ok) return result;
  const experiment = result.experiment;
  return { ok: true as const, result: statisticalFitResultSchema.parse({ version: 1, kind: "synthetic-test-probability",
    figureBasis: { version: 1, basis: "modelled" }, coverageBasis: { version: 1, basis: "observed" },
    point: statisticalFitFixed9(experiment.point), interval: experiment.interval.map(statisticalFitFixed9),
    varianceComponents: Object.fromEntries(Object.entries(experiment.varianceComponents).map(([key, value]) => [key, statisticalFitFixed9(value)])),
    totalVariance: statisticalFitFixed9(experiment.totalVariance), dropoutMultiplier: statisticalFitFixed9(experiment.dropoutMultiplier),
    logPoint: statisticalFitFixed9(experiment.logPoint), logBounds: experiment.logBounds.map(statisticalFitFixed9),
    withinFamily: experiment.withinFamily, clinicalPublication: false,
  }) };
}

const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/);
const expectedPackageDigest = statisticalFitPackageDigest(canonicalPackage);
export const statisticalFitReferenceSchema = z.object({ singleton: z.literal(true), version: z.literal(1),
  panel_sha256: z.literal(STATISTICAL_FIT_PANEL_SHA256), panel: z.json().refine(value => isDeepStrictEqual(value, TEST_STATISTICAL_SCORE_PANEL)),
  system_identifier: z.string().regex(/^[1-9]\d{0,19}$/), database_name: z.literal("postgres"),
  database_oid: z.number().int().min(1).max(4_294_967_295), server_version: z.number().int().positive().safe(),
  runtime_binding: z.object({ kind: z.enum(["owned-linux", "github-browser"]), project: z.literal("sequence"),
    head: z.string().regex(/^[0-9a-f]{40}$/), migrationSha256: hash, configSha256: hash,
    dbContainerId: hash, networkId: hash, owner: uuid, daemonId: z.string().min(1).max(256),
    runtimeIdentity: z.record(z.string(), z.json()) }).strict(), installed_at: z.iso.datetime({ offset: true }),
  fit_artifact: statisticalFitArtifactSchema,
  fit_artifact_sha256: z.literal(STATISTICAL_FIT_ARTIFACT_SHA256), fit_package: statisticalFitPackageSchema,
  fit_package_digest: z.literal(expectedPackageDigest),
}).strict();
const coverageFailureSchema = z.object({ schema_version: z.literal(2),
  figure_basis: z.object({ version: z.literal(1), basis: z.literal("observed") }).strict(),
  kind: z.literal("coverage_failure"), metric: z.literal("score_coverage"), measured_value: z.number().min(0).lt(QC_THRESHOLDS.scoreCoverageFloor),
  required_minimum: z.literal(QC_THRESHOLDS.scoreCoverageFloor), display_copy_id: z.literal("embryo.result.insufficient-coverage") }).strict();
const observedMeasurementSchema = z.object({ version: z.literal(1), producer: z.literal("embryo-test-score-coverage-v1"),
  panelId: z.literal("synthetic-score-coverage-v1"), source: embryoCarrierSourceSchema,
  matchedVariants: z.number().int().min(0).max(10), requiredVariants: z.literal(10), scoreCoverage: z.number().min(0).max(1),
  rows: z.array(z.object({ variantId: z.string(), state: z.enum(["matched", "not_covered", "invalid_call", "source_call_disputed"]) }).strict()).length(10),
}).strict().refine(value => value.rows.every((row, index) => row.variantId === TEST_STATISTICAL_SCORE_PANEL.variants[index].id)
  && value.matchedVariants === value.rows.filter(row => row.state === "matched").length
  && value.scoreCoverage === value.matchedVariants / 10
  && value.source.source_sha256 === value.source.source_binding_fingerprint
  && value.source.upload_revision === value.source.normalization_source_revision);
export const statisticalFitSaveRowSchema = z.object({ embryoId: uuid, conditionId: z.literal("SYNTHETIC:9001"),
  measurement: observedMeasurementSchema.nullable(), finding: coverageFailureSchema.nullable(),
  reason: z.enum(RESULT_NOT_REPORTABLE_REASON_IDS), result: statisticalFitResultSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  const refuse = () => ctx.addIssue({ code: "custom", message: "Separate observed coverage and synthetic fit required" });
  if (value.measurement === null) {
    if (value.finding !== null || value.result !== null || !(QC_REASON_IDS as readonly string[]).includes(value.reason)) refuse();
  } else if (value.measurement.source.embryo_id !== value.embryoId) refuse();
  else if (value.measurement.scoreCoverage < QC_THRESHOLDS.scoreCoverageFloor) {
    if (value.result !== null || value.reason !== "insufficient_coverage" || value.finding?.measured_value !== value.measurement.scoreCoverage) refuse();
  } else if (value.finding !== null || value.reason !== "sex_combined_model_unavailable" || value.result === null) refuse();
});
export type StatisticalFitSaveRow = z.infer<typeof statisticalFitSaveRowSchema>;
export const statisticalFittedReceiptSchema = z.object({ version: z.literal(1), producer: z.literal("embryo-test-statistical-fit-v1"),
  job_id: uuid, attempt: z.number().int().min(1).max(20), capture_sha256: hash, condition_id: z.literal("SYNTHETIC:9001"),
  source: embryoCarrierSourceSchema.nullable(), reference_receipt: statisticalFitReferenceSchema,
  measurement: statisticalFitSaveRowSchema, publication: z.literal("synthetic-fitted-test-only"), interpretation: z.literal("held"),
  clinicalPublication: z.literal(false), fitPackage: statisticalFitPackageSchema, fitPackageDigest: z.literal(expectedPackageDigest),
}).strict().refine(value => JSON.stringify(value.source) === JSON.stringify(value.measurement.measurement?.source ?? null)
  || value.measurement.measurement === null);
const fittedReadRowSchema = z.object({ embryoId: uuid, sampleOrdinal: z.number().int().min(0).max(63),
  conditionId: z.literal("SYNTHETIC:9001"), conditionName: z.literal("Synthetic score coverage"),
  coverageState: z.enum(["not_covered", "quality_not_measurable"]), reason: z.enum(RESULT_NOT_REPORTABLE_REASON_IDS),
  matchedVariants: z.number().int().min(0).max(10).nullable(), requiredVariants: z.literal(10).nullable(),
  scoreCoverage: z.number().min(0).max(1).nullable(), finding: coverageFailureSchema.nullable(),
  result: statisticalFitResultSchema.nullable(), receipt: statisticalFittedReceiptSchema,
}).strict();
export const statisticalFittedReadSchema = z.object({ version: z.literal(1), producer: z.literal("embryo-test-statistical-fit-v1"),
  jurisdiction: z.literal("TEST-LOCAL"), cohortId: uuid, publicationRevision: z.number().int().positive().safe(),
  jobId: uuid, attempt: z.number().int().min(1).max(20), captureSha256: hash, interpretation: z.literal("held"),
  publication: z.literal("synthetic-fitted-test-only"), clinicalPublication: z.literal(false), rows: z.array(fittedReadRowSchema).min(1).max(64),
}).strict().superRefine((value, ctx) => {
  const refuse = () => ctx.addIssue({ code: "custom", message: "Complete current fitted receipt required" });
  if (new Set(value.rows.map(row => row.embryoId)).size !== value.rows.length) refuse();
  value.rows.forEach((row, index) => {
    const receipt = row.receipt, expected = receipt.measurement, measurement = expected.measurement;
    if (row.sampleOrdinal !== index || receipt.job_id !== value.jobId || receipt.attempt !== value.attempt
      || receipt.capture_sha256 !== value.captureSha256 || receipt.condition_id !== row.conditionId
      || expected.embryoId !== row.embryoId || expected.conditionId !== row.conditionId || expected.reason !== row.reason
      || JSON.stringify(expected.finding) !== JSON.stringify(row.finding) || JSON.stringify(expected.result) !== JSON.stringify(row.result)
      || (measurement === null && (row.coverageState !== "quality_not_measurable" || row.matchedVariants !== null
        || row.requiredVariants !== null || row.scoreCoverage !== null))
      || (measurement !== null && (row.coverageState !== "not_covered" || row.matchedVariants !== measurement.matchedVariants
        || row.requiredVariants !== measurement.requiredVariants || row.scoreCoverage !== measurement.scoreCoverage))) refuse();
    if (receipt.source !== null && (receipt.source.embryo_id !== row.embryoId || receipt.source.cohort_id !== value.cohortId
      || receipt.source.source_publication_revision !== value.publicationRevision)) refuse();
  });
});
export type StatisticalFittedRead = z.infer<typeof statisticalFittedReadSchema>;
