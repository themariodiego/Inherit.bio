import { describe, expect, it } from "vitest";
import { reportedRows } from "./adaptive-reporting";
import { REGION_CODES } from "./seven-region-reference";

describe("accepted adaptive rule compared with the earlier measurement", () => {
  const q = (eur: number, mid: number, csa: number) => REGION_CODES.map((r) => r === "EUR" ? eur : r === "MID" ? mid : r === "CSA" ? csa : r === "AFR" ? 1 - eur - mid - csa : 0);
  it("keeps seven rows at exactly 0.10, where the old rule merged", () => {
    expect(reportedRows(q(0.8, 0.1, 0.05), "accepted-all-three")).toHaveLength(7);
    expect(reportedRows(q(0.8, 0.1, 0.05), "earlier-hot-only")).toHaveLength(6);
  });
  it("merges all three even when the third share is below the threshold", () => {
    const accepted = reportedRows(q(0.7, 0.15, 0.05), "accepted-all-three");
    const earlier = reportedRows(q(0.7, 0.15, 0.05), "earlier-hot-only");
    expect(accepted).toHaveLength(5);
    expect(accepted[0].members.map((k) => REGION_CODES[k])).toEqual(["EUR", "MID", "CSA"]);
    expect(accepted[0].share).toBeCloseTo(0.9);
    expect(earlier).toHaveLength(6);
    expect(earlier[0].share).toBeCloseTo(0.85);
    expect(accepted.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1);
  });
  it("triggers before display rounding", () => {
    expect(reportedRows(q(0.7, 0.10000001, 0.05), "accepted-all-three")).toHaveLength(5);
    expect(reportedRows(q(0.7, 0.09999999, 0.05), "accepted-all-three")).toHaveLength(7);
  });
});
