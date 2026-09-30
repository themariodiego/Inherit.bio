/**
 * <AssertionNotes> — what every reviewed carrier finding carries under its
 * variant lines (brief §4, lines 1329-1335; docs/carrier-importer-design.md).
 * Server component.
 *
 * Rendered only for readings that came from a reviewed assertion: the
 * laboratory-confirmation line on a pathogenic or likely pathogenic finding,
 * the penetrance label where no range has been cited, and the attribution
 * ClinVar and ClinGen ask for. The review status and date sit in each
 * variant line itself, next to the finding.
 */
import {
  LAB_CONFIRMATION_LINE,
  PENETRANCE_NOT_ESTABLISHED,
  assertionSourceLine,
} from "@/copy/family/carrier-evidence";
import type { CarrierEvidence } from "@/lib/family/carrier-pair";

export function AssertionNotes({ evidence }: { evidence: readonly (CarrierEvidence | undefined)[] }) {
  const reviewed = evidence.filter((item): item is CarrierEvidence => item !== undefined);
  if (reviewed.length === 0) return null;
  const releases = [...new Map(reviewed.map((item) => [`${item.releaseId}:${item.geneValidityReadOn}`, item])).values()];
  return (
    <div data-slot="assertion-notes" className="space-y-1 text-sm leading-relaxed">
      <p data-slot="lab-confirmation" className="font-medium text-ink">
        {LAB_CONFIRMATION_LINE}
      </p>
      {reviewed.some((item) => item.penetranceClass === "unestablished") ? (
        <p data-slot="penetrance" className="text-ink">
          {PENETRANCE_NOT_ESTABLISHED}
        </p>
      ) : null}
      {releases.map((item) => (
        <p key={`${item.releaseId}:${item.geneValidityReadOn}`} data-slot="assertion-source" className="text-ink-muted">
          {assertionSourceLine(item.releaseId, item.geneValidityReadOn)}
        </p>
      ))}
    </div>
  );
}
