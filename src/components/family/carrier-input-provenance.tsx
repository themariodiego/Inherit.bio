import { InputProvenance } from "@/components/reports/input-provenance";
import { INPUT_PROVENANCE_COPY as COPY } from "@/copy/reports/input-provenance";
import type { CarrierPairSummary } from "@/lib/family/carrier-pair";
import type { InputSourceView } from "@/lib/genome/input-sources";

export function CarrierInputProvenance({ summary, sources, subjects }: {
  summary: CarrierPairSummary;
  sources: { a: InputSourceView[]; b: InputSourceView[] };
  subjects: { a: { id: string; label: string }; b: { id: string; label: string } };
}) {
  const labels = (side: "a" | "b", ids: readonly string[]) => ids.map((id) => `File ${sources[side].findIndex((source) => source.fileId === id) + 1}`).join(", ");
  return <div data-slot="carrier-input-provenance" className="space-y-6">
    {(["a", "b"] as const).map((side) => <div key={side} className="space-y-3">
      <p className="font-medium text-ink">{subjects[side].label}</p>
      <InputProvenance nested sources={sources[side].map((source) => ({ ...source, hasResultRecord: summary.inputFileIds?.[side].includes(source.fileId) ?? false }))}
        subject={{ subjectId: subjects[side].id }} state={summary.inputFileIds?.[side].length ? "recorded" : "absent"} />
      <ul data-slot="carrier-gene-inputs" className="space-y-1 text-sm text-ink-muted">
        {[...(summary.inputFilesByGene ?? [])].map(([gene, inputs]) => <li key={gene}>
          {/* inherit-figure-exempt: local FileN source labels identify each gene's observed inputs */}
          {`${gene} — ${inputs[side].length ? labels(side, inputs[side]) : COPY.noPosition}`}
        </li>)}
      </ul>
      {summary.runsInputFileIds ? <p data-slot="carrier-runs-inputs" className="text-sm text-ink-muted">
        {/* inherit-figure-exempt: an exact per-adult set of source-record labels, not a genetic quantity */}
        {summary.runsInputFileIds[side].length ? `${COPY.runsInputs}: ${labels(side, summary.runsInputFileIds[side])}.` : COPY.noRunsInputs}
      </p> : null}
    </div>)}
    <p className="text-sm text-ink-muted">{COPY.noRelatedness}</p>
  </div>;
}
