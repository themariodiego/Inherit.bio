import type { Citation } from "@/lib/genome/reports";
import { Claim } from "@/components/claims/claim";
import { registeredStudyContext } from "@/lib/claims/presentation";
import { readStudyContext, STUDY_CONTEXT_FIELDS } from "@/lib/genome/study-context";
import { STUDY_CONTEXT_LABELS, STUDY_CONTEXT_SCOPE, STUDY_CONTEXT_UNKNOWN } from "@/copy/reports/study-context";
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

export function CitationItem({ citation, reportClaim }: { citation: Citation;
  reportClaim?: { slug: string; sourceIds: readonly string[] };
}) {
  const href = citation.pmid
    ? `https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`
    : citation.doi ? `https://doi.org/${citation.doi}` : null;
  const identifier = citation.pmid ? ` (PMID ${citation.pmid})` : citation.doi ? ` (doi:${citation.doi})` : "";
  const readDate = validSourceReadDate(citation.accessedOn);
  const context = readStudyContext(citation);
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
      {context ? (
        <div data-slot="study-context" className="space-y-2 pt-2">
          <p className="text-ink-muted">{STUDY_CONTEXT_SCOPE}</p>
          <dl className="space-y-3">
            {STUDY_CONTEXT_FIELDS.map((field) => {
              const fact = context[field];
              const claim = reportClaim && fact ? registeredStudyContext(reportClaim.slug, citation.pmid ?? citation.doi, field, fact.text) : undefined;
              return (
              <div key={field}>
                <dt className="font-medium text-ink">{STUDY_CONTEXT_LABELS[field]}</dt>
                <dd>{claim && reportClaim ? <Claim id={claim.claim_id} citationId={claim.evidence[0].citation}
                  sourceIds={reportClaim.sourceIds} /> : fact?.text ?? STUDY_CONTEXT_UNKNOWN}</dd>
                {context[field] ? <dd className="text-ink-muted text-xs">{context[field].locator}</dd> : null}
              </div>
              );
            })}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
