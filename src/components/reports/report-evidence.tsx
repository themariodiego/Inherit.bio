import type { Citation } from "@/lib/genome/reports";
import { REPORT_CALL_STATES, validSourceReadDate, type ReportCallSummary } from "@/lib/genome/report-evidence";
import { REPORT_CALL_LABELS, REPORT_CALLS_HEADING, REPORT_CALLS_SCOPE, SOURCE_READ_LABEL, SOURCE_READ_UNKNOWN } from "@/copy/reports/basis";

/** Server-rendered only after the report's subject, permission and reveal gates. */
export function ReportCallCoverage({ summary }: { summary: ReportCallSummary }) {
  return (
    <div data-slot="report-call-coverage" className="space-y-2">
      <h3 className="font-medium text-ink">{REPORT_CALLS_HEADING}</h3>
      {/* inherit-figure-exempt: counts of resolver states, not a clinical or statistical result figure */}
      <dl className="space-y-1">
        {REPORT_CALL_STATES.filter((state) => summary[state] > 0).map((state) => (
          <div key={state} data-call-state={state} className="flex justify-between gap-4">
            <dt>{REPORT_CALL_LABELS[state]}</dt>
            <dd className="tabular-nums">{summary[state]}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink-muted">{REPORT_CALLS_SCOPE}</p>
    </div>
  );
}

export function CitationItem({ citation }: { citation: Citation }) {
  const href = citation.pmid
    ? `https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`
    : citation.doi ? `https://doi.org/${citation.doi}` : null;
  const identifier = citation.pmid ? ` (PMID ${citation.pmid})` : citation.doi ? ` (doi:${citation.doi})` : "";
  const readDate = validSourceReadDate(citation.accessedOn);
  return (
    <div className="space-y-1">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {citation.label}{identifier}
        </a>
      ) : <span>{citation.label}</span>}
      <p className="text-ink-muted">
        {readDate ? <>{SOURCE_READ_LABEL}: <time dateTime={readDate}>{readDate}</time></> : SOURCE_READ_UNKNOWN}
      </p>
    </div>
  );
}
