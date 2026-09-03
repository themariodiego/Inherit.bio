import { STATE_D } from "@/copy/overview";
import { initialOf } from "./format";

// State D (brief §2 §3.5): up to four people as a 24px identity disc with
// their initial, their name and a kind chip, then "+{n} more". Colour never
// carries identity alone — the initial and the name do. Nobody is ranked.

export interface PersonRow {
  id: string;
  name: string;
  kind: "shared" | "uploaded";
}

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

export function PeopleList({ people }: { people: readonly PersonRow[] }) {
  const shown = people.slice(0, PEOPLE_LIST_LIMIT);
  const more = people.length - shown.length;
  return (
    <>
      <ul className="space-y-2">
        {shown.map((person, index) => (
          <li key={person.id} className="flex items-center gap-3 text-base">
            <span
              aria-hidden="true"
              className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-paper ${DISC_CLASSES[index % DISC_CLASSES.length]}`}
            >
              {initialOf(person.name)}
            </span>
            <span className="text-ink">{person.name}</span>
            <span className="rounded-full bg-tint px-2 py-0.5 text-xs text-ink">
              {person.kind === "shared"
                ? STATE_D.sharedWithYou
                : STATE_D.uploadedWithPermission}
            </span>
          </li>
        ))}
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
