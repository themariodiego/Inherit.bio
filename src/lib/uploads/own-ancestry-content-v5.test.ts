import { describe, expect, it } from "vitest";
import { computeOwnAncestryContentV4 } from "./own-ancestry-content-v4";
import { computeOwnAncestryContentV5, ownAncestryContentV5Schema } from "./own-ancestry-content-v5";
import { SEVEN_OWN_ANCESTRY_PANEL } from "./own-ancestry-content-v3";
import { NEANDERTHAL_PANEL } from "../genome/neanderthal-panel";
import type { NeanderthalResult } from "../genome/neanderthal";

const SOURCE = {
  fileId: "11111111-1111-4111-8111-111111111111",
  subjectId: "22222222-2222-4222-8222-222222222222",
  normalizedBuild: "GRCh38" as const, callEncoding: "vcf-literal" as const,
  sourceRevision: 1, sourceSha256: "a".repeat(64), normalizedAt: "2026-10-22T00:00:00.000Z",
};

function v4() {
  return computeOwnAncestryContentV4({ source: SOURCE, calls: [], lineageCalls: [], panel: SEVEN_OWN_ANCESTRY_PANEL });
}

const COVERED: NeanderthalResult = {
  panelSites: NEANDERTHAL_PANEL.siteCount, coveredSites: 200, archaicSites: 80,
  estimate: 80 / 200, interval: { low: 0.33, high: 0.46 }, resamples: 200,
};
const EMPTY: NeanderthalResult = {
  panelSites: NEANDERTHAL_PANEL.siteCount, coveredSites: 0, archaicSites: 0,
  estimate: null, interval: null, resamples: 200,
};

describe("own-ancestry-content v5 (Neanderthal estimate)", () => {
  it("wraps revision 4 and captures a covered estimate", () => {
    const content = computeOwnAncestryContentV5(v4(), COVERED);
    expect(content.schemaVersion).toBe(5);
    expect(content.computationRevision).toBe("own-ancestry-content-v5");
    expect(content.neanderthal.panelId).toBe(NEANDERTHAL_PANEL.id);
    expect(content.neanderthal.panelVersion).toBe(NEANDERTHAL_PANEL.version);
    expect(content.neanderthal.markerSha256).toBe(NEANDERTHAL_PANEL.markerSha256);
    expect(content.neanderthal.estimate).toBeCloseTo(0.4, 10);
    // The revision-4 halves are untouched.
    expect(content.admixture).toEqual(v4().admixture);
    expect(content.figureBasis).toEqual(v4().figureBasis);
  });

  it("captures the no-coverage state with null estimate and null interval", () => {
    const content = computeOwnAncestryContentV5(v4(), EMPTY);
    expect(content.neanderthal.coveredSites).toBe(0);
    expect(content.neanderthal.estimate).toBeNull();
    expect(content.neanderthal.interval).toBeNull();
  });

  it("refuses an estimate that is not archaic/covered", () => {
    const content = computeOwnAncestryContentV5(v4(), COVERED);
    const wrong = { ...content, neanderthal: { ...content.neanderthal, estimate: 0.9 } };
    expect(ownAncestryContentV5Schema.safeParse(wrong).success).toBe(false);
  });

  it("refuses more archaic sites than covered", () => {
    const content = computeOwnAncestryContentV5(v4(), COVERED);
    const wrong = { ...content, neanderthal: { ...content.neanderthal, archaicSites: 500 } };
    expect(ownAncestryContentV5Schema.safeParse(wrong).success).toBe(false);
  });

  it("refuses an inverted interval", () => {
    const content = computeOwnAncestryContentV5(v4(), COVERED);
    const wrong = { ...content, neanderthal: { ...content.neanderthal, interval: { low: 0.46, high: 0.33 } } };
    expect(ownAncestryContentV5Schema.safeParse(wrong).success).toBe(false);
  });

  it("refuses an interval that does not bracket the estimate", () => {
    const content = computeOwnAncestryContentV5(v4(), COVERED);
    const wrong = { ...content, neanderthal: { ...content.neanderthal, interval: { low: 0.1, high: 0.2 } } };
    expect(ownAncestryContentV5Schema.safeParse(wrong).success).toBe(false);
  });

  it("refuses a wrong panel hash, a non-modelled basis and an unknown key", () => {
    const content = computeOwnAncestryContentV5(v4(), COVERED);
    expect(ownAncestryContentV5Schema.safeParse({ ...content, neanderthal: { ...content.neanderthal, markerSha256: "b".repeat(64) } }).success).toBe(false);
    expect(ownAncestryContentV5Schema.safeParse({ ...content, neanderthal: { ...content.neanderthal, basis: "observed" } }).success).toBe(false);
    expect(ownAncestryContentV5Schema.safeParse({ ...content, neanderthal: { ...content.neanderthal, extra: 1 } }).success).toBe(false);
    expect(ownAncestryContentV5Schema.safeParse({ ...content, extra: 1 }).success).toBe(false);
  });

  it("refuses a disturbed revision-4 half", () => {
    const content = computeOwnAncestryContentV5(v4(), COVERED);
    const wrong = { ...content, admixture: { ...content.admixture, basis: "observed" } };
    expect(ownAncestryContentV5Schema.safeParse(wrong).success).toBe(false);
  });
});
