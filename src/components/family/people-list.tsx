/**
 * <PeopleList> — the Family hub's list of adults (design §2.1). Server
 * component. One card each, in the graph's order (name alone), with no
 * count, no total and no comparison between them.
 */
import { PersonCard, type PersonCardState } from "@/components/family/person-card";
import { PEOPLE_LIST_LABEL } from "@/copy/family/index";
import type { FamilyPerson } from "@/lib/family/graph";

export interface PersonListEntry {
  person: FamilyPerson;
  state: PersonCardState;
  href: string;
}

export function PeopleList({
  entries,
  viewerAccountId,
}: {
  entries: readonly PersonListEntry[];
  viewerAccountId: string;
}) {
  return (
    <ul aria-label={PEOPLE_LIST_LABEL} data-slot="people-list" className="space-y-2">
      {entries.map(({ person, state, href }) => (
        <PersonCard
          key={person.handle.id}
          person={person}
          state={state}
          href={href}
          viewerAccountId={viewerAccountId}
        />
      ))}
    </ul>
  );
}
