/**
 * <ReportSkeleton> — the six fixed h2s of a report page in order, with
 * fixed ids (brief X13.1). Server component; the renderer named in
 * docs/canonical-artifacts.md for src/copy/reports/headings.ts.
 *
 * The caller supplies one slot per heading. The "Your result" slot is the
 * caller's <ClaimBlock> (or the gate that withholds it); the not-diagnostic
 * line renders at the end of that section on every report, gated or not.
 *
 * Density (docs/density-baseline.json measurementSelectors): each of the six
 * <section>s is a top-level section (data-density-top-level-section) and the
 * container keeps the baseline's adjacent-section gap (64px below 768px, 80px
 * to 1023px, 96px from 1024px: adjacentTopLevelSectionGapPx); the
 * not-diagnostic line is a required-accuracy statement
 * (data-density-required-accuracy). The primary-claim and primary-content
 * markers are the caller's: the first <ClaimBlock> and the <article>.
 * Nothing here collapses; the only <details> a report page may render are
 * the caller's citations beyond the first three and the technical notes.
 */
import type { ReactNode } from "react";
import {
  REPORT_HEADINGS,
  REPORT_HEADING_IDS,
  headingText,
  type ReportHeading,
  type ReportSurfaceVariant,
} from "@/copy/reports/headings";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";

export interface ReportSkeletonProps {
  variant?: ReportSurfaceVariant;
  whatThisIs: ReactNode;
  yourResult: ReactNode;
  whatThisDoesntMean: ReactNode;
  howSureWeAre: ReactNode;
  whatYouCanDo: ReactNode;
  whereThisComesFrom: ReactNode;
}

const SLOT_KEYS: Record<ReportHeading, keyof Omit<ReportSkeletonProps, "variant">> = {
  "What this is": "whatThisIs",
  "Your result": "yourResult",
  "What this doesn’t mean": "whatThisDoesntMean",
  "How sure we are": "howSureWeAre",
  "What you can do": "whatYouCanDo",
  "Where this comes from": "whereThisComesFrom",
};

const YOUR_RESULT: ReportHeading = "Your result";

function Section({
  heading,
  variant,
  children,
}: {
  heading: ReportHeading;
  variant: ReportSurfaceVariant;
  children: ReactNode;
}) {
  const id = REPORT_HEADING_IDS[heading];
  return (
    <section
      aria-labelledby={id}
      data-report-section={id}
      data-density-top-level-section="true"
      className="space-y-3"
    >
      <h2 id={id} className="text-lg font-semibold text-ink">
        {headingText(heading, variant)}
      </h2>
      {children}
    </section>
  );
}

export function ReportSkeleton({ variant = "adult", ...slots }: ReportSkeletonProps) {
  return (
    <div data-slot="report-skeleton" className="space-y-16 md:space-y-20 lg:space-y-24">
      {REPORT_HEADINGS.map((heading) => (
        <Section key={heading} heading={heading} variant={variant}>
          {slots[SLOT_KEYS[heading]]}
          {heading === YOUR_RESULT ? (
            <p
              data-testid="report-disclaimer"
              data-not-diagnostic="true"
              data-density-required-accuracy="true"
              className="text-sm leading-relaxed text-ink"
            >
              {NOT_DIAGNOSTIC}
            </p>
          ) : null}
        </Section>
      ))}
    </div>
  );
}
