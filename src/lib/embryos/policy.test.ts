import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_RANKING_FIELDS,
  FORBIDDEN_SHAPE_FIELDS,
  SHAPES,
  assertEmbryoDto,
  columnOrder,
  displayedFigure,
  resultRowOrder,
  validateEmbryoDto,
  type RscEmbryoComparison,
} from "./policy";
import { syntheticAbsoluteFinding, syntheticCarrierFinding, syntheticCoverageFailure, syntheticNullFinding, syntheticQc } from "./synthetic";

/**
 * The closed-shape validator and the two permitted orders (design §6.1;
 * register embryo-autosomal-only-v1). Every forbidden field is rejected
 * wherever it sits; columns follow the ordinal and rows the registry id
 * for a fixture whose values order differently; displayed === stored.
 */

function comparison(): RscEmbryoComparison {
  const embryos = [
    { id: "e1", sample_ordinal: 0, display_label: "Embryo 1", status: "qc_pass" as const, qc: syntheticQc({ call_rate: 0.97 }) },
    { id: "e2", sample_ordinal: 1, display_label: "Embryo 2", status: "qc_fail" as const, qc: syntheticQc({ call_rate: 0.6, sites_called: 600, qc_verdict: "fail", qc_reasons: ["embryo_call_rate"] }) },
    { id: "e3", sample_ordinal: 2, display_label: "Embryo 3", status: "qc_pass" as const, qc: syntheticQc({ call_rate: 0.99 }) },
  ];
  return {
    cohort_id: "c1",
    context_counts: { embryos_analysed: 3, quality_check_passed: 2, not_measurable: 1 },
    embryos,
    result_rows: [
      { findings: [syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02), syntheticNullFinding("Embryo 2", "c-a", "embryo_call_rate"), syntheticAbsoluteFinding("Embryo 3", "c-a", 0.01)] },
      { findings: [syntheticAbsoluteFinding("Embryo 1", "c-b", 0.03), syntheticNullFinding("Embryo 2", "c-b", "embryo_call_rate"), syntheticAbsoluteFinding("Embryo 3", "c-b", 0.04)] },
    ],
    trade_offs: {
      statement_copy_id: "embryo.tradeoffs.exists",
      conflicts: [{ embryo_label: "Embryo 3", lowest_condition_id: "c-a", highest_condition_id: "c-b", copy_id: "embryo.tradeoffs.conflict" }],
    },
    standing_statement: "statement",
  };
}

describe("closed shapes", () => {
  it("accepts every synthetic shape as written", () => {
    expect(validateEmbryoDto("rscEmbryoComparison", comparison())).toEqual({ ok: true });
    expect(validateEmbryoDto("EmbryoFinding", syntheticCarrierFinding("Embryo 1", "c-x", "carrier"))).toEqual({ ok: true });
    expect(validateEmbryoDto("EmbryoFinding", syntheticCoverageFailure("Embryo 1", "c-x"))).toEqual({ ok: true });
    expect(validateEmbryoDto("EmbryoFinding", syntheticNullFinding("Embryo 1", "c-x", "within_family_validation_unavailable", "not_covered"))).toEqual({ ok: true });
    expect(validateEmbryoDto("rscEmbryoDetail", { id: "e1", cohort_id: "c1", sample_ordinal: 0, display_label: "Embryo 1", status: "qc_pass", qc: syntheticQc(), findings: [] })).toEqual({ ok: true });
    expect(validateEmbryoDto("rscEmbryoListItem", { id: "e1", cohort_id: "c1", sample_ordinal: 4, display_label: "Embryo 5", status: "pending" })).toEqual({ ok: true });
  });

  it("mirrors the register's key lists exactly", () => {
    expect([...SHAPES.EmbryoFinding.keys].sort()).toEqual([
      "citation_ids", "condition_id", "condition_name", "coverage_state", "embryo_label", "evidence_label", "finding", "not_covered_reason",
    ]);
    expect(SHAPES.qc.keys).toHaveLength(21);
    expect(SHAPES.inputFacts.keys).toEqual(["coordinate_conversion", "source_origin", "source_imputation", "call_observation"]);
    expect(SHAPES.rscEmbryoComparison.keys).toEqual(["cohort_id", "context_counts", "embryos", "result_rows", "trade_offs", "standing_statement"]);
    expect(SHAPES.tradeOffs.keys).toEqual(["statement_copy_id", "conflicts"]);
  });

  it("rejects any extra key, at the top and inside a finding", () => {
    const top = { ...comparison(), sort_key: 1 };
    expect(validateEmbryoDto("rscEmbryoComparison", top)).toMatchObject({ ok: false, path: "sort_key" });
    const finding = syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02);
    const nested = { ...finding, finding: { ...finding.finding, extra: true } };
    expect(validateEmbryoDto("EmbryoFinding", nested)).toMatchObject({ ok: false, reason: "unknown field" });
    expect(() => assertEmbryoDto("rscEmbryoComparison", top)).toThrow(/embryo-closed-schema-v1/);
  });

  it("rejects each forbiddenShapeFields entry and each ranking field wherever it hides", () => {
    for (const field of [...FORBIDDEN_SHAPE_FIELDS, ...FORBIDDEN_RANKING_FIELDS]) {
      const top = { ...comparison(), [field]: "x" };
      expect(validateEmbryoDto("rscEmbryoComparison", top), field).toMatchObject({ ok: false, reason: `forbidden field "${field}"` });
      const finding = syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02);
      const nested = { ...finding, finding: { ...finding.finding, [field]: "x" } };
      expect(validateEmbryoDto("EmbryoFinding", nested), field).toMatchObject({ ok: false, reason: `forbidden field "${field}"` });
      const deep = { ...comparison() };
      deep.embryos = [{ ...deep.embryos[0], qc: { ...deep.embryos[0].qc, [field]: 1 } as never }, ...deep.embryos.slice(1)];
      expect(validateEmbryoDto("rscEmbryoComparison", deep), field).toMatchObject({ ok: false });
    }
  });

  it("enforces the finding's cross-field rule", () => {
    const reportableWithReason = { ...syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02), not_covered_reason: "embryo_call_rate" };
    expect(validateEmbryoDto("EmbryoFinding", reportableWithReason).ok).toBe(false);
    const nullWithoutReason = { ...syntheticNullFinding("Embryo 1", "c-a", "embryo_call_rate"), not_covered_reason: null };
    expect(validateEmbryoDto("EmbryoFinding", nullWithoutReason).ok).toBe(false);
    const nullInsufficient = syntheticNullFinding("Embryo 1", "c-a", "insufficient_coverage", "not_covered");
    expect(validateEmbryoDto("EmbryoFinding", nullInsufficient).ok).toBe(false);
    const belowFloor = syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02);
    (belowFloor.finding as { score_coverage: number }).score_coverage = 0.7;
    expect(validateEmbryoDto("EmbryoFinding", belowFloor).ok).toBe(false);
    const wrongLabel = { ...syntheticAbsoluteFinding("Embryo 1", "c-a", 0.02) };
    expect(validateEmbryoDto("rscEmbryoListItem", { id: "e1", cohort_id: "c1", sample_ordinal: 0, display_label: "Sample A", status: "qc_pass" }).ok).toBe(false);
    expect(wrongLabel.embryo_label).toBe("Embryo 1");
  });

  it("rejects a reason outside the closed tables and a reason paired with the wrong state (R1)", () => {
    const freeQcReason = syntheticQc({ qc_verdict: "fail", qc_reasons: ["embryo_call_rate", "unknown_reason"] });
    expect(validateEmbryoDto("qc", freeQcReason).ok).toBe(false);
    expect(validateEmbryoDto("qc", syntheticQc({ qc_verdict: "fail", qc_reasons: ["embryo_call_rate"] })).ok).toBe(true);
    const freeResultReason = syntheticNullFinding("Embryo 1", "c-a", "some_new_reason");
    expect(validateEmbryoDto("EmbryoFinding", freeResultReason).ok).toBe(false);
    // A quality reason names a quality_not_measurable state; a result-level reason a not_covered one.
    expect(validateEmbryoDto("EmbryoFinding", syntheticNullFinding("Embryo 1", "c-a", "embryo_call_rate", "not_covered")).ok).toBe(false);
    expect(validateEmbryoDto("EmbryoFinding", syntheticNullFinding("Embryo 1", "c-a", "embryo_call_rate", "quality_not_measurable")).ok).toBe(true);
    expect(validateEmbryoDto("EmbryoFinding", syntheticNullFinding("Embryo 1", "c-a", "within_family_validation_unavailable", "quality_not_measurable")).ok).toBe(false);
    expect(validateEmbryoDto("EmbryoFinding", syntheticNullFinding("Embryo 1", "c-a", "within_family_validation_unavailable", "not_covered")).ok).toBe(true);
  });

  it("rejects a source string that is not a registered bounded label (R2)", () => {
    expect(validateEmbryoDto("qc", syntheticQc({ source_laboratory: "Acme Fertility Lab" })).ok).toBe(false);
    expect(validateEmbryoDto("qc", syntheticQc({ source_assay: "SNP array v3" })).ok).toBe(false);
    expect(validateEmbryoDto("qc", syntheticQc({ amplification_method: "MDA" })).ok).toBe(false);
    expect(validateEmbryoDto("qc", syntheticQc({ allelic_dropout_method: "sibling concordance" })).ok).toBe(false);
    expect(validateEmbryoDto("qc", syntheticQc({ source_laboratory: null, source_assay: null })).ok).toBe(true);
  });

  it("enforces column, row and trade-off cardinality", () => {
    const unordered = comparison();
    unordered.embryos = [unordered.embryos[1], unordered.embryos[0], unordered.embryos[2]];
    expect(validateEmbryoDto("rscEmbryoComparison", unordered)).toMatchObject({ ok: false, reason: "must ascend by sample_ordinal" });
    const shortRow = comparison();
    shortRow.result_rows[0].findings = shortRow.result_rows[0].findings.slice(0, 2);
    expect(validateEmbryoDto("rscEmbryoComparison", shortRow)).toMatchObject({ ok: false, reason: "must hold exactly one finding per embryo" });
    const rowsOutOfOrder = comparison();
    rowsOutOfOrder.result_rows.reverse();
    expect(validateEmbryoDto("rscEmbryoComparison", rowsOutOfOrder)).toMatchObject({ ok: false, reason: "must ascend by registry condition_id" });
    const existsWithoutConflict = comparison();
    existsWithoutConflict.trade_offs = { statement_copy_id: "embryo.tradeoffs.exists", conflicts: [] };
    expect(validateEmbryoDto("rscEmbryoComparison", existsWithoutConflict).ok).toBe(false);
    const noneWithConflict = comparison();
    noneWithConflict.trade_offs = { ...noneWithConflict.trade_offs, statement_copy_id: "embryo.tradeoffs.none-measurable" };
    expect(validateEmbryoDto("rscEmbryoComparison", noneWithConflict).ok).toBe(false);
  });

  it("orders columns by ordinal and rows by condition id for a fixture whose values order differently", () => {
    const embryos = [
      { id: "b", sample_ordinal: 1, risk: 0.01 },
      { id: "c", sample_ordinal: 2, risk: 0.5 },
      { id: "a", sample_ordinal: 0, risk: 0.2 },
    ];
    expect(columnOrder(embryos).map((embryo) => embryo.id)).toEqual(["a", "b", "c"]);
    const rows = [{ condition_id: "zeta", spread: 0.9 }, { condition_id: "alpha", spread: 0.1 }, { condition_id: "mid", spread: 0.5 }];
    expect(resultRowOrder(rows).map((row) => row.condition_id)).toEqual(["alpha", "mid", "zeta"]);
    expect(embryos.map((embryo) => embryo.id)).toEqual(["b", "c", "a"]);
  });

  it("displays exactly what is stored, and its output names no rank, best or 0%", () => {
    for (const stored of [0, 0.004, 0.05, 0.5, 1]) expect(displayedFigure(stored)).toBe(stored);
    const json = JSON.stringify(comparison());
    expect(json).not.toContain("0%");
    expect(json).not.toMatch(/\b(best|rank|ranked|winner)\b/);
  });
});
