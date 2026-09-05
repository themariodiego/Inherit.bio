/**
 * <Count> — the only way a report count reaches a page (brief G4.3 read
 * through X5.1). Callers partition by layer; runtime guards require one
 * class, a safe count and a definition id. Explicit starter/unavailable
 * presentations preserve prescribed wording. A class tag alone cannot
 * establish the source of a count. Pure rendering works on server or client.
 */
import { COUNT_NOUNS, cannotNumberSentence } from "@/copy/reports/strings";
import { STARTER } from "@/copy/overview";
import { cn } from "@/lib/utils";

export type CountClass = keyof typeof COUNT_NOUNS;

const plural = new Intl.PluralRules("en-GB");
const grouped = new Intl.NumberFormat("en-GB");

function assertCount(value: number, layerClass: CountClass): void {
  if (!Number.isSafeInteger(value) || value < 0 ||
    (layerClass !== "variant-call" && layerClass !== "estimate")) {
    throw new Error("invalid_report_count");
  }
}

export function countText(value: number, layerClass: CountClass, qualifier?: string): string {
  assertCount(value, layerClass);
  const nouns = COUNT_NOUNS[layerClass];
  const noun = plural.select(value) === "one" ? nouns.one : nouns.other;
  const base = `${grouped.format(value)} ${noun}`;
  return qualifier ? `${base} ${qualifier}` : base;
}

export interface CountProps {
  value: number;
  layerClass: CountClass;
  /** Trailing words, e.g. "covered by your file". */
  qualifier?: string;
  /** id of the layer definition sentence this count's class is explained by. */
  describedBy: string;
  /** The exact unavailable-score sentence is still a single estimate count. */
  wording?: "layer" | "unavailable" | "starter";
  className?: string;
}

export function Count({ value, layerClass, qualifier, describedBy, wording = "layer", className }: CountProps) {
  assertCount(value, layerClass);
  if (typeof describedBy !== "string" || !/^[A-Za-z][\w:.-]*$/.test(describedBy) ||
    (wording !== "layer" && wording !== "unavailable" && wording !== "starter") ||
    (wording === "starter" && (value < 1 || value > 5 || qualifier !== undefined)) ||
    (wording === "unavailable" && (layerClass !== "estimate" || qualifier !== undefined))) {
    throw new Error("invalid_report_count_definition");
  }
  return (
    <span
      data-slot="count"
      data-figure-class={layerClass}
      data-metric-value={value}
      aria-describedby={describedBy}
      className={cn("tabular-nums text-ink", className)}
    >
      {/* inherit-figure-exempt: a layer-labelled report count is UI chrome, not a result figure */}
      {wording === "unavailable" ? cannotNumberSentence(value)
        : wording === "starter" ? (value === 5 ? STARTER.five : STARTER.some(value))
          : countText(value, layerClass, qualifier)}
    </span>
  );
}
