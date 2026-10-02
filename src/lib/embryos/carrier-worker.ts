import "server-only";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createAdminClient } from "../supabase/admin";
import { carrierAssertionRowSchema } from "../family/carrier-assertions";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { allowedConditionsRegistry, type AllowedConditionsFile } from "./allowed-conditions";
import { embryoCarrierSourceSchema, observeEmbryoCarrierAllele, type EmbryoCarrierObservation } from "./carrier-observation";
import { preciseEmbryoQcRowSchema } from "./qc-reader";
import { producesFigure, qcReasons } from "./qc-policy";

const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/);
const conditionSchema = z.object({ condition_id: z.string().min(1).max(80),
  condition_registry: z.array(z.object({ condition_id: z.string(), condition_name: z.string(),
    category: z.literal("Having children"), active: z.literal(true) }).strict()).length(1),
  assertions: z.array(carrierAssertionRowSchema).length(1), reference_receipt: z.json(),
}).strict();
const embryoSchema = z.object({ embryoId: uuid, sampleOrdinal: z.number().int().min(0).max(63),
  source: embryoCarrierSourceSchema.nullable(), qc: preciseEmbryoQcRowSchema,
}).strict();
const captureSchema = z.object({ version: z.literal("embryo-carrier-capture-v1"), cohortId: uuid,
  publicationRevision: z.number().int().positive().safe(), registry: z.json(),
  authority: z.json(), conditions: z.array(conditionSchema).min(1).max(50),
  embryos: z.array(embryoSchema).min(1).max(64),
}).strict();
const claimSchema = z.object({ version: z.literal("embryo-carrier-claim-v1"), jobId: uuid,
  attempt: z.number().int().min(1).max(20), claimExpiresAt: z.iso.datetime({ offset: true }),
  deadline: z.iso.datetime({ offset: true }), captureSha256: hash, capture: captureSchema,
}).strict();
const checkSchema = claimSchema.extend({ version: z.literal("embryo-carrier-check-v1") });
const callsSchema = z.object({ version: z.literal("embryo-carrier-calls-v1"), jobId: uuid,
  attempt: z.number().int().min(1).max(20), captureSha256: hash, embryoId: uuid,
  conditionId: z.string(), calls: z.array(z.object({ fileId: uuid, chrom: z.number().int().min(1).max(22),
    pos: z.number().int().positive().safe(), ref: z.string().regex(/^[ACGT]+$/),
    alt: z.string().regex(/^[ACGT]+$/).nullable(), genotype: z.string().regex(/^(?:[ACGT]+\/[ACGT]+|--)$/),
  }).strict()).max(256),
}).strict();
const cancelledSchema = z.object({ status: z.literal("cancelled") }).strict();
const savedSchema = z.object({ status: z.literal("saved_held"), jobId: uuid,
  attempt: z.number().int().min(1).max(20), captureSha256: hash,
  saved: z.number().int().positive().max(3200), publication: z.literal("held"),
}).strict();

export type EmbryoCarrierRpc = (name: "embryo_carrier_worker_v1", args: {
  p_operation: "claim" | "check" | "read" | "save" | "fail";
  p_job_id: string | null; p_attempt: number | null; p_claim_token_hash: string;
  p_payload: unknown; p_test_jurisdiction: boolean;
}, signal: AbortSignal) => Promise<unknown>;
export type EmbryoCarrierResult = { status: "idle" | "cancelled" | "failed" | "saved_held" }
  | { status: "held"; reason: "no_registered_conditions" };
export interface EmbryoCarrierMeasurement {
  embryoId: string; conditionId: string;
  observation: EmbryoCarrierObservation | null;
  reason: string | null;
}

export class EmbryoCarrierWorkerError extends Error {
  constructor(readonly code: "worker_disabled" | "invalid_response" | "aborted" | "unavailable") {
    super(code); this.name = "EmbryoCarrierWorkerError";
  }
}
function refuse(code: EmbryoCarrierWorkerError["code"]): never { throw new EmbryoCarrierWorkerError(code); }
export function adminEmbryoCarrierRpc(): EmbryoCarrierRpc {
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: object) => {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  };
  return async (name, args, signal) => {
    const result = await rpc(name, args).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    if (result.error !== null) refuse("unavailable");
    return result.data;
  };
}

class Cancelled extends Error {}

/** One awaited cohort attempt. The database owns admission and every exact
 * source/authority binding; caller input cannot select a source or assertion.
 * Results stay in memory until the complete cohort's single guarded save.
 * The save records a truthful private OBSERVED measurement, with publication
 * held until the separate disclosure contract is built. No public DTO, rank,
 * estimate, new genetic input or outside provider is admitted here. */
export async function runNextEmbryoCarrier(options: {
  signal?: AbortSignal; rpc?: EmbryoCarrierRpc;
  /** Synthetic tests only, matching the existing registry injection seam. */
  registry?: AllowedConditionsFile;
} = {}): Promise<EmbryoCarrierResult> {
  if (!isTestJurisdictionEnabled()) refuse("worker_disabled");
  const registry = options.registry ?? allowedConditionsRegistry();
  // Refuse before constructing an admin client or reading a queued capture.
  if (registry.conditions.length === 0) return { status: "held", reason: "no_registered_conditions" };
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => {
    if (signal.aborted) refuse("aborted");
    if (!isTestJurisdictionEnabled()) { controller.abort(); refuse("worker_disabled"); }
  };
  const rpc = options.rpc ?? adminEmbryoCarrierRpc();
  const token = randomBytes(32).toString("hex");
  let claim: z.infer<typeof claimSchema> | undefined;
  const measurements: EmbryoCarrierMeasurement[] = [];
  const call = async (operation: Parameters<EmbryoCarrierRpc>[1]["p_operation"], payload: unknown = null) => {
    active();
    const value = await rpc("embryo_carrier_worker_v1", { p_operation: operation,
      p_job_id: claim?.jobId ?? null, p_attempt: claim?.attempt ?? null,
      p_claim_token_hash: token, p_payload: payload, p_test_jurisdiction: true }, signal);
    active();
    if (cancelledSchema.safeParse(value).success) throw new Cancelled();
    return value;
  };
  try {
    const raw = await call("claim");
    if (raw === null) return { status: "idle" };
    const parsed = claimSchema.safeParse(raw);
    if (!parsed.success) refuse("invalid_response");
    claim = parsed.data;
    if (!isDeepStrictEqual(claim.capture.registry, registry)
      || new Set(claim.capture.conditions.map(row => row.condition_id)).size !== claim.capture.conditions.length
      || !isDeepStrictEqual(claim.capture.conditions.map(row => row.condition_id),
        registry.conditions.map(row => row.condition_id).sort())
      || new Set(claim.capture.embryos.map(row => row.embryoId)).size !== claim.capture.embryos.length
      || claim.capture.embryos.some((row, index) => row.sampleOrdinal !== index
        || row.qc.embryo_id !== row.embryoId || (row.source !== null && (row.source.embryo_id !== row.embryoId
          || row.source.cohort_id !== claim!.capture.cohortId
          || row.source.source_publication_revision !== claim!.capture.publicationRevision)))) refuse("invalid_response");
    const arm = (expiresAt: string) => {
      const remaining = Math.min(Date.parse(expiresAt), Date.parse(claim!.deadline)) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) refuse("invalid_response");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), remaining); timer.unref();
    };
    arm(claim.claimExpiresAt);
    const check = async () => {
      const current = checkSchema.safeParse(await call("check"));
      if (!current.success || current.data.jobId !== claim!.jobId || current.data.attempt !== claim!.attempt
        || current.data.captureSha256 !== claim!.captureSha256 || current.data.deadline !== claim!.deadline
        || !isDeepStrictEqual(current.data.capture, claim!.capture)) refuse("invalid_response");
      arm(current.data.claimExpiresAt);
    };
    for (const embryo of claim.capture.embryos) {
      for (const condition of claim.capture.conditions) {
        await check();
        if (embryo.source === null || !producesFigure(embryo.qc)) {
          measurements.push({ embryoId: embryo.embryoId, conditionId: condition.condition_id,
            observation: null, reason: qcReasons(embryo.qc)[0] ?? "qc_review_required" });
          continue;
        }
        const read = callsSchema.safeParse(await call("read", { embryoId: embryo.embryoId, conditionId: condition.condition_id }));
        if (!read.success || read.data.jobId !== claim.jobId || read.data.attempt !== claim.attempt
          || read.data.captureSha256 !== claim.captureSha256 || read.data.embryoId !== embryo.embryoId
          || read.data.conditionId !== condition.condition_id) refuse("invalid_response");
        const assertion = condition.assertions[0];
        const positions = new Set([assertion.pos, ...assertion.equivalents.map(row => row[0])]);
        if (read.data.calls.some(row => row.fileId !== embryo.source!.file_id
          || row.chrom !== assertion.chrom || !positions.has(row.pos))) refuse("invalid_response");
        await check();
        const result = observeEmbryoCarrierAllele({ condition_id: condition.condition_id,
          condition_registry: condition.condition_registry, assertions: condition.assertions,
          source: embryo.source, calls: read.data.calls }, registry);
        measurements.push({ embryoId: embryo.embryoId, conditionId: condition.condition_id,
          observation: result.ok ? result.observation : null, reason: result.ok ? null : result.reason });
        // Do not retain a bounded call page beyond its exact computation.
        read.data.calls.length = 0;
      }
    }
    await check();
    const saved = savedSchema.safeParse(await call("save", { measurements }));
    if (!saved.success || saved.data.jobId !== claim.jobId || saved.data.attempt !== claim.attempt
      || saved.data.captureSha256 !== claim.captureSha256
      || saved.data.saved !== claim.capture.embryos.length * claim.capture.conditions.length) refuse("invalid_response");
    return { status: "saved_held" };
  } catch (error) {
    if (error instanceof Cancelled) return { status: "cancelled" };
    if (signal.aborted || error instanceof EmbryoCarrierWorkerError) throw error;
    if (claim !== undefined) {
      const failed = z.object({ status: z.literal("failed") }).strict().safeParse(await call("fail"));
      if (failed.success) return { status: "failed" };
    }
    return refuse("unavailable");
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    measurements.length = 0;
    claim = undefined;
  }
}
