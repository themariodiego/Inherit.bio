import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  advanceFinalization, finalizationCheckpointSchema, finalizationPhaseRank,
  FINALIZATION_PHASES, nextFinalizationStep, type FinalizationCheckpoint,
} from "./finalization-progress";

const raw = "a".repeat(64), decoded = "b".repeat(64), state = "Q".repeat(32);
const size = 4_000;
function mark(phase: FinalizationCheckpoint["phase"], verifiedBytes = 0,
  digestState: string | null = null): FinalizationCheckpoint {
  return { version: "own-upload-finalization-checkpoint-v1", phase, rawSha256: raw,
    decodedSha256: decoded, verifiedBytes, digestState };
}
function advance(current: FinalizationCheckpoint | null, phase: FinalizationCheckpoint["phase"],
  verifiedBytes?: number, digestState?: string | null) {
  return advanceFinalization(current, { phase, rawSha256: raw, decodedSha256: decoded,
    verifiedBytes, digestState, expectedSize: size });
}

describe("the finalization phase machine", () => {
  it("keeps the same phase order as the database that enforces it", () => {
    // One order, two enforcers. A phase added on one side and not the other
    // would let the route record progress the database refuses, or the reverse.
    const migration = readFileSync(
      "supabase/migrations/20260909210000_own_upload_finalization_checkpoints.sql", "utf8");
    const declared = /array\[([^\]]+)\],p_phase\)/.exec(migration)?.[1];
    expect(declared).toBeDefined();
    expect(declared!.split(",").map(part => part.trim().replace(/^'|'$/g, "")))
      .toEqual([...FINALIZATION_PHASES]);
  });

  it("ranks phases from one, so an absent checkpoint outranks nothing", () => {
    expect(FINALIZATION_PHASES.map(finalizationPhaseRank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("choosing what a resumed finalization does next", () => {
  it("starts from the beginning when nothing was proved", () => {
    expect(nextFinalizationStep(null)).toEqual({ step: "validate" });
  });

  it("never re-runs validation once it is recorded", () => {
    // Validation decompresses, so it cannot resume mid-file; what it proved is
    // kept instead of repeated.
    expect(nextFinalizationStep(mark("validated"))).toEqual({ step: "copy" });
  });

  it("resumes copy verification at the exact offset it reached", () => {
    expect(nextFinalizationStep(mark("copied"))).toEqual({ step: "verify", fromByte: 0, digestState: null });
    expect(nextFinalizationStep(mark("verifying", 2_048, state)))
      .toEqual({ step: "verify", fromByte: 2_048, digestState: state });
  });

  it("finishes through staging removal and publication", () => {
    expect(nextFinalizationStep(mark("verified", size))).toEqual({ step: "remove-staging" });
    expect(nextFinalizationStep(mark("staging-removed", size))).toEqual({ step: "publish" });
  });

  it("covers every phase, so no state silently has no next step", () => {
    for (const phase of FINALIZATION_PHASES) {
      const verified = finalizationPhaseRank(phase) >= 4 ? size : 0;
      const digestState = phase === "verifying" ? state : null;
      expect(nextFinalizationStep(mark(phase, verified, digestState))).toBeTruthy();
    }
  });
});

describe("recording the next checkpoint", () => {
  it("advances through the ordinary sequence", () => {
    const validated = advance(null, "validated");
    expect(validated.phase).toBe("validated");
    const copied = advance(validated, "copied");
    const partway = advance(copied, "verifying", 1_000, state);
    expect(partway.verifiedBytes).toBe(1_000);
    const further = advance(partway, "verifying", 3_000, state);
    const verified = advance(further, "verified", size);
    expect(verified.digestState).toBeNull();
    expect(advance(verified, "staging-removed", size).phase).toBe("staging-removed");
  });

  it("refuses to move backwards or shorten what was verified", () => {
    const copied = advance(advance(null, "validated"), "copied");
    expect(() => advance(copied, "validated")).toThrow("checkpoint_regression");
    const partway = advance(copied, "verifying", 3_000, state);
    expect(() => advance(partway, "verifying", 1_000, state)).toThrow("checkpoint_regression");
  });

  it("treats a changed hash as a different source, not a resumption", () => {
    const validated = advance(null, "validated");
    expect(() => advanceFinalization(validated, { phase: "copied", rawSha256: raw,
      decodedSha256: "c".repeat(64), expectedSize: size })).toThrow("checkpoint_regression");
    expect(() => advanceFinalization(validated, { phase: "copied", rawSha256: "c".repeat(64),
      decodedSha256: decoded, expectedSize: size })).toThrow("checkpoint_regression");
  });

  it("keeps resumable state to partial verification alone", () => {
    expect(() => advance(null, "validated", 0, state)).toThrow("invalid_checkpoint");
    expect(() => advance(null, "verifying", 100, null)).toThrow("invalid_checkpoint");
  });

  it("refuses an offset a phase is not entitled to", () => {
    expect(() => advance(null, "validated", 100)).toThrow("invalid_checkpoint");
    expect(() => advance(null, "verifying", size + 1, state)).toThrow("invalid_checkpoint");
    expect(() => advance(null, "verified", size - 1)).toThrow("invalid_checkpoint");
    expect(() => advance(null, "staging-removed", 0)).toThrow("invalid_checkpoint");
  });

  it("refuses a checkpoint the database would reject on shape alone", () => {
    for (const patch of [{ rawSha256: "A".repeat(64) }, { rawSha256: "a".repeat(63) },
      { decodedSha256: "" }, { verifiedBytes: -1 }, { verifiedBytes: 1.5 }]) {
      expect(() => advanceFinalization(null, { phase: "validated", rawSha256: raw,
        decodedSha256: decoded, expectedSize: size, ...patch })).toThrow("invalid_checkpoint");
    }
    expect(finalizationCheckpointSchema.safeParse({ ...mark("validated"), extra: 1 }).success).toBe(false);
    expect(finalizationCheckpointSchema.safeParse({ ...mark("verifying", 1, "not base64!") }).success).toBe(false);
  });
});
