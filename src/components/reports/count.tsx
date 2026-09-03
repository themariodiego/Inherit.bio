/**
 * <Count> — the only way a report count reaches a page (brief G4.3 read
 * through X5.1). The class prop is mandatory and single-valued, so a merged
 * "{n} reports" spanning layers cannot be emitted; the noun is always the
 * layer word. Emits data-figure-class and data-metric-value. Server
 * component.
 */
import { COUNT_NOUNS } from "@/copy/reports/strings";
import { cn } from "@/lib/utils";

export type CountClass = keyof typeof COUNT_NOUNS;

const plural = new Intl.PluralRules("en-GB");
const grouped = new Intl.NumberFormat("en-GB");

export function countText(value: number, layerClass: CountClass, qualifier?: string): string {
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
  describedBy?: string;
  className?: string;
}

export function Count({ value, layerClass, qualifier, describedBy, className }: CountProps) {
  return (
    <span
      data-slot="count"
      data-figure-class={layerClass}
      data-metric-value={value}
      aria-describedby={describedBy}
      className={cn("tabular-nums text-ink", className)}
    >
      {/* inherit-figure-exempt: a layer-labelled report count is UI chrome, not a result figure */}
      {countText(value, layerClass, qualifier)}
    </span>
  );
}
