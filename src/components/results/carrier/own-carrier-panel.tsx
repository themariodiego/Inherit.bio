/**
 * <OwnCarrierPanel> — the body of `/genome/[subject]/carrier`. Server
 * component, plain data in.
 *
 * One state sentence, or one block per reviewed condition. A block is a
 * variant-call card under the brief's monogenic presentation law (§4, lines
 * 1329-1335): the penetrance label on every card; "This is not a negative
 * result." with the "checked at n of the N positions" count wherever the file
 * shows no reviewed change; and, on a finding, the reviewed variant line with
 * its classification, review status and date as text, the laboratory line and
 * the source line. Each person's reading is a `carrier-status` figure, the
 * count a `coverage` figure, both inside one claim block attributed to the
 * record.
 *
 * The page never says how many findings there are, never ranks conditions
 * and never turns a reading into a chance for a pregnancy. Where any block
 * renders, the panel ends once with what the check cannot tell you. The
 * "unavailable" sentence is not a result, so it never carries them.
 */
import Link from "next/link";
import { AssertionNotes } from "@/components/family/assertion-notes";
import { ClaimBlock } from "@/components/figures/claim-block";
import {
  CARRIER_LIBRARY_NOT_NEGATIVE,
  CARRIER_LIBRARY_REASONS,
  CARRIER_LIMITS_HEADING,
  CARRIER_STATUS_OFF_STATUS,
  CARRIER_STATUS_PREPARING_STATUS,
  CARRIER_STATUS_READER,
  CARRIER_STATUS_READER_NAME,
  CARRIER_STATUS_REPORTS_LINK,
  NO_CLASSIFIED_POSITIONS,
  NO_FILE_YET,
  OWN_CARRIER_LIMITS,
} from "@/copy/genome/carrier";
import {
  PENETRANCE_NOT_ESTABLISHED,
  assertionSourceLine,
  reviewedVariantLine,
} from "@/copy/family/carrier-evidence";
import type { OwnCarrierView } from "@/lib/family/own-carrier-read";
import { ownCarrierCoverage, type OwnCarrierCondition } from "@/lib/family/own-carrier-status";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";

const PROVENANCE = { kind: "computed", module: "family/own-carrier-status" } as const;

function figures(condition: OwnCarrierCondition): StandaloneFigureSpec[] {
  const coverage: StandaloneFigureSpec = {
    kind: "coverage", class: "quality", basis: "observed", provenance: PROVENANCE,
    read: condition.checkedPositions, needed: condition.requiredPositions,
    wording: "reviewed-condition", condition: condition.conditionName,
  };
  return condition.finding
    ? [{ kind: "carrier-status", class: "variant-call", basis: "observed", provenance: PROVENANCE,
      status: condition.finding.copies }, coverage]
    : [coverage];
}

function ConditionBlock({ condition, subjectId }: { condition: OwnCarrierCondition; subjectId: string }) {
  const coverage = ownCarrierCoverage(condition);
  const finding = condition.finding;
  return (
    <section
      data-slot="carrier-status-condition"
      data-condition-id={condition.conditionId}
      data-gene={condition.gene}
      data-coverage={coverage}
      data-carrier-reading={finding ? finding.copies : "none"}
      aria-labelledby={`carrier-status-${condition.gene}`}
      className="space-y-3"
    >
      <h2 id={`carrier-status-${condition.gene}`} className="title text-ink">{condition.conditionName}</h2>
      <ClaimBlock
        subject={{ subjectId }}
        figures={figures(condition)}
        className="plate fam-plate-claim"
        renderFigures={(nodes) => finding ? (
          <div className="space-y-2">
            <p data-slot="carrier-status-reading" className="flex flex-wrap items-baseline gap-2 text-base text-ink">
              <span>{CARRIER_STATUS_READER}</span>{" "}
              {nodes[0]}
            </p>
            <p data-slot="carrier-status-coverage" className="text-sm leading-relaxed text-ink">{nodes[1]}</p>
          </div>
        ) : (
          <p data-slot="carrier-status-coverage" className="text-sm leading-relaxed text-ink">
            <span data-slot="carrier-status-not-negative">{CARRIER_LIBRARY_NOT_NEGATIVE}</span> {nodes[0]}
          </p>
        )}
      >
        <div className="mt-3 space-y-2 text-sm leading-relaxed">
          {finding ? (
            <p data-slot="carrier-variant" className="text-ink">
              {reviewedVariantLine(CARRIER_STATUS_READER_NAME, finding.evidence, condition.gene, finding.classification)}
            </p>
          ) : null}
          {coverage !== "covered" ? (
            <p data-slot="carrier-status-not-read" className="text-ink">{CARRIER_LIBRARY_REASONS.not_covered}</p>
          ) : null}
          {finding ? (
            <AssertionNotes evidence={[finding.evidence]} />
          ) : (
            <div data-slot="assertion-notes" className="space-y-1">
              {condition.penetranceClass === "unestablished" ? (
                <p data-slot="penetrance" className="text-ink">{PENETRANCE_NOT_ESTABLISHED}</p>
              ) : null}
              <p data-slot="assertion-source" className="text-ink-muted">
                {assertionSourceLine(condition.releaseId, condition.geneValidityReadOn)}
              </p>
            </div>
          )}
        </div>
      </ClaimBlock>
    </section>
  );
}

export function OwnCarrierPanel({ view, subjectId, reportsHref }: {
  view: OwnCarrierView;
  /** The record the reading is attributed to. */
  subjectId: string;
  /** This subject's Reports page, where "Choose your reports" lives. */
  reportsHref: string;
}) {
  if (view.kind !== "result") {
    const state = view.kind === "unavailable" ? "unavailable" : view.kind === "no-file" ? "empty"
      : view.kind === "preparing" ? "processing" : "consent-required";
    const sentence = view.kind === "unavailable" ? NO_CLASSIFIED_POSITIONS : view.kind === "no-file" ? NO_FILE_YET
      : view.kind === "preparing" ? CARRIER_STATUS_PREPARING_STATUS : CARRIER_STATUS_OFF_STATUS;
    return (
      <div data-slot="carrier-status" data-state={state} className="max-w-measure space-y-3">
        <p role="status" data-slot="carrier-status-state" className="body-lg text-ink">{sentence}</p>
        {view.kind === "off" ? (
          <p><Link href={reportsHref} className="link-target prose-link">{CARRIER_STATUS_REPORTS_LINK}</Link></p>
        ) : null}
      </div>
    );
  }
  const partial = view.conditions.some((condition) => ownCarrierCoverage(condition) !== "covered");
  return (
    <div data-slot="carrier-status" data-state={partial ? "partial-coverage" : "complete"} className="space-y-6">
      {view.preparing ? (
        <p role="status" data-slot="carrier-status-preparing" className="max-w-measure text-base leading-relaxed text-ink">
          {CARRIER_STATUS_PREPARING_STATUS}
        </p>
      ) : null}
      {view.conditions.map((condition) => (
        <ConditionBlock key={condition.conditionId} condition={condition} subjectId={subjectId} />
      ))}
      <section data-slot="carrier-limits" aria-labelledby="carrier-status-limits" className="max-w-measure space-y-2 border-t border-line pt-4">
        <h2 id="carrier-status-limits" className="label text-ink">{CARRIER_LIMITS_HEADING}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-muted">
          {OWN_CARRIER_LIMITS.map((limit) => <li key={limit}>{limit}</li>)}
        </ul>
      </section>
    </div>
  );
}
