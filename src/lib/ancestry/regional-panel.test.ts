import { describe, expect, it } from "vitest";
import { estimateRegionalAdmixture, REGIONAL_AIMS } from "../genome/regional-admixture";
import { SEVEN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content-v3";
import { isSevenRegionPanel, sevenRegionResult, REGIONAL_REFERENCE } from "./regional-panel";

describe("saved seven-region surface binding", () => {
  const result = estimateRegionalAdmixture(() => null);
  const row = { model_id: SEVEN_ANCESTRY_PANEL.id, model_version: SEVEN_ANCESTRY_PANEL.version, result };
  it("accepts the exact reference and preserves the empty result without making up shares", () => {
    expect(isSevenRegionPanel(row)).toBe(true);
    expect(sevenRegionResult(row)).toEqual(result);
    expect(REGIONAL_REFERENCE.regions.reduce((sum, region) => sum + region.referenceSampleCount, 0))
      .toBe(REGIONAL_REFERENCE.referenceSampleCount);
    expect(REGIONAL_AIMS).toHaveLength(SEVEN_ANCESTRY_PANEL.minimumMarkers);
  });
  it("refuses a changed identity, missing caveat or a fabricated range", () => {
    expect(sevenRegionResult({ ...row, model_id: "aims-kidd-seldin-168" })).toBeNull();
    expect(sevenRegionResult({ ...row, model_version: "unknown" })).toBeNull();
    expect(sevenRegionResult({ ...row, result: { ...result, reporting: { ...result.reporting, caveat: "" } } })).toBeNull();
    expect(sevenRegionResult({ ...row, result: { ...result, ranges: {} } })).toBeNull();
  });
});
