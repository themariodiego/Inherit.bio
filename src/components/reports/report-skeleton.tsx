/**
 * <ReportSkeleton> — the six fixed h2s of a report page in order, with
 * fixed ids (brief X13.1). Server component; the renderer named in
 * docs/canonical-artifacts.md for src/copy/reports/headings.ts.
 *
 * The caller supplies one slot per heading. The "Your result" slot is the
 * caller's <ClaimBlock> (or the gate that withholds it); the not-diagnostic
 * line renders at the end of that section on every report, gated or not.
 *
 * Density (docs/density-baseline.json measurementSelectors): headings 1–3
 * and the not-diagnostic line sit in the primary claim block
 * (data-density-primary-claim); headings 4–6 in the primary content block
 * (data-density-primary-content). Nothing here collapses; the only
 * <details> a report page may render are the caller's citations beyond the
 * first three and the strand-flip technical note.
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
    <section aria-labelledby={id} data-report-section={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {headingText(heading, variant)}
      </h2>
      {children}
    </section>
  );
}

export function ReportSkeleton({ variant = "adult", ...slots }: ReportSkeletonProps) {
  const [whatThisIs, yourResult, whatThisDoesntMean, ...rest] = REPORT_HEADINGS;
  return (
    <div data-slot="report-skeleton" className="space-y-10">
      <div data-density-primary-claim="true" className="space-y-10">
        <Section heading={whatThisIs} variant={variant}>
          {slots[SLOT_KEYS[whatThisIs]]}
        </Section>
        <Section heading={yourResult} variant={variant}>
          {slots[SLOT_KEYS[yourResult]]}
          <p
            data-testid="report-disclaimer"
            data-not-diagnostic="true"
            className="text-sm leading-relaxed text-ink"
          >
            {NOT_DIAGNOSTIC}
          </p>
        </Section>
        <Section heading={whatThisDoesntMean} variant={variant}>
          {slots[SLOT_KEYS[whatThisDoesntMean]]}
        </Section>
      </div>
      <div data-density-primary-content="true" className="space-y-10">
        {rest.map((heading) => (
          <Section key={heading} heading={heading} variant={variant}>
            {slots[SLOT_KEYS[heading]]}
          </Section>
        ))}
      </div>
    </div>
  );
}
