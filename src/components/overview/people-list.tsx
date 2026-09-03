import {
  subjectKind,
  type SubjectBarSubject,
} from "@/components/subjects/subject-bar";
import { STATE_D } from "@/copy/overview";
import { KIND_CHIPS } from "@/copy/reports/strings";
import { subjectColourIndex } from "@/lib/subject-colour";
import { initialOf } from "./format";

// State D (brief §2 §3.5): up to four people as a 24px identity disc with
// their initial, their name and a kind chip, then "+{n} more". The chip and
// the disc colour are derived exactly as the subject bar derives them
// (subjectKind, subjectColourIndex), so a person looks the same here as on
// their own pages. Colour never carries identity alone — the initial and the
// name do. Nobody is ranked.

/** The subject fields a row needs: the same ones the subject bar reads. */
export type PersonRow = SubjectBarSubject;

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

export const PEOPLE_LIST_LIMIT = 4;

export function PeopleList({
  people,
  viewerAccountId,
}: {
  people: readonly PersonRow[];
  /** The signed-in account; decides whether an adult record is the viewer's own. */
  viewerAccountId: string;
}) {
  const shown = people.slice(0, PEOPLE_LIST_LIMIT);
  const more = people.length - shown.length;
  return (
    <>
      <ul className="space-y-2">
        {shown.map((person) => {
          const kind = subjectKind(person, viewerAccountId);
          return (
            <li key={person.id} className="flex items-center gap-3 text-base">
              <span
                aria-hidden="true"
                className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-paper ${DISC_CLASSES[subjectColourIndex(person)]}`}
              >
                {initialOf(person.displayLabel)}
              </span>
              <span className="text-ink">{person.displayLabel}</span>
              {kind ? (
                <span className="rounded-full bg-tint px-2 py-0.5 text-xs text-ink">
                  {KIND_CHIPS[kind]}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <p className="text-base">
          <span data-metric-value className="font-medium text-ink">
            {STATE_D.more(more)}
          </span>{" "}
          <span data-metric-note className="text-ink-muted">
            {STATE_D.peopleNote}
          </span>
        </p>
      ) : null}
    </>
  );
}
