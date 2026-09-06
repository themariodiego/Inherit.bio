import { Claim } from "@/components/claims/claim";
import { ClaimSources } from "@/components/claims/sources";
import { registeredReportInterpretation, registeredReportSummary } from "@/lib/claims/presentation";

export function ReportInterpretation({ slug, rsid, genotype, text, sourceIds }: {
  slug: string; rsid: number; genotype: string; text: string; sourceIds: readonly string[];
}) {
  const claim = registeredReportInterpretation(slug, rsid, genotype, text);
  // During catalog rollout, changed hosted text remains visible but is never
  // attributed to the reviewed text. Existing genotype and access checks apply.
  return (
    <p data-slot="report-interpretation" data-claim-region="report-interpretation"
      data-claim-registration={claim ? "registered" : "unregistered"}
      className="mt-3 text-sm leading-relaxed text-ink">
      {claim ? <Claim id={claim.claim_id} citationId={claim.evidence[0].citation}
        sourceIds={sourceIds} /> : text}
    </p>
  );
}

export function ReportSummary({ slug, text, sourceIds }: { slug: string; text: string; sourceIds: readonly string[] }) {
  const claim = registeredReportSummary(slug, text);
  return (
    <p data-slot="report-summary" data-claim-region="report-summary"
      data-claim-registration={claim ? "registered" : "unregistered"}
      className="text-base leading-relaxed text-ink">
      {claim ? <Claim id={claim.claim_id} citationId={claim.evidence[0].citation}
        sourceIds={sourceIds} /> : text}
    </p>
  );
}

export function ReportSummarySources({ sourceIds, existingIds }: { sourceIds: readonly string[]; existingIds: readonly string[] }) {
  const extraIds = sourceIds.filter((id) => !existingIds.includes(id));
  if (!extraIds.length) return null;
  return (
    <section aria-labelledby="report-explanation-sources-heading" className="space-y-2">
      <h3 id="report-explanation-sources-heading" className="font-medium text-ink">Position sources</h3>
      <ClaimSources sourceIds={extraIds} start={sourceIds.indexOf(extraIds[0]) + 1} />
    </section>
  );
}
