import { z } from "zod";

/**
 * The finalization phase machine, defined once for both sides of the boundary.
 *
 * `20260909210000_own_upload_finalization_checkpoints.sql` enforces these same
 * rules in the database, because a client is never the authority on its own
 * progress. This module exists so the route computes the next step and the next
 * checkpoint from one place, and so a checkpoint the database would reject is
 * never sent in the first place. `finalization-progress.test.ts` asserts the
 * phase order here still equals the order in that migration.
 *
 * Only `verifying` resumes mid-object. Rehashing the promoted copy reads plain
 * bytes, so an offset and a saved digest state resume it exactly. Validation
 * decompresses, and gzip decoder state cannot be serialised, so `validated` is
 * recorded once and re-run from the start if it was never reached.
 */
export const FINALIZATION_PHASES = ["validated", "copied", "verifying", "verified", "staging-removed"] as const;
export type FinalizationPhase = (typeof FINALIZATION_PHASES)[number];

const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const finalizationCheckpointSchema = z.object({
  version: z.literal("own-upload-finalization-checkpoint-v1"),
  phase: z.enum(FINALIZATION_PHASES),
  rawSha256: digest,
  decodedSha256: digest,
  verifiedBytes: z.number().int().nonnegative().safe(),
  digestState: z.string().regex(/^[A-Za-z0-9+/]{1,4096}={0,2}$/).nullable(),
}).strict();
export type FinalizationCheckpoint = z.infer<typeof finalizationCheckpointSchema>;

export const finalizationCheckpointReceiptSchema = z.object({
  version: z.literal("own-upload-finalization-checkpoint-receipt-v1"),
  uploadId: z.uuid(),
  revision: z.number().int().nonnegative().safe(),
  leaseExpiresAt: z.iso.datetime({ offset: true }).nullable(),
  checkpoint: finalizationCheckpointSchema.nullable(),
}).strict();

export function finalizationPhaseRank(phase: FinalizationPhase): number {
  return FINALIZATION_PHASES.indexOf(phase) + 1;
}

/** The one work item a resumed finalization should do next. */
export type FinalizationStep =
  | { step: "validate" }
  | { step: "copy" }
  | { step: "verify"; fromByte: number; digestState: string | null }
  | { step: "remove-staging" }
  | { step: "publish" };

/**
 * What remains, given what this claim already proved. A missing checkpoint
 * means nothing is proved yet, which is the ordinary first attempt.
 */
export function nextFinalizationStep(checkpoint: FinalizationCheckpoint | null): FinalizationStep {
  if (!checkpoint) return { step: "validate" };
  switch (checkpoint.phase) {
    case "validated": return { step: "copy" };
    case "copied": return { step: "verify", fromByte: 0, digestState: null };
    case "verifying": return { step: "verify", fromByte: checkpoint.verifiedBytes, digestState: checkpoint.digestState };
    case "verified": return { step: "remove-staging" };
    case "staging-removed": return { step: "publish" };
  }
}

class FinalizationProgressError extends Error {
  constructor(readonly code: "checkpoint_regression" | "invalid_checkpoint") { super(code); }
}

/**
 * The next checkpoint to record, refusing anything the database would refuse.
 * Catching it here keeps a doomed write off the wire; the database still checks
 * everything itself, because this side is not the authority.
 */
export function advanceFinalization(current: FinalizationCheckpoint | null, next: {
  phase: FinalizationPhase; rawSha256: string; decodedSha256: string;
  verifiedBytes?: number; digestState?: string | null; expectedSize: number;
}): FinalizationCheckpoint {
  const rank = finalizationPhaseRank(next.phase);
  const verifiedBytes = next.verifiedBytes ?? 0;
  const digestState = next.digestState ?? null;
  const candidate = {
    version: "own-upload-finalization-checkpoint-v1" as const, phase: next.phase,
    rawSha256: next.rawSha256, decodedSha256: next.decodedSha256, verifiedBytes, digestState,
  };
  if (!finalizationCheckpointSchema.safeParse(candidate).success) throw new FinalizationProgressError("invalid_checkpoint");
  // Resumable state belongs to partial verification and nowhere else, and only
  // partial verification may stop short of the whole object.
  if ((digestState !== null) !== (rank === 3)) throw new FinalizationProgressError("invalid_checkpoint");
  if (rank < 3 && verifiedBytes !== 0) throw new FinalizationProgressError("invalid_checkpoint");
  if (verifiedBytes > next.expectedSize) throw new FinalizationProgressError("invalid_checkpoint");
  if (rank >= 4 && verifiedBytes !== next.expectedSize) throw new FinalizationProgressError("invalid_checkpoint");
  if (current) {
    const currentRank = finalizationPhaseRank(current.phase);
    // A changed hash is a different source, not a resumption of this one.
    if (current.rawSha256 !== candidate.rawSha256 || current.decodedSha256 !== candidate.decodedSha256) {
      throw new FinalizationProgressError("checkpoint_regression");
    }
    if (rank < currentRank || (rank === currentRank && verifiedBytes < current.verifiedBytes)) {
      throw new FinalizationProgressError("checkpoint_regression");
    }
  }
  return candidate;
}

export { FinalizationProgressError };
