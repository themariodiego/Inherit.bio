import { describe, expect, it } from "vitest";
import { STANDING_STATEMENT } from "@/copy/embryos/compare";
import { EmbryoShapeError } from "./policy";
import { projectComparison, projectDetail, projectQc, type EmbryoRow, type EmbryoScoreRow } from "./projection";
import { syntheticAbsoluteFinding, syntheticNullFinding, syntheticQcRow } from "./synthetic";

/**
 * The closed DTOs (design §5): columns in ordinal order, only embryos with a
 * QC row, only registered conditions, only complete rows, the counts from
 * contextStrip, the trade-offs from the full matrix, and a refusal — never a
 * partial render — for anything outside the shape.
 */

const embryos: EmbryoRow[] = [
  { id: "e3", cohort_id: "c1", sample_ordinal: 2, display_label: "Embryo 3", status: "qc_pass" },
  { id: "e1", cohort_id: "c1", sample_ordinal: 0, display_label: "Embryo 1", status: "qc_fail" },
  { id: "e2", cohort_id: "c1", sample_ordinal: 1, display_label: "Embryo 2", status: "qc_pass" },
  { id: "e4", cohort_id: "c1", sample_ordinal: 3, display_label: "Embryo 4", status: "pending" },
];

const qcRows = [
  syntheticQcRow("e1", { call_rate: 0.6, sites_called: 600, qc_verdict: "fail", qc_reasons: ["embryo_call_rate"] }),
  syntheticQcRow("e2", { call_rate: 0.99 }),
  syntheticQcRow("e3", { call_rate: 0.97 }),
];

function score(embryoId: string, finding: ReturnType<typeof syntheticAbsoluteFinding>): EmbryoScoreRow {
  return {
    embryo_id: embryoId,
    condition_id: finding.condition_id,
    condition_name: finding.condition_name,
    finding: finding.finding,
    evidence_label: finding.evidence_label,
    coverage_state: finding.coverage_state,
    citation_ids: finding.citation_ids,
    not_covered_reason: finding.not_covered_reason,
  };
}

describe("projection", () => {
  it("projects exactly the twenty QC fields and drops the key", () => {
    const qc = projectQc(syntheticQcRow("e1"));
    expect(Object.keys(qc)).toHaveLength(20);
    expect(qc).not.toHaveProperty("embryo_id");
    expect(qc.call_rate).toBe(0.99);
  });

  it("builds the comparison in ordinal order from embryos with a QC row only, with the registered rows", () => {
    const scores = [
      score("e1", syntheticNullFinding("Embryo 1", "c-a", "embryo_call_rate")),
      score("e2", syntheticAbsoluteFinding("Embryo 2", "c-a", 0.02)),
      score("e3", syntheticAbsoluteFinding("Embryo 3", "c-a", 0.01)),
      score("e1", syntheticNullFinding("Embryo 1", "c-b", "embryo_call_rate")),
      score("e2", syntheticAbsoluteFinding("Embryo 2", "c-b", 0.01)),
      score("e3", syntheticAbsoluteFinding("Embryo 3", "c-b", 0.02)),
      // An unregistered condition is never read.
      score("e2", syntheticAbsoluteFinding("Embryo 2", "c-z", 0.5)),
      // An incomplete row never shows one embryo before the set.
      score("e2", syntheticAbsoluteFinding("Embryo 2", "c-c", 0.5)),
    ];
    const comparison = projectComparison({ cohortId: "c1", embryos, qcRows, scores, registeredConditionIds: new Set(["c-a", "c-b", "c-c"]) });
    expect(comparison.embryos.map((embryo) => embryo.display_label)).toEqual(["Embryo 1", "Embryo 2", "Embryo 3"]);
    expect(comparison.result_rows.map((row) => row.findings[0].condition_id)).toEqual(["c-a", "c-b"]);
    expect(comparison.result_rows[0].findings.map((finding) => finding.embryo_label)).toEqual(["Embryo 1", "Embryo 2", "Embryo 3"]);
    expect(comparison.context_counts).toEqual({ embryos_analysed: 3, quality_check_passed: 2, not_measurable: 1 });
    expect(comparison.trade_offs.statement_copy_id).toBe("embryo.tradeoffs.exists");
    expect(comparison.trade_offs.conflicts.map((conflict) => conflict.embryo_label).sort()).toEqual(["Embryo 2", "Embryo 3"]);
    expect(comparison.standing_statement).toBe(STANDING_STATEMENT);
    expect(JSON.stringify(comparison)).not.toContain("c-z");
  });

  it("renders the empty registry as zero rows and the none-measurable statement", () => {
    const comparison = projectComparison({ cohortId: "c1", embryos, qcRows, scores: [], registeredConditionIds: new Set() });
    expect(comparison.result_rows).toEqual([]);
    expect(comparison.trade_offs).toEqual({ statement_copy_id: "embryo.tradeoffs.none-measurable", conflicts: [] });
    expect(comparison.embryos).toHaveLength(3);
  });

  it("refuses a forbidden key inside a stored finding rather than rendering around it", () => {
    const poisoned = score("e2", syntheticAbsoluteFinding("Embryo 2", "c-a", 0.02));
    poisoned.finding = { ...(poisoned.finding as object), sex: "XY" } as never;
    expect(() =>
      projectComparison({ cohortId: "c1", embryos, qcRows, scores: [poisoned], registeredConditionIds: new Set(["c-a"]) }),
    ).toThrow(EmbryoShapeError);
  });

  it("projects one embryo's detail with its findings in registry order", () => {
    const detail = projectDetail({
      embryo: embryos[2],
      qc: qcRows[1],
      scores: [score("e2", syntheticAbsoluteFinding("Embryo 2", "c-b", 0.01)), score("e2", syntheticAbsoluteFinding("Embryo 2", "c-a", 0.02))],
      registeredConditionIds: new Set(["c-a", "c-b"]),
    });
    expect(detail.display_label).toBe("Embryo 2");
    expect(detail.findings.map((finding) => finding.condition_id)).toEqual(["c-a", "c-b"]);
    expect(Object.keys(detail)).toEqual(["id", "cohort_id", "sample_ordinal", "display_label", "status", "qc", "findings"]);
  });
});
