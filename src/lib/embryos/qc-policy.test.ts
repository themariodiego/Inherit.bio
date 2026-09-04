import { describe, expect, it } from "vitest";
import {
  QC_THRESHOLDS,
  callRateProducesFigure,
  contextStrip,
  dropoutPermitsPolygenic,
  mapQcReason,
  polygenicConfidence,
  producesFigure,
  qcBand,
  qcReasons,
  scoreCoverageProducesFigure,
  widenForDropout,
  type QcMetrics,
} from "./qc-policy";

/**
 * X10.4 (brief line 2229): each gate fires at its exact threshold and one
 * unit either side; null dropout widens every interval by exactly 1.5 and
 * sets the copy id; null contamination or dropout caps confidence and does
 * not gate; the strip counts marginal-no-figure under not_measurable; an
 * unknown reason maps to qc_review_required.
 */

function qc(overrides: Partial<QcMetrics> = {}): QcMetrics {
  return {
    call_rate: 0.99,
    parent_a_concordance: null,
    parent_b_concordance: null,
    allelic_dropout_estimate: null,
    contamination_estimate: null,
    ...overrides,
  };
}

describe("qc policy thresholds", () => {
  it("publishes exactly the X10.4 numbers", () => {
    expect(QC_THRESHOLDS).toEqual({
      callRateNoFigure: 0.95,
      callRateFail: 0.85,
      concordanceMarginal: 0.95,
      concordanceFail: 0.9,
      scoreCoverageFloor: 0.8,
      dropoutCeiling: 0.1,
      dropoutUnmeasuredWidening: 1.5,
      contaminationCeiling: 0.05,
    });
  });

  it("call rate: no figure below 0.95, marginal from 0.85, fail below 0.85", () => {
    expect(callRateProducesFigure(0.95)).toBe(true);
    expect(callRateProducesFigure(0.9501)).toBe(true);
    expect(callRateProducesFigure(0.9499)).toBe(false);
    expect(qcBand(qc({ call_rate: 0.95 }))).toBe("pass");
    expect(qcBand(qc({ call_rate: 0.9499 }))).toBe("marginal");
    expect(qcBand(qc({ call_rate: 0.85 }))).toBe("marginal");
    expect(qcBand(qc({ call_rate: 0.8501 }))).toBe("marginal");
    expect(qcBand(qc({ call_rate: 0.8499 }))).toBe("fail");
    expect(qcReasons(qc({ call_rate: 0.9499 }))).toEqual(["embryo_call_rate"]);
    expect(qcReasons(qc({ call_rate: 0.95 }))).toEqual([]);
  });

  it("parent concordance: marginal below 0.95, fail below 0.90, for either parent", () => {
    expect(qcBand(qc({ parent_a_concordance: 0.95 }))).toBe("pass");
    expect(qcBand(qc({ parent_a_concordance: 0.9499 }))).toBe("marginal");
    expect(qcBand(qc({ parent_b_concordance: 0.9 }))).toBe("marginal");
    expect(qcBand(qc({ parent_b_concordance: 0.9001 }))).toBe("marginal");
    expect(qcBand(qc({ parent_b_concordance: 0.8999 }))).toBe("fail");
    expect(qcReasons(qc({ parent_a_concordance: 0.9499 }))).toEqual(["embryo_parent_discordant"]);
  });

  it("score coverage: no figure below 0.80", () => {
    expect(scoreCoverageProducesFigure(0.8)).toBe(true);
    expect(scoreCoverageProducesFigure(0.8001)).toBe(true);
    expect(scoreCoverageProducesFigure(0.7999)).toBe(false);
  });

  it("dropout: not reportable above 0.10; null does not gate", () => {
    expect(dropoutPermitsPolygenic(0.1)).toBe(true);
    expect(dropoutPermitsPolygenic(0.1001)).toBe(false);
    expect(dropoutPermitsPolygenic(0.0999)).toBe(true);
    expect(dropoutPermitsPolygenic(null)).toBe(true);
    expect(qcReasons(qc({ allelic_dropout_estimate: 0.1001 }))).toEqual(["dropout_too_high"]);
    expect(qcBand(qc({ allelic_dropout_estimate: 0.5 }))).toBe("pass");
    expect(polygenicConfidence(qc({ allelic_dropout_estimate: 0.1001 }))).toBe("not_reportable");
  });

  it("contamination: no results above 0.05; null does not gate", () => {
    expect(qcBand(qc({ contamination_estimate: 0.05 }))).toBe("pass");
    expect(qcBand(qc({ contamination_estimate: 0.0501 }))).toBe("fail");
    expect(qcBand(qc({ contamination_estimate: 0.0499 }))).toBe("pass");
    expect(qcReasons(qc({ contamination_estimate: 0.0501 }))).toEqual(["contamination"]);
    expect(qcBand(qc({ contamination_estimate: null }))).toBe("pass");
  });

  it("widens every interval by exactly 1.5 about its point when dropout is null, and says so", () => {
    const widened = widenForDropout({ low: 0.02, point: 0.04, high: 0.07 }, null);
    expect(widened.point).toBe(0.04);
    expect(widened.low).toBeCloseTo(0.01, 10);
    expect(widened.high).toBeCloseTo(0.085, 10);
    expect(widened.widened).toBe(true);
    expect(widened.copyId).toBe("embryo.qc.dropout-not-measured");
    const measured = widenForDropout({ low: 0.02, point: 0.04, high: 0.07 }, 0.03);
    expect(measured).toMatchObject({ low: 0.02, point: 0.04, high: 0.07, widened: false, copyId: null });
  });

  it("caps confidence at low when contamination or dropout is unmeasured, without gating", () => {
    expect(polygenicConfidence(qc({ allelic_dropout_estimate: 0.02, contamination_estimate: 0.01 }))).toBe("standard");
    expect(polygenicConfidence(qc({ allelic_dropout_estimate: null, contamination_estimate: 0.01 }))).toBe("low_confidence");
    expect(polygenicConfidence(qc({ allelic_dropout_estimate: 0.02, contamination_estimate: null }))).toBe("low_confidence");
    expect(polygenicConfidence(qc({ call_rate: 0.9, allelic_dropout_estimate: 0.02, contamination_estimate: 0.01 }))).toBe("low_confidence");
    expect(polygenicConfidence(qc({ call_rate: 0.6 }))).toBe("not_reportable");
    expect(producesFigure(qc({ contamination_estimate: null }))).toBe(true);
  });

  it("counts the strip's three numbers and nothing else, marginal-no-figure under not_measurable", () => {
    const counts = contextStrip([
      { ...qc({ call_rate: 0.99 }), qc_verdict: "pass" },
      { ...qc({ call_rate: 0.9 }), qc_verdict: "marginal" },
      { ...qc({ call_rate: 0.99, parent_a_concordance: 0.92 }), qc_verdict: "marginal" },
      { ...qc({ call_rate: 0.6 }), qc_verdict: "fail" },
      { ...qc({ call_rate: 0.99 }), qc_verdict: "pending" },
    ]);
    expect(counts).toEqual({ embryos_analysed: 4, quality_check_passed: 1, not_measurable: 2 });
    expect(Object.keys(counts)).toEqual(["embryos_analysed", "quality_check_passed", "not_measurable"]);
  });

  it("maps an unknown reason to qc_review_required, fail closed", () => {
    expect(mapQcReason("embryo_call_rate")).toBe("embryo_call_rate");
    expect(mapQcReason("something_new")).toBe("qc_review_required");
    expect(mapQcReason("")).toBe("qc_review_required");
  });
});
