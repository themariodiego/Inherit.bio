import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ownPreparationOriginalSchema, readOwnPreparationLines, scanOwnPreparationSource,
} from "./own-preparation-source";
import { prepareIncrementalVcf, type PositionEntry } from "./incremental-vcf-normalization";
import { preparationWait } from "./own-preparation-artifacts";
import { pathBArrayOriginalSchema, readPathBArrayLines, scanPathBArraySource } from "./path-b-array-source";
import { prepareIncrementalArray } from "./incremental-array-normalization";

const positive = z.number().int().positive().safe();
export const pathBNormalizationOriginalSchema = ownPreparationOriginalSchema.extend({
  fileType: z.enum(["array_23andme", "array_ancestry", "array_myheritage", "array_ftdna", "vcf", "gvcf"]),
}).strict();
export type PathBNormalizationOriginal = z.infer<typeof pathBNormalizationOriginalSchema>;
export const pathBNormalizationClaimSchema = pathBNormalizationOriginalSchema.extend({
  jobId: z.uuid(), claim: z.uuid(), claimExpiresAt: z.iso.datetime({ offset: true }),
}).strict();
type Claim = z.infer<typeof pathBNormalizationClaimSchema>;
const positionReceipt = z.object({ acceptedVariantOrdinals: z.array(z.number().int().nonnegative().safe()),
  attempted: z.number().int().nonnegative().safe(), unmapped: z.number().int().nonnegative().safe() }).strict();
const completeReceipt = z.object({ fileId: z.uuid(), status: z.literal("normalization_complete"),
  analysisState: z.literal("not_generated") }).strict();
export type PathBNormalizationRpc = {
  operation: (args: { p_operation: "claim" | "check" | "stage" | "complete" | "fail";
    p_job_id: string | null; p_claim_hash: string; p_claim: string | null;
    p_payload: unknown | null; p_test_jurisdiction: true }) => PromiseLike<{ data: unknown; error: unknown | null }>;
  register: (args: { p_job_id: string; p_claim_hash: string; p_file_id: string; p_claim: string;
    p_sequence: number; p_source_build: "GRCh37" | "GRCh38"; p_entries: PositionEntry[];
    p_test_jurisdiction: true }) => PromiseLike<{ data: unknown; error: unknown | null }>;
};
export class PathBNormalizationError extends Error {
  constructor() { super("path_b_normalization_unavailable"); this.name = "PathBNormalizationError"; }
}
function unavailable(): never { throw new PathBNormalizationError(); }

/** One finite machine claim. Permission comes only from the server RPC; this
 * adapter neither grants consent nor selects arbitrary files, URLs or actors.
 * Original reads reuse the exact bounded range/hash/build verifier. Genetic
 * batches remain unpublished until EOF and the final live DB fence agree. */
export async function runPathBNormalizationWorker(options: {
  testJurisdiction: boolean; rpc: PathBNormalizationRpc; signal: AbortSignal;
  readRange: (source: PathBNormalizationOriginal, start: number, end: number, signal: AbortSignal) => Promise<Response>;
  lift?: Parameters<typeof prepareIncrementalVcf>[1]["lift"];
  liftoverSha256?: string;
  maximumUnmappedFraction: number;
}) {
  if (!options.testJurisdiction || options.signal.aborted
    || !z.number().min(0).max(1).safeParse(options.maximumUnmappedFraction).success) unavailable();
  const claimHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  let claim: Claim | undefined;
  let signal = options.signal;
  async function call(operation: Parameters<PathBNormalizationRpc["operation"]>[0]["p_operation"], payload: unknown = null) {
    const result = await preparationWait(Promise.resolve(options.rpc.operation({ p_operation: operation,
      p_job_id: claim?.jobId ?? null, p_claim_hash: claimHash, p_claim: claim?.claim ?? null,
      p_payload: payload, p_test_jurisdiction: true })), signal);
    if (result.error) unavailable(); return result.data;
  }
  try {
    const raw = await call("claim");
    if (raw === null) return { status: "idle" as const };
    const parsed = pathBNormalizationClaimSchema.safeParse(raw);
    if (!parsed.success) unavailable();
    claim = parsed.data;
    const remaining = Date.parse(claim.claimExpiresAt) - Date.now();
    if (!Number.isSafeInteger(remaining) || remaining <= 0 || remaining > 300_000) unavailable();
    signal = AbortSignal.any([options.signal, AbortSignal.timeout(remaining)]);
    const array = pathBArrayOriginalSchema.safeParse(Object.fromEntries(Object.entries(claim)
      .filter(([key]) => !["jobId", "claim", "claimExpiresAt"].includes(key))));
    if (array.success) {
      const source = array.data;
      const check = async () => { if (!isDeepStrictEqual(await call("check"), claim)) unavailable(); };
      const original = { source, signal, readRange: options.readRange, check };
      const scan = await scanPathBArraySource(original);
      if (scan.build === "GRCh37" && (!options.lift
        || !z.string().regex(/^[0-9a-f]{64}$/).safeParse(options.liftoverSha256).success)) unavailable();
      const prepared = await prepareIncrementalArray(readPathBArrayLines(original, scan), {
        kind: source.fileType, build: scan.build, maximumUnmappedFraction: options.maximumUnmappedFraction,
        ...(options.lift ? { lift: options.lift } : {}),
        register: async (sequence, entries) => {
          await check();
          const response = await preparationWait(Promise.resolve(options.rpc.register({
            p_job_id: claim!.jobId, p_claim_hash: claimHash, p_file_id: source.fileId,
            p_claim: claim!.claim, p_sequence: sequence, p_source_build: scan.build, p_entries: entries,
            p_test_jurisdiction: true })), signal);
          const receipt = positionReceipt.safeParse(response.data);
          if (response.error || !receipt.success) unavailable();
          await check(); return receipt.data;
        },
        stage: async (kind, sequence, rows) => {
          await check();
          if (await call("stage", { kind, sequence, rows }) !== true) unavailable();
          await check();
        },
      });
      await check();
      const result = completeReceipt.safeParse(await call("complete", {
        sourceBuild: scan.build, rawSha256: scan.rawSha256, decodedSha256: scan.decodedSha256,
        variantCount: prepared.variantCount, observedCallCount: prepared.observedCallCount,
        provenance: { version: "path-b-normalization-v1", sourceRevision: positive.parse(source.sourceRevision),
          liftoverSha256: scan.build === "GRCh37" ? options.liftoverSha256 : null,
          attempted: prepared.attempted, unmapped: prepared.unmapped },
      }));
      if (!result.success || result.data.fileId !== source.fileId) unavailable();
      return { status: "normalized" as const };
    }
    const source = ownPreparationOriginalSchema.parse(Object.fromEntries(Object.entries(claim)
      .filter(([key]) => !["jobId", "claim", "claimExpiresAt"].includes(key))));
    const check = async () => {
      const value = await call("check");
      if (!isDeepStrictEqual(value, claim)) unavailable();
    };
    const original = { source, signal, readRange: options.readRange, check };
    const scan = await scanOwnPreparationSource(original);
    if (scan.build === "GRCh37" && (!options.lift
      || !z.string().regex(/^[0-9a-f]{64}$/).safeParse(options.liftoverSha256).success)) unavailable();
    const prepared = await prepareIncrementalVcf(readOwnPreparationLines(original, scan), {
      build: scan.build, maximumUnmappedFraction: options.maximumUnmappedFraction,
      ...(options.lift ? { lift: options.lift } : {}),
      register: async (sequence, entries) => {
        await check();
        const response = await preparationWait(Promise.resolve(options.rpc.register({
          p_job_id: claim!.jobId, p_claim_hash: claimHash, p_file_id: source.fileId,
          p_claim: claim!.claim, p_sequence: sequence, p_source_build: scan.build, p_entries: entries,
          p_test_jurisdiction: true })), signal);
        const receipt = positionReceipt.safeParse(response.data);
        if (response.error || !receipt.success) unavailable();
        await check(); return receipt.data;
      },
      stage: async (kind, sequence, rows) => {
        await check();
        if (await call("stage", { kind, sequence, rows }) !== true) unavailable();
        await check();
      },
    });
    await check();
    const result = completeReceipt.safeParse(await call("complete", {
      sourceBuild: scan.build, rawSha256: scan.rawSha256, decodedSha256: scan.decodedSha256,
      variantCount: prepared.variantCount, observedCallCount: prepared.observedCallCount,
      provenance: { version: "path-b-normalization-v1", sourceRevision: positive.parse(source.sourceRevision),
        liftoverSha256: scan.build === "GRCh37" ? options.liftoverSha256 : null,
        attempted: prepared.attempted, unmapped: prepared.unmapped },
    }));
    if (!result.success || result.data.fileId !== source.fileId) unavailable();
    return { status: "normalized" as const };
  } catch {
    if (claim) {
      // One bounded cleanup attempt. No source read or uncertain publish replay.
      const cleanupSignal = AbortSignal.timeout(5_000);
      try {
        await preparationWait(Promise.resolve(options.rpc.operation({ p_operation: "fail",
          p_job_id: claim.jobId, p_claim_hash: claimHash, p_claim: claim.claim, p_payload: null,
          p_test_jurisdiction: true })), cleanupSignal);
      } catch { /* The existing expired private-run reaper owns crash cleanup. */ }
    }
    unavailable();
  }
}
