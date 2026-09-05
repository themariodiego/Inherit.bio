import { ClaimBlock } from "@/components/figures/claim-block";
import { INPUT_PROVENANCE_COPY as COPY, inputLabel } from "@/copy/reports/input-provenance";
import type { InputSourceView } from "@/lib/genome/input-sources";
import type { SubjectAttribution } from "@/lib/figures/contract";

export function InputProvenance({ sources, subject, coverage, state = "recorded", nested = false }: {
  sources: readonly InputSourceView[];
  subject: SubjectAttribution;
  coverage?: { read: number; needed: number; module?: string };
  state?: "recorded" | "noCall" | "conflict" | "absent";
  nested?: boolean;
}) {
  return <div data-slot="input-provenance" className="space-y-3 text-sm leading-relaxed text-ink-muted">
    {nested ? <p className="font-medium text-ink">{COPY.heading}</p> : <h3 className="font-medium text-ink">{COPY.heading}</h3>}
    <p>{COPY.external}</p>
    <p>{COPY.noImputation}</p>
    <p>{sources.length ? COPY[state] : COPY.noFiles}</p>
    {sources.length > 0 && coverage && coverage.needed > 0 ? <ClaimBlock subject={subject} className="border-0 bg-transparent p-0" figures={[{
      kind: "coverage", class: "quality", basis: "observed", provenance: { kind: "computed", module: coverage.module ?? "genome/reports" },
      read: coverage.read, needed: coverage.needed,
    }]} /> : null}
    {sources.map((source, index) => <div key={source.fileId} data-slot="input-source" className="space-y-2">
      {/* inherit-figure-exempt: a local source-record label and processing date are identity, not a result */}
      <p className="font-medium text-ink">{`File ${index + 1} · ${inputLabel(source.fileType)}`}{source.processedAt ? ` · ${new Date(source.processedAt).toISOString().slice(0, 10)}` : ""}</p>
      {source.hasResultRecord === false ? <p>{COPY.checkedAbsent}</p> : null}
      {source.snapshot ? <>
        <p>{source.snapshot.sourceBuild === "GRCh37" ? COPY.converted : COPY.sameBuild}</p>
        <p>{source.snapshot.buildBasis === "source-declared" ? COPY.declared : COPY.assumed}</p>
        {source.snapshot.counts.failedFilter > 0 ? <p>{COPY.failedFilters}</p> : null}
        {source.snapshot.counts.unsupported > 0 ? <p>{COPY.skippedRecords}</p> : null}
        {source.snapshot.counts.blocks > 0 ? <p>{COPY.intervalRecords}</p> : null}
        {source.snapshot.variantRowsUnmapped > 0 ? <p>{COPY.conversionLoss}</p> : null}
        {source.snapshot.counts.singleSample && source.snapshot.counts.called + source.snapshot.counts.noCall > 0 ? <>
          <p>{COPY.callScope}</p>
          <ClaimBlock subject={subject} className="border-0 bg-transparent p-0" figures={[{
            kind: "coverage", class: "quality", basis: "observed", provenance: { kind: "computed", module: "genome/input-provenance" },
            read: source.snapshot.counts.called, needed: source.snapshot.counts.called + source.snapshot.counts.noCall,
          }]} />
        </> : <p>{COPY.unknownRate}</p>}
        <p>{COPY.qualityScope}</p>
      </> : <p>{COPY.unknown}</p>}
    </div>)}
  </div>;
}
