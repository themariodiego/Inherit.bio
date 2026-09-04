/**
 * The context strip (brief line 393; register `qcProjection.contextStrip`):
 * three counts only, each with a note of 1–12 words, all derived from
 * `contextStrip()`. Counts are UI chrome, never figures. Server component.
 */
import {
  CONTEXT_ANALYSED_NOTE,
  CONTEXT_NOT_MEASURABLE_NOTE,
  CONTEXT_PASSED_NOTE,
  contextAnalysed,
  contextNotMeasurable,
  contextPassed,
} from "@/copy/embryos/compare";
import type { ContextCountsDto } from "@/lib/embryos/policy";

export function ContextStrip({ counts }: { counts: ContextCountsDto }) {
  const items = [
    { id: "analysed", value: contextAnalysed(counts.embryos_analysed), note: CONTEXT_ANALYSED_NOTE },
    { id: "passed", value: contextPassed(counts.quality_check_passed), note: CONTEXT_PASSED_NOTE },
    { id: "not-measurable", value: contextNotMeasurable(counts.not_measurable), note: CONTEXT_NOT_MEASURABLE_NOTE },
  ];
  return (
    <ul data-slot="context-strip" className="grid gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} data-context={item.id} className="rounded-2xl border border-line bg-card p-4">
          {/* inherit-figure-exempt: the context strip counts embryos, objects the reader can point at */}
          <p data-metric-value="true" className="text-base font-medium text-ink">
            {item.value}
          </p>
          <p className="mt-1 text-sm text-ink-muted">{item.note}</p>
        </li>
      ))}
    </ul>
  );
}
