/**
 * <CohortCard> — one cohort on the landing (design §2.1). Server component.
 *
 * The card carries a date for a label (the cohort has no name and never a
 * laboratory's), one chip per embryo in ordinal order with one status word
 * from the closed table, the analysis line while a grant is missing, one
 * link to the comparison and the retention line. No colour, no count that
 * ranks, no laboratory label, no sex.
 */
import Link from "next/link";
import { EmbryoChip } from "@/components/embryo/embryo-chip";
import { CarrierLibraryCoverage } from "@/components/embryo/carrier-library-coverage";
import { formatDate } from "@/components/embryo/format";
import {
  COMPARE_THESE_LINK,
  EMBRYO_STATUS,
  FILES_NOT_ADDED_SENTENCE,
  RETENTION_DONATED_OR_DISCARDED,
  RETENTION_SENTENCE,
  RETENTION_TRANSFERRED,
  waitingRole,
  STILL_CHECKING_STATUS,
  cohortLabel,
  waitingForResultsStatus,
} from "@/copy/embryos/index";
import { analysisConsent } from "@/lib/embryos/access";
import type { EmbryoCohortView } from "@/lib/embryos/cohorts";
import type { CarrierLibraryCoverageRow } from "@/lib/embryos/carrier-library-read";
import { allowedConditions } from "@/lib/embryos/allowed-conditions";
import { CARRIER_LIBRARY_READ_FAILED } from "@/copy/embryos/carrier-library";
import { route } from "@/lib/primary-routes";

export interface CohortCardProps {
  cohort: EmbryoCohortView;
  /** The register's copy when this cohort's contributors refuse the capability; null when permitted. */
  jurisdictionCopy: string | null;
  coverage?: readonly CarrierLibraryCoverageRow[] | null;
  coverageReadFailed?: boolean;
}

/** The role word the analysis line names; nobody is named. */
export function analysisRole(cohort: EmbryoCohortView): string | null {
  return waitingRole(analysisConsent(cohort));
}

export function CohortCard({ cohort, jurisdictionCopy, coverage = null, coverageReadFailed = false }: CohortCardProps) {
  const role = analysisRole(cohort);
  const dispositions = new Set(cohort.embryos.map((embryo) => embryo.status));
  const conditionNames = new Map(allowedConditions().map(entry => [entry.condition_id, entry.condition_name]));
  return (
    <li
      data-slot="cohort-card"
      data-card="true"
      data-cohort-id={cohort.id}
      data-cohort-status={cohort.status}
      className="surface surface-pad-sm space-y-4"
    >
      <p data-slot="cohort-label" className="title text-ink">
        {cohortLabel(formatDate(cohort.createdAt))}
      </p>
      {jurisdictionCopy ? (
        <p role="status" data-slot="cohort-jurisdiction" className="text-sm leading-relaxed text-ink">
          {jurisdictionCopy}
        </p>
      ) : null}
      {cohort.status === "ingesting" ? (
        <p role="status" data-slot="cohort-state" className="text-sm leading-relaxed text-ink">
          {STILL_CHECKING_STATUS}
        </p>
      ) : cohort.status === "upload_pending" ? (
        <p role="status" data-slot="cohort-state" className="text-sm leading-relaxed text-ink">
          {FILES_NOT_ADDED_SENTENCE}
        </p>
      ) : null}
      <ul data-slot="embryo-list" className="fam-rows border-t border-line">
        {cohort.embryos.map((embryo) => (
          <li key={embryo.id} className="flex min-h-12 flex-wrap items-center gap-3 py-1">
            <EmbryoChip
              embryo={{ id: embryo.id, displayLabel: embryo.displayLabel }}
              href={route("embryos.detail", { embryoId: embryo.id })}
            />
            <span data-slot="embryo-state" className="ml-auto shrink-0 text-sm text-ink-muted">
              {EMBRYO_STATUS[embryo.status]}
            </span>
            {coverage ? <div className="w-full py-2">
              <CarrierLibraryCoverage rows={coverage.filter(row => row.embryoId === embryo.id)}
                subjectId={embryo.subjectId}
                conditionNames={conditionNames} />
            </div> : null}
          </li>
        ))}
      </ul>
      {coverageReadFailed ? <p data-slot="carrier-library-read-failed" role="status" className="text-sm text-ink">
        {CARRIER_LIBRARY_READ_FAILED}
      </p> : null}
      {role ? (
        <p role="status" data-slot="analysis-state" className="text-sm leading-relaxed text-ink">
          {waitingForResultsStatus(role)}
        </p>
      ) : null}
      <p className="text-sm">
        <Link
          href={route("embryos.compare", { query: { cohort: cohort.id } })}
          data-slot="compare-link"
          className="link-target quiet-link"
        >
          {COMPARE_THESE_LINK}
        </Link>
      </p>
      <p data-slot="retention-line" className="caption max-w-measure">
        {RETENTION_SENTENCE}
      </p>
      {dispositions.has("donated") || dispositions.has("discarded") ? (
        <p data-slot="retention-disposition" className="caption max-w-measure">
          {RETENTION_DONATED_OR_DISCARDED}
        </p>
      ) : null}
      {dispositions.has("transferred") ? (
        <p data-slot="retention-disposition" className="caption max-w-measure">
          {RETENTION_TRANSFERRED}
        </p>
      ) : null}
    </li>
  );
}
