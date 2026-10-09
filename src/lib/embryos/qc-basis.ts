import { z } from "zod";
import { resultBasis, resultBasisSchema, type ResultBasis } from "../figures/result-basis";

const observed = resultBasisSchema.extend({ basis: z.literal("observed") });
/** Only the actual called-VCF measurement producer is admitted in revision 1. */
export const qcFigureBasisSchema = z.object({
  version: z.literal(1), producer: z.literal("embryo-split-calls-v1"),
  coverage: observed, call_rate: observed,
  autosomal_het_rate: observed.nullable(), mean_depth: observed.nullable(),
}).strict();
export type QcFigureBasis = z.infer<typeof qcFigureBasisSchema>;

/** Called only where the parser's own counters produce these quantities. */
export function vcfQcFigureBasis(qc: { autosomal_het_rate: number | null; mean_depth: number | null }): QcFigureBasis {
  return { version: 1, producer: "embryo-split-calls-v1", coverage: resultBasis("observed"),
    call_rate: resultBasis("observed"), autosomal_het_rate: qc.autosomal_het_rate === null ? null : resultBasis("observed"),
    mean_depth: qc.mean_depth === null ? null : resultBasis("observed") };
}

/** Readers preserve an absent historical receipt; no basis is inferred from a number. */
export function qcFieldBasis(qc: { figure_basis: QcFigureBasis | null }, field: string): ResultBasis<"observed"> | null {
  if (qc.figure_basis === null) return null;
  const parsed = qcFigureBasisSchema.parse(qc.figure_basis);
  if (field === "coverage" || field === "call_rate" || field === "autosomal_het_rate" || field === "mean_depth") return parsed[field];
  return null;
}
