import Link from "next/link";
import { AutoRefresh } from "@/components/uploads/auto-refresh";
import { Button } from "@/components/ui/button";
import { PRIMARY, STATE_B } from "@/copy/overview";
import { route } from "@/lib/primary-routes";
import { cn } from "@/lib/utils";

// State B (brief §2 §3.3): a labelled plate with a determinate step list for
// the newest file in flight and the measured p50/p95 for its tier — or the
// honest "not enough files" sentence. Never a marketing estimate. The panel
// re-fetches every five seconds so the steps advance without a manual reload.
// The steps are a ruled sequence; the "01" ordinals are CSS counters
// (app.css `.processing-steps`), so each item's text stays the step alone.

export interface ProcessingTiming {
  /** Formatted durations, only when the tier has ≥ 20 measured files. */
  p50: string;
  p95: string;
}

export function ProcessingPanel({
  fileName,
  currentStep,
  timing,
}: {
  fileName: string;
  /** Index into STATE_B.steps of the step now running. */
  currentStep: number;
  timing: ProcessingTiming | null;
}) {
  return (
    <section
      aria-labelledby="processing-title"
      data-density-top-level-section
      className="plate"
    >
      <AutoRefresh active />
      <div className="plate-head">
        <p id="processing-title" className="title text-ink">
          {STATE_B.processing(fileName)}
        </p>
      </div>
      <div className="plate-body">
        <ol className="processing-steps max-w-measure">
          {STATE_B.steps.map((step, index) => {
            const done = index < currentStep;
            const current = index === currentStep;
            return (
              <li
                key={step}
                aria-current={current ? "step" : undefined}
                data-step={current ? "current" : done ? "done" : "upcoming"}
                className={cn(
                  "text-base",
                  current ? "font-medium text-ink" : done ? "text-ink" : "text-ink-muted",
                )}
              >
                {step}
              </li>
            );
          })}
        </ol>
        <p className="mt-5 max-w-measure text-sm text-ink-muted">
          {timing ? STATE_B.timing(timing.p50, timing.p95) : STATE_B.notEnough}
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link href={route("files.upload")}>{PRIMARY.addFile}</Link>
        </Button>
      </div>
    </section>
  );
}
