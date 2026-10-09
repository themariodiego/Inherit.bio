import { z } from "zod";
import { FIGURE_BASES, type FigureBasis } from "./contract";

/** A computation's saved classification. Unknown versions and extra keys fail closed. */
export const RESULT_BASIS_VERSION = 1 as const;
export const resultBasisSchema = z.object({
  version: z.literal(RESULT_BASIS_VERSION),
  basis: z.enum(FIGURE_BASES),
}).strict();
export interface ResultBasis<B extends FigureBasis = FigureBasis> {
  version: typeof RESULT_BASIS_VERSION;
  basis: B;
}

/** Producers call this after deciding what they computed; readers never manufacture a receipt. */
export function resultBasis<B extends FigureBasis>(basis: B): ResultBasis<B> {
  return resultBasisSchema.parse({ version: RESULT_BASIS_VERSION, basis }) as ResultBasis<B>;
}

export function readResultBasis<B extends FigureBasis>(value: unknown, expected: B): B {
  const receipt = resultBasisSchema.safeParse(value);
  if (!receipt.success || receipt.data.basis !== expected) throw new Error("invalid_result_basis");
  return receipt.data.basis as B;
}
