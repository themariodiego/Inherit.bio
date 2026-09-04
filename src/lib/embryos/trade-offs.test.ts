import { describe, expect, it } from "vitest";
import { syntheticAbsoluteFinding, syntheticNullFinding } from "./synthetic";
import { CONFLICT_COPY_ID, deriveTradeOffs } from "./trade-offs";

/**
 * The trade-off derivation over the full matrix (brief §4 §6.8; X10.3):
 * names a real conflict, returns none-measurable with an empty array when
 * no conflict exists, excludes ties, and exposes no per-embryo count.
 */
describe("deriveTradeOffs", () => {
  it("names one real conflict: lowest on one row, highest on another", () => {
    const matrix = [
      [syntheticAbsoluteFinding("Embryo 1", "c-a", 0.01), syntheticAbsoluteFinding("Embryo 2", "c-a", 0.02), syntheticAbsoluteFinding("Embryo 3", "c-a", 0.03)],
      [syntheticAbsoluteFinding("Embryo 1", "c-b", 0.09), syntheticAbsoluteFinding("Embryo 2", "c-b", 0.02), syntheticAbsoluteFinding("Embryo 3", "c-b", 0.03)],
    ];
    const result = deriveTradeOffs(matrix);
    expect(result.statement_copy_id).toBe("embryo.tradeoffs.exists");
    expect(result.conflicts).toEqual([
      { embryo_label: "Embryo 1", lowest_condition_id: "c-a", highest_condition_id: "c-b", copy_id: CONFLICT_COPY_ID },
    ]);
    expect(Object.keys(result)).toEqual(["statement_copy_id", "conflicts"]);
  });

  it("returns none-measurable with an empty array when one embryo is lowest on every row", () => {
    const matrix = [
      [syntheticAbsoluteFinding("Embryo 1", "c-a", 0.01), syntheticAbsoluteFinding("Embryo 2", "c-a", 0.02)],
      [syntheticAbsoluteFinding("Embryo 1", "c-b", 0.01), syntheticAbsoluteFinding("Embryo 2", "c-b", 0.02)],
    ];
    expect(deriveTradeOffs(matrix)).toEqual({ statement_copy_id: "embryo.tradeoffs.none-measurable", conflicts: [] });
  });

  it("excludes ties and rows with fewer than two numbers", () => {
    const tied = [
      [syntheticAbsoluteFinding("Embryo 1", "c-a", 0.01), syntheticAbsoluteFinding("Embryo 2", "c-a", 0.01)],
      [syntheticAbsoluteFinding("Embryo 1", "c-b", 0.09), syntheticAbsoluteFinding("Embryo 2", "c-b", 0.02)],
    ];
    expect(deriveTradeOffs(tied).conflicts).toEqual([]);
    const thin = [
      [syntheticAbsoluteFinding("Embryo 1", "c-a", 0.01), syntheticNullFinding("Embryo 2", "c-a", "embryo_call_rate")],
      [syntheticAbsoluteFinding("Embryo 1", "c-b", 0.09), syntheticAbsoluteFinding("Embryo 2", "c-b", 0.02)],
    ];
    expect(deriveTradeOffs(thin)).toEqual({ statement_copy_id: "embryo.tradeoffs.none-measurable", conflicts: [] });
    expect(deriveTradeOffs([])).toEqual({ statement_copy_id: "embryo.tradeoffs.none-measurable", conflicts: [] });
  });

  it("never emits a count, a rank or a best", () => {
    const matrix = [
      [syntheticAbsoluteFinding("Embryo 1", "c-a", 0.01), syntheticAbsoluteFinding("Embryo 2", "c-a", 0.02), syntheticAbsoluteFinding("Embryo 3", "c-a", 0.03)],
      [syntheticAbsoluteFinding("Embryo 1", "c-b", 0.09), syntheticAbsoluteFinding("Embryo 2", "c-b", 0.02), syntheticAbsoluteFinding("Embryo 3", "c-b", 0.03)],
      [syntheticAbsoluteFinding("Embryo 1", "c-c", 0.02), syntheticAbsoluteFinding("Embryo 2", "c-c", 0.09), syntheticAbsoluteFinding("Embryo 3", "c-c", 0.01)],
    ];
    const json = JSON.stringify(deriveTradeOffs(matrix));
    expect(json).not.toMatch(/"(rank|count|best|score|overall|composite|grade|lead_count|wins)"/);
    expect(json).not.toMatch(/\d+ of \d+/);
  });
});
