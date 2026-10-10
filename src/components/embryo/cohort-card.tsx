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
import { route } from "@/lib/primary-routes";
import type { StatisticalCoverageRead } from "@/lib/embryos/statistical-read";
import { StatisticalCoverage } from "./statistical-coverage";

export interface CohortCardProps {
  cohort: EmbryoCohortView;
  /** The register's copy when this cohort's contributors refuse the capability; null when permitted. */
  jurisdictionCopy: string | null;
  statisticalCoverage?: StatisticalCoverageRead | null;
}

/** The role word the analysis line names; nobody is named. */
export function analysisRole(cohort: EmbryoCohortView): string | null {
  return waitingRole(analysisConsent(cohort));
}

export function CohortCard({ cohort, jurisdictionCopy, statisticalCoverage }: CohortCardProps) {
  const role = analysisRole(cohort);
  const dispositions = new Set(cohort.embryos.map((embryo) => embryo.status));
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
          </li>
        ))}
      </ul>
      {role ? (
        <p role="status" data-slot="analysis-state" className="text-sm leading-relaxed text-ink">
          {waitingForResultsStatus(role)}
        </p>
      ) : null}
      {statisticalCoverage ? <StatisticalCoverage value={statisticalCoverage}
        subjectIds={new Map(cohort.embryos.map(embryo => [embryo.id, embryo.subjectId]))} /> : null}
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
