import { describe, expect, it } from "vitest";
import { FIGURE_BASES } from "./contract";
import { readResultBasis, resultBasis, resultBasisSchema } from "./result-basis";
import { canonicalCross, crossShares, readMendelBasis, type MendelCross } from "../family/mendel";

describe("saved result classification", () => {
  it.each(FIGURE_BASES)("preserves %s through serialization without renaming it", basis => {
    const saved = JSON.parse(JSON.stringify(resultBasis(basis)));
    expect(saved).toEqual({ version: 1, basis });
    expect(readResultBasis(saved, basis)).toBe(basis);
  });
  it.each([null, {}, { basis: "modelled" }, { version: 2, basis: "modelled" },
    { version: 1, basis: "MODELLED" }, { version: 1, basis: "unknown" },
    { version: 1, basis: "modelled", guessed: true }])("refuses an incomplete or unknown receipt %j", receipt => {
    expect(resultBasisSchema.safeParse(receipt).success).toBe(false);
    expect(() => readResultBasis(receipt, "modelled")).toThrow("invalid_result_basis");
  });
  it("refuses a valid receipt with a different meaning rather than replacing it", () => {
    for (const basis of ["observed", "exact"] as const) {
      expect(() => readResultBasis(resultBasis(basis), "modelled")).toThrow("invalid_result_basis");
    }
  });
  it("carries the actual Mendelian producer's exact basis through its consumer", () => {
    const cross = canonicalCross("recessive_both_one_copy");
    const saved = JSON.parse(JSON.stringify(cross)) as MendelCross;
    expect(readMendelBasis(saved)).toBe("exact");
    expect(crossShares(saved)).toEqual(crossShares(cross));
    expect(saved.outcomes.map(outcome => outcome.fraction)).toEqual([
      { numerator: 1, denominator: 4 }, { numerator: 2, denominator: 4 }, { numerator: 1, denominator: 4 },
    ]);
  });
  it.each([undefined, { version: 1, basis: "observed" }, { version: 1, basis: "modelled" },
    { version: 2, basis: "exact" }])("refuses a saved cross with receipt %j", figureBasis => {
    const cross = { ...canonicalCross("recessive_both_one_copy"), figureBasis } as MendelCross;
    expect(() => crossShares(cross)).toThrow("invalid_result_basis");
  });
});
