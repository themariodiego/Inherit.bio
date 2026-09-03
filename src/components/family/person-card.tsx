/**
 * <PersonCard> — one adult in the Family list (brief §2 §5.1): a 24px disc
 * with their initial, their name, the kind chip and exactly one state line.
 * Server component.
 *
 * Colour never carries identity alone (X2.4): the initial and the name are
 * text. The state line is the only thing the card says about them, and
 * "Reports ready" is shown only when a report layer is live, so a card
 * reveals nothing about another adult's files before they share.
 *
 * Nobody is ranked, scored or ordered by anything but their name.
 */
import Link from "next/link";
import { subjectKind } from "@/components/subjects/subject-bar";
import {
  CARD_NO_FILE_STATUS,
  CARD_PAUSED_STATUS,
  CARD_READY_STATUS,
  waitingToShareStatus,
} from "@/copy/family/index";
import { KIND_CHIPS } from "@/copy/reports/strings";
import type { FamilyPerson } from "@/lib/family/graph";
import { subjectColourIndex, subjectInitial } from "@/lib/subject-colour";

/** Literal class names so Tailwind can see every token. */
const DISC_CLASSES = [
  "bg-subject-0",
  "bg-subject-1",
  "bg-subject-2",
  "bg-subject-3",
  "bg-subject-4",
  "bg-subject-5",
  "bg-subject-6",
  "bg-subject-7",
] as const;

export type PersonCardState = "ready" | "no-file" | "paused" | "waiting";

export function personCardLine(state: PersonCardState, name: string): string {
  switch (state) {
    case "ready":
      return CARD_READY_STATUS;
    case "no-file":
      return CARD_NO_FILE_STATUS;
    case "paused":
      return CARD_PAUSED_STATUS;
    case "waiting":
      return waitingToShareStatus(name);
  }
}

export function PersonCard({
  person,
  state,
  href,
  viewerAccountId,
}: {
  person: FamilyPerson;
  state: PersonCardState;
  href: string;
  viewerAccountId: string;
}) {
  const kind = subjectKind(person.handle, viewerAccountId);
  const colour = subjectColourIndex(person.handle);
  return (
    <li data-slot="person-card" data-subject-id={person.handle.id}>
      <Link
        href={href}
        className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 text-base hover:border-forest"
      >
        <span
          aria-hidden="true"
          data-slot="subject-disc"
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold leading-none text-paper ${DISC_CLASSES[colour]}`}
        >
          {subjectInitial(person.displayLabel)}
        </span>
        <span data-slot="subject-name" className="truncate font-medium text-ink">
          {person.displayLabel}
        </span>
        {kind ? (
          <span
            data-slot="subject-kind"
            className="shrink-0 rounded-full border border-line px-2 py-0.5 text-sm text-ink-muted"
          >
            {KIND_CHIPS[kind]}
          </span>
        ) : null}
        <span data-slot="person-state" className="ml-auto shrink-0 text-sm text-ink-muted">
          {personCardLine(state, person.displayLabel)}
        </span>
      </Link>
    </li>
  );
}
