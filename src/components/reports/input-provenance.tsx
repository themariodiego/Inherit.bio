import { ClaimBlock } from "@/components/figures/claim-block";
import { INPUT_PROVENANCE_COPY as COPY, inputLabel } from "@/copy/reports/input-provenance";
import type { InputSourceView } from "@/lib/genome/input-sources";
import type { ComputedModule, FigureProvenance, SubjectAttribution } from "@/lib/figures/contract";

/**
 * Every provenance the coverage pair can carry, spelled out. A surface says
 * which module counted its pair by name and cannot introduce a third: the
 * whole set of `data-provenance` values this component can emit is readable
 * here, by a person or by a static reader, and each names a real module.
 */
export const COVERAGE_PROVENANCE = {
  "genome/reports": { kind: "computed", module: "genome/reports" },
  "genome/browser": { kind: "computed", module: "genome/browser" },
} as const satisfies Partial<Record<ComputedModule, FigureProvenance>>;

/** The modules that count a coverage pair for this component. */
export type CoverageModule = keyof typeof COVERAGE_PROVENANCE;

export function InputProvenance({ sources, sourceLabels, subject, coverage, state = "recorded", nested = false }: {
  sources: readonly InputSourceView[];
  /** Display identities for only the supplied authorized sources; omitted labels retain local numbering. */
  sourceLabels?: Readonly<Record<string, string>>;
  subject: SubjectAttribution;
  /**
   * The coverage pair and the module that counted it, never free text: a
   * caller cannot put a string of its own into the rendered
   * `data-provenance`. Omitted, the pair is the report's own
   * (`genome/reports`), which is what every report surface passes.
   */
  coverage?: { read: number; needed: number; module?: CoverageModule };
  state?: "recorded" | "noCall" | "conflict" | "absent";
  nested?: boolean;
}) {
  return <div data-slot="input-provenance" className="space-y-3 text-sm leading-relaxed text-ink-muted">
    {nested ? <p className="font-medium text-ink">{COPY.heading}</p> : <h3 className="font-medium text-ink">{COPY.heading}</h3>}
    <p>{COPY.external}</p>
    <p>{COPY.noImputation}</p>
    <p>{sources.length ? COPY[state] : COPY.noFiles}</p>
    {sources.length > 0 && coverage && coverage.needed > 0 ? <ClaimBlock subject={subject} className="border-0 bg-transparent p-0" figures={[{
      kind: "coverage", class: "quality", basis: "observed", provenance: COVERAGE_PROVENANCE[coverage.module ?? "genome/reports"],
      read: coverage.read, needed: coverage.needed,
    }]} /> : null}
    {sources.map((source, index) => <div key={source.fileId} data-slot="input-source" className="space-y-2">
      {/* inherit-figure-exempt: a local source-record label and processing date are identity, not a result */}
      <p className="font-medium text-ink">{`${sourceLabels?.[source.fileId] || `File ${index + 1}`} · ${inputLabel(source.fileType)}`}{source.processedAt ? ` · ${new Date(source.processedAt).toISOString().slice(0, 10)}` : ""}</p>
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
            wording: "listed-calls",
          }]} />
        </> : <p>{COPY.unknownRate}</p>}
        <p>{COPY.qualityScope}</p>
      </> : <p>{COPY.unknown}</p>}
    </div>)}
  </div>;
}
