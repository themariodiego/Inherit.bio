/**
 * FigureSpec — the data a page hands to <ClaimBlock figures={[…]}>. One spec
 * renders as one <Figure> node. Every spec names its class, basis and
 * provenance; the kind-specific fields are what the kind needs to render.
 *
 * `relative` is not a standalone spec: it exists only inside <RelativeFigure>,
 * which renders it beside both absolute figures. <Figure> rejects it at the
 * type level (StandaloneFigureSpec) and at runtime.
 */
import type { FigureBasis, FigureClass, FigureKind, FigureProvenance } from "./contract";

interface FigureCommon {
  class: FigureClass;
  basis: FigureBasis;
  provenance: FigureProvenance;
}

export type AbsoluteSpec = FigureCommon & {
  kind: "absolute";
  /** Probability in [0, 1]. */
  value: number;
  /** The reference group the natural frequency is "in", e.g. "people like you". */
  group: string;
  /** Set by <RelativeFigure> only: exposes data-abs-before / data-abs-after. */
  comparisonLeg?: "before" | "after";
};

export type NaturalFrequencySpec = FigureCommon &
  (
    | { kind: "natural-frequency"; value: number }
    | {
        kind: "natural-frequency";
        subject: number;
        comparator: number;
        subjectGroup: string;
        comparatorGroup: string;
      }
  );

export type PercentileSpec = FigureCommon & { kind: "percentile"; value: number };

export type CoverageSpec = FigureCommon & { kind: "coverage"; read: number; needed: number };

export type IntervalSpec = FigureCommon & {
  kind: "interval";
  point: number;
  low: number;
  high: number;
};

export type GenotypeSpec = FigureCommon & {
  kind: "genotype";
  /** The letters, e.g. "A/C". */
  genotype: string;
  /** Visually hidden label read out with the letters. */
  label: string;
};

export type CarrierStatusSpec = FigureCommon & { kind: "carrier-status"; status: string };

/** An ancestry share without a range is a type error. */
export type AncestryShareSpec = FigureCommon & {
  kind: "ancestry-share";
  share: number;
  range: { low: number; high: number };
};

export type DifferencePpSpec = FigureCommon & {
  kind: "difference-pp";
  after: number;
  before: number;
};

export type RelativeSpec = FigureCommon & { kind: "relative"; text: string; value: number };

export type StandaloneFigureSpec =
  | AbsoluteSpec
  | NaturalFrequencySpec
  | PercentileSpec
  | CoverageSpec
  | IntervalSpec
  | GenotypeSpec
  | CarrierStatusSpec
  | AncestryShareSpec
  | DifferencePpSpec;

export type FigureSpec = StandaloneFigureSpec | RelativeSpec;

export type StandaloneFigureKind = Exclude<FigureKind, "relative">;

/** The probabilities a spec renders as natural frequencies (they share the block denominator). */
export function frequencyValues(spec: FigureSpec): number[] {
  if (spec.kind === "absolute") return [spec.value];
  if (spec.kind === "natural-frequency") {
    return "value" in spec ? [spec.value] : [spec.subject, spec.comparator];
  }
  return [];
}
