/**
 * The figure specs a QC row yields (design §3): the positions read as a
 * `coverage` figure, every rate as a `natural-frequency`, the dropout
 * estimate as an `interval`. Class `quality`, basis `observed` — these are
 * read from the file or reported by the laboratory, never modelled. Pure,
 * so the specs are unit-testable without React; every value passes
 * `displayedFigure` unchanged.
 */
import { displayedFigure, type QcDto } from "@/lib/embryos/policy";
import type { CoverageSpec, IntervalSpec, NaturalFrequencySpec } from "@/lib/figures/spec";

const QC_PROVENANCE = { kind: "computed", module: "embryos/qc" } as const;

export function coverageSpec(qc: Pick<QcDto, "sites_called" | "sites_expected">): CoverageSpec {
  return {
    kind: "coverage",
    class: "quality",
    basis: "observed",
    provenance: QC_PROVENANCE,
    read: displayedFigure(qc.sites_called),
    needed: displayedFigure(qc.sites_expected),
  };
}

export function rateSpec(value: number): NaturalFrequencySpec {
  return {
    kind: "natural-frequency",
    class: "quality",
    basis: "observed",
    provenance: QC_PROVENANCE,
    value: displayedFigure(value),
  };
}

/** The laboratory-reported dropout estimate with its interval; null when the source reported none. */
export function dropoutSpec(
  qc: Pick<QcDto, "allelic_dropout_estimate" | "allelic_dropout_interval_low" | "allelic_dropout_interval_high">,
  embryoId: string,
): IntervalSpec | null {
  if (
    qc.allelic_dropout_estimate === null ||
    qc.allelic_dropout_interval_low === null ||
    qc.allelic_dropout_interval_high === null
  ) {
    return null;
  }
  return {
    kind: "interval",
    class: "quality",
    basis: "observed",
    provenance: { kind: "seed", table: "embryo_qc", id: embryoId },
    point: displayedFigure(qc.allelic_dropout_estimate),
    low: displayedFigure(qc.allelic_dropout_interval_low),
    high: displayedFigure(qc.allelic_dropout_interval_high),
  };
}

/**
 * A rate of exactly zero has no natural frequency on the ladder (every
 * denominator rounds it below 1), and the ladder's floor sentence speaks of
 * a comparison group a quality metric does not have. Zero is therefore a
 * word, not a figure: nothing was found.
 */
export function isZeroRate(value: number | null): value is 0 {
  return value === 0;
}
