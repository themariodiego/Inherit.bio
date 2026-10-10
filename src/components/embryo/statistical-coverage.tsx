import type { StatisticalCoverageRead } from "@/lib/embryos/statistical-read";
import { statisticalFittedReadSchema, type StatisticalFittedRead } from "@/lib/embryos/statistical-fit-contract";
import { WITHIN_FAMILY_NOT_TESTED, INSUFFICIENT_COVERAGE_INTRO } from "@/copy/embryos/compare";
import { ClaimBlock } from "@/components/figures/claim-block";
import { CompareCell } from "./compare/compare-cell";

/** Original coverage-only output stays nonnumeric. A distinct complete fitted
 * TEST receipt may show its invented interval, with clinical finding held. */
export function StatisticalCoverage({ value, subjectIds, embryoId }: { value: StatisticalCoverageRead;
  subjectIds: ReadonlyMap<string, string>; embryoId?: string }) {
  if (value.producer === "embryo-test-statistical-fit-v1")
    return <FittedTestCoverage value={value} subjectIds={subjectIds} embryoId={embryoId} />;
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

/** A separate native-current TEST receipt. Its held clinical finding stays
 * absent; only this closed invented-control branch may render a toy interval. */
function FittedTestCoverage({ value, subjectIds, embryoId }: { value: StatisticalFittedRead;
  subjectIds: ReadonlyMap<string, string>; embryoId?: string }) {
  const parsed = statisticalFittedReadSchema.safeParse(value);
  if (!parsed.success) throw new Error("Current fitted TEST receipt required");
  const current = parsed.data;
  const rows = embryoId ? current.rows.filter(row => row.embryoId === embryoId) : current.rows;
  if (rows.length === 0 || rows.some(row => !subjectIds.get(row.embryoId)
    || (row.receipt.source !== null && row.receipt.source.subject_id !== subjectIds.get(row.embryoId))))
    throw new Error("Own embryo attribution required");
  return <section data-slot="test-statistical-coverage" data-cohort-id={current.cohortId}
    data-interpretation="held" data-publication="synthetic-fitted-test-only"
    className="space-y-3 text-sm leading-relaxed text-ink">
    <p className="title">Invented fitted TEST model</p>
    <p>Every reference observation is invented. This tests the maths and what you see on screen. It gives no medical interpretation.</p>
    <ul className="space-y-4">
      {rows.map(row => <li key={row.embryoId} data-embryo-id={row.embryoId} data-coverage-state={row.coverageState}
        data-finding-kind={row.finding?.kind ?? "none"} data-test-result={row.result === null ? "unavailable" : "fitted"}>
        <p>Embryo {row.sampleOrdinal + 1}</p>
        {row.result === null ? <CompareCell subjectId={subjectIds.get(row.embryoId)!} finding={{
          embryo_label: `Embryo ${row.sampleOrdinal + 1}`, condition_id: row.conditionId, condition_name: row.conditionName,
          finding: row.finding, evidence_label: "preliminary", coverage_state: row.coverageState,
          citation_ids: [], not_covered_reason: row.reason }} /> : null}
        {row.matchedVariants === null ? null : <ClaimBlock subject={{ subjectId: subjectIds.get(row.embryoId)! }}
          aria-label="Observed own-file coverage" figures={[{ kind: "coverage", class: "estimate", basis: "observed",
            provenance: { kind: "computed", module: "embryos/statistical-coverage" },
            read: row.matchedVariants, needed: row.requiredVariants! }]}>
          <p data-slot="observed-test-coverage">OBSERVED own-file coverage. Missing positions remain in the full score denominator.</p>
          {row.finding ? <p data-slot="coverage-failure">{INSUFFICIENT_COVERAGE_INTRO}</p> : null}
        </ClaimBlock>}
        {row.result === null ? null : <ClaimBlock subject={{ subjectId: subjectIds.get(row.embryoId)! }}
          aria-label="TEST model: low and high from data we made" figures={[{ kind: "interval", class: "estimate", basis: "modelled",
            provenance: { kind: "computed", module: "embryos/synthetic-statistical-fit" },
            point: Number(row.result.point), low: Number(row.result.interval[0]), high: Number(row.result.interval[1]) }]}>
          <p data-slot="modelled-test-interval">MODELLED invented-control probability and range. This is not a clinical result.</p>
          <p data-slot="within-family" data-within-family="not_measured">{WITHIN_FAMILY_NOT_TESTED}</p>
        </ClaimBlock>}
      </li>)}
    </ul>
  </section>;
}
