/**
 * The governing sentence (brief §4 §6.1), rendered once above the table on
 * every load, never inside a collapsible, and marked as required accuracy
 * for the density measurement. Server component. On a hub with no cohort
 * the sentence is required but outranks nothing: `tone="quiet"` sets it at
 * body size in the muted ink.
 */
import { STANDING_STATEMENT } from "@/copy/embryos/compare";

export function StandingStatement({
  text = STANDING_STATEMENT,
  tone = "lead",
}: {
  text?: string;
  tone?: "lead" | "quiet";
}) {
  return (
    <p
      data-slot="standing-statement"
      data-density-required-accuracy="true"
      className={tone === "quiet" ? "max-w-measure text-base leading-relaxed text-ink-muted" : "body-lg max-w-measure text-ink"}
    >
      {text}
    </p>
  );
}
