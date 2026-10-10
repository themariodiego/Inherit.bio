import type { StatisticalCoverageRead } from "@/lib/embryos/statistical-read";
import { INSUFFICIENT_COVERAGE_INTRO } from "@/copy/embryos/compare";
import { ClaimBlock } from "@/components/figures/claim-block";
import { CompareCell } from "./compare/compare-cell";

/** Native fixed TEST coverage only. No gauge, probability, rank or clinical
 * interpretation. QC holds have no count; coverage never unlocks a model. */
export function StatisticalCoverage({ value, subjectIds, embryoId }: { value: StatisticalCoverageRead;
  subjectIds: ReadonlyMap<string, string>; embryoId?: string }) {
  const rows = embryoId ? value.rows.filter(row => row.embryoId === embryoId) : value.rows;
  if (rows.length === 0 || rows.some(row => !subjectIds.get(row.embryoId))) throw new Error("Own embryo attribution required");
  return <section data-slot="test-statistical-coverage" data-cohort-id={value.cohortId}
    data-interpretation="held" className="space-y-3 text-sm leading-relaxed text-ink">
    <p className="title">Synthetic TEST score coverage</p>
    <p>This invented reference tests file coverage. It gives no medical interpretation.</p>
    <ul className="space-y-3">
      {rows.map(row => <li key={row.embryoId} data-embryo-id={row.embryoId} data-coverage-state={row.coverageState}
        data-finding-kind={row.finding?.kind ?? "none"}>
        <p>Embryo {row.sampleOrdinal + 1}</p>
        <CompareCell subjectId={subjectIds.get(row.embryoId)!} finding={{ embryo_label: `Embryo ${row.sampleOrdinal + 1}`,
          condition_id: row.conditionId, condition_name: row.conditionName, finding: row.finding,
          evidence_label: "preliminary", coverage_state: row.coverageState, citation_ids: [], not_covered_reason: row.reason }} />
        {row.finding ? <ClaimBlock subject={{ subjectId: subjectIds.get(row.embryoId)! }} figures={[{
          kind: "coverage", class: "estimate", basis: "observed", provenance: { kind: "computed", module: "embryos/statistical-coverage" },
          read: row.matchedVariants!, needed: row.requiredVariants!,
        }]}><p data-slot="coverage-failure">{INSUFFICIENT_COVERAGE_INTRO}</p></ClaimBlock> : null}
      </li>)}
    </ul>
  </section>;
}
