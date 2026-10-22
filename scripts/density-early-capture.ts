import { DENSITY_EARLY_CAPTURE_STAGES } from "./comprehension/hosted-owned-diagnostics";
import { freshRuntimeFailureClassification } from "./comprehension/fresh-t6-resources";

export type DensityEarlyCaptureStage = typeof DENSITY_EARLY_CAPTURE_STAGES[number];
export type DensityEarlyCaptureMetadata = Pick<ReturnType<typeof freshRuntimeFailureClassification>, "classification" | "exitCode" | "signal">;
export type DensityEarlyCaptureObserver = (stage: DensityEarlyCaptureStage, metadata: Readonly<DensityEarlyCaptureMetadata>) => void;
/** Metadata supplements the actual rejection only. An unavailable diagnostic
 * sink cannot replace the original error, return a result or assert cleanup. */
function report(stage: DensityEarlyCaptureStage, error: unknown, observe?: DensityEarlyCaptureObserver) {
  if (!observe) return;
  try {
    const metadata = freshRuntimeFailureClassification(error);
    observe(stage, Object.freeze({ classification: metadata.classification, exitCode: metadata.exitCode, signal: metadata.signal }));
  } catch { /* Retain the original operation's exact rejection. */ }
}
export function densityEarlyCaptureStep<T>(stage: DensityEarlyCaptureStage, operation: () => T, observe?: DensityEarlyCaptureObserver): T {
  try { return operation(); } catch (error) { report(stage, error, observe); throw error; }
}
export async function densityEarlyCaptureAsyncStep<T>(stage: DensityEarlyCaptureStage, operation: () => Promise<T>, observe?: DensityEarlyCaptureObserver): Promise<T> {
  try { return await operation(); } catch (error) { report(stage, error, observe); throw error; }
}
