/**
 * The governing sentence (brief §4 §6.1), rendered once above the table on
 * every load, never inside a collapsible, and marked as required accuracy
 * for the density measurement. Server component.
 */
import { STANDING_STATEMENT } from "@/copy/embryos/compare";

export function StandingStatement({ text = STANDING_STATEMENT }: { text?: string }) {
  return (
    <p
      data-slot="standing-statement"
      data-density-required-accuracy="true"
      className="max-w-prose text-base leading-relaxed text-ink"
    >
      {text}
    </p>
  );
}
