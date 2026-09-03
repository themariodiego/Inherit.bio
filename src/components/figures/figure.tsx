/**
 * <Figure> renders ONE quantity as one node carrying the four contract
 * attributes (data-figure-kind, data-figure-class, data-figure-basis,
 * data-provenance). Server component: no hooks, no client code.
 *
 * Attribution: a figure rendered by <ClaimBlock> carries no data-subject-*
 * of its own — the block container is its single attributed ancestor. A
 * figure rendered on its own must be given `subject`, and then attributes
 * itself. Never both.
 *
 * `denominator` is passed by <ClaimBlock> so every natural frequency in a
 * block shares one denominator (§X4.1); a standalone figure chooses its own.
 *
 * Kind `relative` is rejected here (type and runtime): relative figures only
 * exist inside <RelativeFigure>, beside both absolute figures.
 */
import { provenanceAttribute, subjectAttributes, type SubjectAttribution } from "@/lib/figures/contract";
import { figureText } from "@/lib/figures/figure-text";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import { cn } from "@/lib/utils";

export interface FigureProps {
  spec: StandaloneFigureSpec;
  denominator?: number | null;
  subject?: SubjectAttribution;
  className?: string;
}

/** Large figures: Fraunces via the theme token, heavier and larger than any relative text. */
const LARGE_KINDS = new Set<StandaloneFigureSpec["kind"]>(["absolute", "ancestry-share"]);

export function Figure({ spec, denominator, subject, className }: FigureProps) {
  if ((spec as { kind: string }).kind === "relative") {
    throw new Error(
      "A relative figure cannot render on its own. Use <RelativeFigure>, which renders it beside both absolute figures.",
    );
  }
  const text = figureText(spec, denominator);
  // A point without an interval does not render at figure size (§3 §5.3).
  const large = LARGE_KINDS.has(spec.kind) && !(spec.kind === "ancestry-share" && "unavailable" in spec.range);
  const leg = spec.kind === "absolute" ? spec.comparisonLeg : undefined;

  return (
    <span
      data-slot="figure"
      data-figure-kind={spec.kind}
      data-figure-class={spec.class}
      data-figure-basis={spec.basis}
      data-provenance={provenanceAttribute(spec.provenance)}
      data-abs-before={leg === "before" ? "true" : undefined}
      data-abs-after={leg === "after" ? "true" : undefined}
      {...(subject ? subjectAttributes(subject) : {})}
      className={cn(
        "inline-flex flex-wrap items-baseline gap-x-2 text-ink tabular-nums",
        large ? "font-display text-2xl font-semibold tracking-tight" : "text-sm",
        className,
      )}
    >
      {spec.kind === "genotype" ? (
        <>
          <span
            data-slot="figure-value"
            className="rounded-full border border-line bg-card px-2 py-0.5 font-mono"
          >
            {text.value}
          </span>
          <span className="sr-only">{spec.label}</span>
        </>
      ) : (
        <span data-slot="figure-value">{text.value}</span>
      )}
      {text.unit ? (
        <span data-slot="figure-unit" className="font-sans text-sm font-normal text-ink-muted">
          {text.unit}
        </span>
      ) : null}
    </span>
  );
}
