import "server-only";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createAdminClient } from "../supabase/admin";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { embryoCarrierSourceSchema } from "./carrier-observation";
import { preciseEmbryoQcRowSchema } from "./qc-reader";
import { dropoutPermitsPolygenic, producesFigure, qcReasons } from "./qc-policy";
import { measureEmbryoStatisticalCoverage, TEST_STATISTICAL_SCORE_PANEL } from "./statistical-coverage";
import { canonicalStatisticalFitPackage, evaluateStatisticalFitResult, statisticalFitPackageDigest,
  statisticalFitArtifactSchema, statisticalFitPackageSchema, statisticalFitReferenceSchema, statisticalFitSaveRowSchema,
  type StatisticalFitSaveRow } from "./statistical-fit-contract";

const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/);
const embryoSchema = z.object({ embryoId: uuid, sampleOrdinal: z.number().int().min(0).max(63),
  source: embryoCarrierSourceSchema.nullable(), qc: preciseEmbryoQcRowSchema }).strict();
const conditionSchema = z.object({ condition_id: z.literal("SYNTHETIC:9001"),
  condition_name: z.literal("Synthetic score coverage"), reference_receipt: z.json() }).strict();
const captureSchema = z.object({ version: z.literal("embryo-test-statistical-capture-v1"), cohortId: uuid,
  publicationRevision: z.number().int().positive().safe(), panel: z.json(), authority: z.json(),
  conditions: z.array(conditionSchema).length(1), embryos: z.array(embryoSchema).min(1).max(64) }).strict();
const claimSchema = z.object({ version: z.literal("embryo-test-statistical-claim-v1"), jobId: uuid,
  attempt: z.number().int().min(1).max(20), claimExpiresAt: z.iso.datetime({ offset: true }),
  deadline: z.iso.datetime({ offset: true }), captureSha256: hash, capture: captureSchema }).strict();
const checkSchema = claimSchema.omit({ capture: true }).extend({ version: z.literal("embryo-test-statistical-check-v2") });
const callRowSchema = z.object({ fileId: uuid, chrom: z.number().int().min(1).max(22), pos: z.number().int().positive().safe(),
  ref: z.string().max(100000).regex(/^[ACGTN]+$/), alt: z.string().max(100000).regex(/^[ACGTN]+(?:,[ACGTN]+)*$/).nullable(),
  genotype: z.string().max(200001).regex(/^(?:[ACGTN]+(?:\/[ACGTN]+)*|--)$/) }).strict();
const callsSchema = z.object({ version: z.literal("embryo-test-statistical-calls-v1"), jobId: uuid,
  attempt: z.number().int().min(1).max(20), captureSha256: hash, embryoId: uuid,
  conditionId: z.literal("SYNTHETIC:9001"), calls: z.array(callRowSchema).max(256) }).strict();
const heldSchema = z.object({ status: z.literal("held"), reason: z.literal("synthetic_reference_unavailable") }).strict();
const cancelledSchema = z.object({ status: z.literal("cancelled") }).strict();
const savedSchema = z.object({ status: z.literal("saved_held"), jobId: uuid,
  attempt: z.number().int().min(1).max(20), captureSha256: hash, saved: z.number().int().min(1).max(64),
  publication: z.literal("coverage-only") }).strict();
export type StatisticalWorkerRpc = (name: "embryo_test_statistical_worker_v1", args: {
  p_operation: "claim" | "check" | "read" | "save" | "fail"; p_job_id: string | null;
  p_attempt: number | null; p_claim_token_hash: string; p_payload: unknown; p_test_jurisdiction: true;
}, signal: AbortSignal) => Promise<unknown>;
type Measurement = { embryoId: string; conditionId: "SYNTHETIC:9001"; measurement: unknown; finding: unknown; reason: string };
export class StatisticalWorkerError extends Error {
  constructor(readonly code: "worker_disabled" | "invalid_response" | "aborted" | "unavailable") { super(code); }
}
function refuse(code: StatisticalWorkerError["code"]): never { throw new StatisticalWorkerError(code); }
class Cancelled extends Error {}

/** One full current cohort, one bounded native claim/save. No reference or
 * authority injection seam exists. The database independently computes all
 * rows and only publishes coverage; at/above the floor the model stays held. */
export async function runNextEmbryoStatisticalCoverage(options: { signal?: AbortSignal; rpc?: StatisticalWorkerRpc } = {}) {
  if (!isTestJurisdictionEnabled()) refuse("worker_disabled");
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let timer: NodeJS.Timeout | undefined, claim: z.infer<typeof claimSchema> | undefined;
  const measurements: Measurement[] = [], token = randomBytes(32).toString("hex");
  const admin = options.rpc ? null : createAdminClient();
  const rpc: StatisticalWorkerRpc = options.rpc ?? (async (name, args, signal) => {
    const call = admin!.rpc.bind(admin) as unknown as (name: string, args: object) => {
      abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
    const result = await call(name, args).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    if (result.error !== null) refuse("unavailable");return result.data;
  });
  const call = async (operation: Parameters<StatisticalWorkerRpc>[1]["p_operation"], payload: unknown = null) => {
    if (signal.aborted) refuse("aborted");if (!isTestJurisdictionEnabled()) refuse("worker_disabled");
    const value = await rpc("embryo_test_statistical_worker_v1", { p_operation: operation,
      p_job_id: claim?.jobId ?? null, p_attempt: claim?.attempt ?? null, p_claim_token_hash: token,
      p_payload: payload, p_test_jurisdiction: true }, signal);
    if (signal.aborted) refuse("aborted");if (!isTestJurisdictionEnabled()) refuse("worker_disabled");
    if (cancelledSchema.safeParse(value).success || (claim && heldSchema.safeParse(value).success)) throw new Cancelled();
    return value;
  };
  try {
    const raw = await call("claim");
    if (raw === null) return { status: "idle" } as const;
    if (heldSchema.safeParse(raw).success) return { status: "held", reason: "synthetic_reference_unavailable" } as const;
    const parsed = claimSchema.safeParse(raw);if (!parsed.success) refuse("invalid_response");claim = parsed.data;
    if (!isDeepStrictEqual(claim.capture.panel, TEST_STATISTICAL_SCORE_PANEL)
      || new Set(claim.capture.embryos.map(row => row.embryoId)).size !== claim.capture.embryos.length
      || claim.capture.embryos.some((row, index) => row.sampleOrdinal !== index || row.qc.embryo_id !== row.embryoId
        || (row.source !== null && (row.source.embryo_id !== row.embryoId || row.source.cohort_id !== claim!.capture.cohortId
          || row.source.source_publication_revision !== claim!.capture.publicationRevision)))) refuse("invalid_response");
    const arm = (expiresAt: string) => {
      const remaining = Math.min(Date.parse(expiresAt), Date.parse(claim!.deadline)) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) refuse("invalid_response");
      clearTimeout(timer);timer = setTimeout(() => controller.abort(), remaining);timer.unref();
    };
    arm(claim.claimExpiresAt);
    const check = async () => {
      const current = checkSchema.safeParse(await call("check"));
      if (!current.success || current.data.jobId !== claim!.jobId || current.data.attempt !== claim!.attempt
        || current.data.captureSha256 !== claim!.captureSha256 || current.data.deadline !== claim!.deadline) refuse("invalid_response");
      arm(current.data.claimExpiresAt);
    };
    for (const embryo of claim.capture.embryos) {
      await check();
      let measurement: unknown = null, finding: unknown = null, reason: string;
      if (embryo.source === null || !producesFigure(embryo.qc) || !dropoutPermitsPolygenic(embryo.qc.allelic_dropout_estimate)) {
        reason = qcReasons(embryo.qc)[0] ?? "qc_review_required";
      } else {
        const read = callsSchema.safeParse(await call("read", { embryoId: embryo.embryoId, conditionId: "SYNTHETIC:9001" }));
        if (!read.success || read.data.jobId !== claim.jobId || read.data.attempt !== claim.attempt
          || read.data.captureSha256 !== claim.captureSha256 || read.data.embryoId !== embryo.embryoId
          || read.data.calls.some(call => call.fileId !== embryo.source!.file_id
            || !TEST_STATISTICAL_SCORE_PANEL.variants.some(variant => variant.chrom === call.chrom && variant.pos === call.pos))) refuse("invalid_response");
        await check();
        const result = measureEmbryoStatisticalCoverage({ panel: TEST_STATISTICAL_SCORE_PANEL, source: embryo.source, calls: read.data.calls });
        read.data.calls.length = 0;
        if (!result.ok) reason = "qc_review_required";
        else { measurement = result.measurement;finding = result.finding;
          reason = finding ? "insufficient_coverage" : "sex_combined_model_unavailable"; }
      }
      measurements.push({ embryoId: embryo.embryoId, conditionId: "SYNTHETIC:9001", measurement, finding, reason });
    }
    await check();
    const saved = savedSchema.safeParse(await call("save", { measurements }));
    if (!saved.success || saved.data.jobId !== claim.jobId || saved.data.attempt !== claim.attempt
      || saved.data.captureSha256 !== claim.captureSha256 || saved.data.saved !== measurements.length) refuse("invalid_response");
    return { status: "saved_coverage" } as const;
  } catch (error) {
    if (error instanceof Cancelled) return { status: "cancelled" } as const;
    if (signal.aborted) refuse("aborted");
    if (error instanceof StatisticalWorkerError) throw error;
    if (claim) {
      try { if (isDeepStrictEqual(await call("fail"), { status: "failed" })) return { status: "failed" } as const; }
      catch { if (signal.aborted) refuse("aborted"); }
    }
    return refuse("unavailable");
  } finally { clearTimeout(timer);controller.abort();measurements.length = 0;claim = undefined; }
}

const fitConditionSchema = conditionSchema.extend({ reference_receipt: statisticalFitReferenceSchema });
const fitCaptureSchema = captureSchema.extend({ version: z.literal("embryo-test-statistical-fit-capture-v1"),
  conditions: z.array(fitConditionSchema).length(1),
  fitArtifact: statisticalFitArtifactSchema,
  fitPackage: statisticalFitPackageSchema, fitPackageDigest: z.literal(statisticalFitPackageDigest(canonicalStatisticalFitPackage())),
});
const fitClaimSchema = claimSchema.extend({ version: z.literal("embryo-test-statistical-fit-claim-v1"), capture: fitCaptureSchema });
const fitCheckSchema = checkSchema.extend({ version: z.literal("embryo-test-statistical-fit-check-v1") });
const fitCallsSchema = callsSchema.extend({ version: z.literal("embryo-test-statistical-fit-calls-v1") });
const fitSavedSchema = savedSchema.extend({ publication: z.literal("synthetic-fitted-test-only") });
export type StatisticalFitWorkerRpc = (name: "embryo_test_statistical_fit_worker_v1", args: Parameters<StatisticalWorkerRpc>[1],
  signal: AbortSignal) => Promise<unknown>;

/** Separate disposable TEST fitted claim. The original coverage-only worker
 * is never upgraded, and a fitted package alone cannot claim or publish a row.
 * Native save independently recomputes the entire cohort and exact result. */
export async function runNextEmbryoStatisticalFit(options: { signal?: AbortSignal; rpc?: StatisticalFitWorkerRpc } = {}) {
  if (!isTestJurisdictionEnabled()) refuse("worker_disabled");
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let timer: NodeJS.Timeout | undefined, claim: z.infer<typeof fitClaimSchema> | undefined;
  const measurements: StatisticalFitSaveRow[] = [], token = randomBytes(32).toString("hex");
  const admin = options.rpc ? null : createAdminClient();
  const rpc: StatisticalFitWorkerRpc = options.rpc ?? (async (name, args, signal) => {
    const call = admin!.rpc.bind(admin) as unknown as (name: string, args: object) => {
      abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
    const response = await call(name, args).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    if (response.error !== null) refuse("unavailable");return response.data;
  });
  const call = async (operation: Parameters<StatisticalFitWorkerRpc>[1]["p_operation"], payload: unknown = null) => {
    if (signal.aborted) refuse("aborted");if (!isTestJurisdictionEnabled()) refuse("worker_disabled");
    const value = await rpc("embryo_test_statistical_fit_worker_v1", { p_operation: operation,
      p_job_id: claim?.jobId ?? null, p_attempt: claim?.attempt ?? null, p_claim_token_hash: token,
      p_payload: payload, p_test_jurisdiction: true }, signal);
    if (signal.aborted) refuse("aborted");if (!isTestJurisdictionEnabled()) refuse("worker_disabled");
    if (cancelledSchema.safeParse(value).success || (claim && heldSchema.safeParse(value).success)) throw new Cancelled();
    return value;
  };
  try {
    const raw = await call("claim");
    if (raw === null) return { status: "idle" } as const;
    if (heldSchema.safeParse(raw).success) return { status: "held", reason: "synthetic_reference_unavailable" } as const;
    const parsed = fitClaimSchema.safeParse(raw);if (!parsed.success) refuse("invalid_response");claim = parsed.data;
    if (!isDeepStrictEqual(claim.capture.panel, TEST_STATISTICAL_SCORE_PANEL)
      || new Set(claim.capture.embryos.map(row => row.embryoId)).size !== claim.capture.embryos.length
      || claim.capture.embryos.some((row, index) => row.sampleOrdinal !== index || row.qc.embryo_id !== row.embryoId
        || (row.source !== null && (row.source.embryo_id !== row.embryoId || row.source.cohort_id !== claim!.capture.cohortId
          || row.source.source_publication_revision !== claim!.capture.publicationRevision)))) refuse("invalid_response");
    const arm = (expiresAt: string) => {
      const remaining = Math.min(Date.parse(expiresAt), Date.parse(claim!.deadline)) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) refuse("invalid_response");
      clearTimeout(timer);timer = setTimeout(() => controller.abort(), remaining);timer.unref();
    };
    arm(claim.claimExpiresAt);
    const check = async () => {
      const current = fitCheckSchema.safeParse(await call("check"));
      if (!current.success || current.data.jobId !== claim!.jobId || current.data.attempt !== claim!.attempt
        || current.data.captureSha256 !== claim!.captureSha256 || current.data.deadline !== claim!.deadline) refuse("invalid_response");
      arm(current.data.claimExpiresAt);
    };
    for (const embryo of claim.capture.embryos) {
      await check();
      let measurement: unknown = null, finding: unknown = null, reason: string, result: unknown = null;
      if (embryo.source === null || !producesFigure(embryo.qc) || !dropoutPermitsPolygenic(embryo.qc.allelic_dropout_estimate)) {
        reason = qcReasons(embryo.qc)[0] ?? "qc_review_required";
      } else {
        const read = fitCallsSchema.safeParse(await call("read", { embryoId: embryo.embryoId, conditionId: "SYNTHETIC:9001" }));
        if (!read.success || read.data.jobId !== claim.jobId || read.data.attempt !== claim.attempt
          || read.data.captureSha256 !== claim.captureSha256 || read.data.embryoId !== embryo.embryoId
          || read.data.calls.some(call => call.fileId !== embryo.source!.file_id
            || !TEST_STATISTICAL_SCORE_PANEL.variants.some(variant => variant.chrom === call.chrom && variant.pos === call.pos))) refuse("invalid_response");
        try {
          await check();
          const observed = measureEmbryoStatisticalCoverage({ panel: TEST_STATISTICAL_SCORE_PANEL, source: embryo.source, calls: read.data.calls });
          if (!observed.ok) reason = "qc_review_required";
          else {
            measurement = observed.measurement;finding = observed.finding;
            reason = finding ? "insufficient_coverage" : "sex_combined_model_unavailable";
            if (finding === null) {
              const modelled = evaluateStatisticalFitResult({ source: embryo.source, calls: read.data.calls,
                qc: { callRate: embryo.qc.call_rate, contamination: embryo.qc.contamination_estimate,
                  alleleDropout: embryo.qc.allelic_dropout_estimate } });
              if (!modelled.ok) refuse("invalid_response");result = modelled.result;
            }
          }
        } finally { read.data.calls.length = 0; }
      }
      const expected = statisticalFitSaveRowSchema.safeParse({ embryoId: embryo.embryoId, conditionId: "SYNTHETIC:9001",
        measurement, finding, reason, result });
      if (!expected.success) refuse("invalid_response");measurements.push(expected.data);
    }
    await check();
    const saved = fitSavedSchema.safeParse(await call("save", { measurements }));
    if (!saved.success || saved.data.jobId !== claim.jobId || saved.data.attempt !== claim.attempt
      || saved.data.captureSha256 !== claim.captureSha256 || saved.data.saved !== measurements.length) refuse("invalid_response");
    return { status: "saved_fitted_test" } as const;
  } catch (error) {
    if (error instanceof Cancelled) return { status: "cancelled" } as const;
    if (signal.aborted) refuse("aborted");
    if (error instanceof StatisticalWorkerError) throw error;
    if (claim) {
      try { if (isDeepStrictEqual(await call("fail"), { status: "failed" })) return { status: "failed" } as const; }
      catch { if (signal.aborted) refuse("aborted"); }
    }
    return refuse("unavailable");
  } finally { clearTimeout(timer);controller.abort();measurements.length = 0;claim = undefined; }
}
