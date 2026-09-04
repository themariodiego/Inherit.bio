/**
 * <PortraitBlocking> — the `portrait-grant-denial-v1` screen (design §2.5;
 * register responseContracts.portrait-grant-denial-v1; brief line 352,
 * X3.6). Server component.
 *
 * Rendered whenever any precondition is unmet for either person, and never
 * beside a partial result: the heading names who still has a step, the body
 * is the register's copy, the list is server-derived — one line per missing
 * step, in the pair's own order — and the action routes to the consents
 * page. The acknowledgement card renders only while the viewer's own step
 * is the acknowledgement; the other person's steps are theirs alone.
 *
 * Nothing here reads a file, a genotype or a result.
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  BLOCKING_BODY,
  OPEN_CONSENTS_BUTTON,
  PORTRAIT_STEPS,
  VIEWER_NAME_IN_HEADING,
  VIEWER_PORTRAIT_STEPS,
  blockingHeading,
  missingStep,
  namesPhrase,
  viewerMissingStep,
  type PortraitStep,
} from "@/copy/family/portrait";
import type { MissingStep } from "@/lib/family/portrait";
import { AcknowledgeForm } from "./acknowledge-form";

export interface BlockingPerson {
  subjectId: string;
  displayLabel: string;
  /** True for the viewer's own subject: their steps read in the second person. */
  isViewer: boolean;
}

export interface PortraitBlockingProps {
  /** The two people in the pair's own order. */
  people: readonly [BlockingPerson, BlockingPerson];
  missing: readonly MissingStep[];
  consentsHref: string;
}

function stepLine(person: BlockingPerson, step: PortraitStep): string {
  if (person.isViewer && step !== "account") return viewerMissingStep(VIEWER_PORTRAIT_STEPS[step]);
  return missingStep(person.displayLabel, PORTRAIT_STEPS[step]);
}

export function PortraitBlocking({ people, missing, consentsHref }: PortraitBlockingProps) {
  const waitingOn = people.filter((person) =>
    missing.some((entry) => entry.subjectId === person.subjectId),
  );
  const names = namesPhrase(
    waitingOn.map((person) => (person.isViewer ? VIEWER_NAME_IN_HEADING : person.displayLabel)),
  );
  const viewer = people.find((person) => person.isViewer);
  const viewerMustAcknowledge =
    viewer !== undefined &&
    missing.some((entry) => entry.subjectId === viewer.subjectId && entry.step === "acknowledged");

  return (
    <section
      data-slot="portrait-blocking"
      data-state="consent-required"
      aria-labelledby="portrait-blocking-heading"
      className="space-y-5"
    >
      <h2 id="portrait-blocking-heading" className="text-lg font-semibold">
        {blockingHeading(names)}
      </h2>
      <p className="max-w-prose text-base leading-relaxed text-ink">{BLOCKING_BODY}</p>
      <ul data-slot="portrait-missing-steps" className="max-w-prose space-y-1">
        {people.flatMap((person) =>
          missing
            .filter((entry) => entry.subjectId === person.subjectId)
            .map((entry) => (
              <li
                key={`${person.subjectId}-${entry.step}`}
                data-slot="portrait-missing-step"
                data-subject-id={person.subjectId}
                data-step={entry.step}
                className="text-base leading-relaxed text-ink"
              >
                {stepLine(person, entry.step)}
              </li>
            )),
        )}
      </ul>
      {viewer && viewerMustAcknowledge ? (
        <AcknowledgeForm subjectId={viewer.subjectId} consentsHref={consentsHref} />
      ) : (
        <Button asChild variant="outline">
          <Link href={consentsHref}>{OPEN_CONSENTS_BUTTON}</Link>
        </Button>
      )}
    </section>
  );
}
