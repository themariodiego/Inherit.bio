import { qcFieldBasis } from "@/lib/embryos/qc-basis";
/** QC figures consume saved producer receipts; absent historical labels stay absent. */
import { displayedFigure, type QcDto } from "@/lib/embryos/policy";
import type { CoverageSpec, IntervalSpec, MeasureSpec, NaturalFrequencySpec } from "@/lib/figures/spec";

/**
 * `src/lib/embryos/policy.ts`, not `qc-policy.ts`: every value below is a
 * laboratory-reported QC field of the `QcDto` that policy.ts shapes and
 * validates, passed through its `displayedFigure` (displayed === stored).
 * qc-policy.ts holds the thresholds, bands and reason ids that decide what
 * a figure *means*; it never produces one of these numbers.
 */
const QC_PROVENANCE = { kind: "computed", module: "embryos/split-analysis" } as const;

export function coverageSpec(qc: Pick<QcDto, "sites_called" | "sites_expected" | "figure_basis">): CoverageSpec | null {
  const receipt = qcFieldBasis(qc, "coverage");
  if (!receipt) return null;
  return {
    kind: "coverage",
    class: "quality",
    basis: receipt.basis,
    provenance: QC_PROVENANCE,
    read: displayedFigure(qc.sites_called),
    needed: displayedFigure(qc.sites_expected),
  };
}

export function rateSpec(qc: QcDto, field: "call_rate" | "autosomal_het_rate" | "parent_a_concordance" | "parent_b_concordance" | "contamination_estimate"): NaturalFrequencySpec | null {
  const receipt = qcFieldBasis(qc, field), value = qc[field];
  if (!receipt || value === null) return null;
  return { kind: "natural-frequency", class: "quality", basis: receipt.basis, provenance: QC_PROVENANCE, value: displayedFigure(value) };
}

export function depthSpec(qc: QcDto): MeasureSpec | null {
  const receipt = qcFieldBasis(qc, "mean_depth");
  if (!receipt || qc.mean_depth === null) return null;
  return { kind: "measure", class: "quality", basis: receipt.basis, provenance: QC_PROVENANCE,
    value: displayedFigure(qc.mean_depth), unit: "reads per position", decimals: 1 };
}

/** No admitted producer reports a dropout estimate; historical numbers stay unclassified. */
export function dropoutSpec(qc: QcDto, embryoId: string): IntervalSpec | null {
  void qc; void embryoId;
  return null;
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
