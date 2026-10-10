import { z } from "zod";
import { resultBasis, resultBasisSchema } from "../figures/result-basis";
import { computeOwnAncestryContentV3, ownAncestryContentV3Schema } from "./own-ancestry-content-v3";

/** Same estimator and reference as revision 3; this revision captures figure classification. */
export const ownAncestryContentV4Schema = z.object({
  ...ownAncestryContentV3Schema.shape,
  schemaVersion: z.literal(4),
  computationRevision: z.literal("own-ancestry-content-v4"),
  figureBasis: z.object({ shares: resultBasisSchema, coverage: resultBasisSchema }).strict(),
}).strict().superRefine((content, ctx) => {
  const { figureBasis, ...historical } = content;
  const unchanged = ownAncestryContentV3Schema.safeParse({ ...historical,
    schemaVersion: 3, computationRevision: "own-ancestry-content-v3" });
  if (!unchanged.success || figureBasis.shares.basis !== content.admixture.basis
    || figureBasis.coverage.basis !== "observed") {
    ctx.addIssue({ code: "custom", message: "Inconsistent ancestry basis or content" });
  }
});
export type OwnAncestryContentV4 = z.infer<typeof ownAncestryContentV4Schema>;

export function computeOwnAncestryContentV4(input: Parameters<typeof computeOwnAncestryContentV3>[0]): OwnAncestryContentV4 {
  const computed = computeOwnAncestryContentV3(input);
  return ownAncestryContentV4Schema.parse({ ...computed, schemaVersion: 4,
    computationRevision: "own-ancestry-content-v4",
    figureBasis: { shares: resultBasis(computed.admixture.basis), coverage: resultBasis("observed") } });
}
