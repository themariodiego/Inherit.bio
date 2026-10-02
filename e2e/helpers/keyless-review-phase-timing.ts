import { performance } from "node:perf_hooks";

const PHASES = ["claim-create", "reviewer-auth", "other-reviewer-auth", "effect-proof",
  "opaque-refusal", "initial-photo", "initial-birth", "themed-photo", "themed-birth",
  "lookup-response", "a11y-themes", "network-audit", "reason-fill", "decision-response"] as const;
type Phase = typeof PHASES[number];
type Record = { diagnostic: "keyless-review-phase-v1"; phase: Phase; sequence: number;
  event: "start" | "complete" | "failed"; elapsedMs: number; durationMs: number };

/** Test-process diagnostics only. Closed labels and monotonic durations never
 * include a URL, identity, token, document, response, result or error value.
 * No timer, timeout, retry, trace or browser behavior is introduced. */
export function keylessReviewPhaseTiming(options: {
  now?: () => number; emit?: (record: Record) => void;
} = {}) {
  const now = options.now ?? (() => performance.now());
  const emit = options.emit ?? (record => console.info(JSON.stringify(record)));
  const origin = now();
  const allowed = new Set<string>(PHASES);
  let sequence = 0;
  const ms = (value: number) => Math.round(value * 1000) / 1000;
  return async <T>(phase: Phase, operation: () => Promise<T>): Promise<T> => {
    if (!allowed.has(phase)) throw new Error("Unregistered keyless review timing phase");
    const started = now(), current = ++sequence;
    emit({ diagnostic: "keyless-review-phase-v1", phase, sequence: current,
      event: "start", elapsedMs: ms(started - origin), durationMs: 0 });
    let complete = false;
    try {
      const result = await operation(); complete = true; return result;
    } finally {
      const ended = now();
      emit({ diagnostic: "keyless-review-phase-v1", phase, sequence: current,
        event: complete ? "complete" : "failed", elapsedMs: ms(ended - origin),
        durationMs: ms(ended - started) });
    }
  };
}
