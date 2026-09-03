import Link from "next/link";
import { AutoRefresh } from "@/components/uploads/auto-refresh";
import { Button } from "@/components/ui/button";
import { PRIMARY, STATE_B } from "@/copy/overview";
import { cn } from "@/lib/utils";

// State B (brief §2 §3.3): a determinate step list for the newest file in
// flight and the measured p50/p95 for its tier — or the honest "not enough
// files" sentence. Never a marketing estimate. The panel re-fetches every
// five seconds so the steps advance without a manual reload.

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
      className="rounded-2xl border border-line bg-card p-5 sm:p-6"
    >
      <AutoRefresh active />
      <p id="processing-title" className="text-lg font-semibold">
        {STATE_B.processing(fileName)}
      </p>
      <ol className="mt-4 space-y-2">
        {STATE_B.steps.map((step, index) => {
          const done = index < currentStep;
          const current = index === currentStep;
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 text-base",
                current ? "font-medium text-ink" : done ? "text-ink" : "text-ink-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full border-2",
                  done && "border-forest bg-forest",
                  current && "border-forest bg-tint",
                  !done && !current && "border-line",
                )}
              />
              {step}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-muted">
        {timing ? STATE_B.timing(timing.p50, timing.p95) : STATE_B.notEnough}
      </p>
      <Button asChild size="lg" className="mt-5 min-h-11">
        <Link href="/files/upload">{PRIMARY.addFile}</Link>
      </Button>
    </section>
  );
}
