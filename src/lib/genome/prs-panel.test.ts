import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { ALL_PRS_SCORES } from "./prs-data";
import { scorePanel } from "./prs-panel";

type PrsScoresRow = Database["public"]["Tables"]["prs_scores"]["Row"];
/**
 * A tripwire, not decoration: the polygenic surface tells the reader that no
 * version is recorded for a score's panel (G4.4). If `prs_scores` ever gains a
 * version column this alias becomes `true`, the assignment below stops
 * type-checking, and whoever added the column has to make the surface render
 * the real version instead of leaving a now-false sentence on the page.
 */
type HasVersionColumn = "version" extends keyof PrsScoresRow ? true : false;

describe("scorePanel", () => {
  it("reports no version for a stored row, because no record carries one", () => {
    const hasVersionColumn: HasVersionColumn = false;
    expect(hasVersionColumn).toBe(false);
    expect(scorePanel({ pgs_id: "PGS000011", name: "GRS50" })).toEqual({
      id: "PGS000011",
      name: "GRS50",
      version: null,
    });
  });

  it("passes a version through when a record ever carries one, rather than hard-coding its absence", () => {
    expect(scorePanel({ pgs_id: "PGS000115", name: "LDL-C_20", version: "Build 17" }).version).toBe("Build 17");
    expect(scorePanel({ pgs_id: "PGS000115", name: "LDL-C_20", version: null }).version).toBeNull();
  });

  it("finds no version on any shipped score, so the rendered absence is the truth about the data", () => {
    expect(ALL_PRS_SCORES.length).toBeGreaterThan(0);
    for (const score of ALL_PRS_SCORES) {
      expect(Object.keys(score), score.pgs_id).not.toContain("version");
      expect(scorePanel(score).version, score.pgs_id).toBeNull();
    }
  });
});
