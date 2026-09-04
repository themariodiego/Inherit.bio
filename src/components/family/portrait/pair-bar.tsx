/**
 * <PairBar> — the 44px identity bar of a joint surface (brief §2 §2.3, line
 * 211): both people's chips, in the pair's own order, so both viewers see
 * the same bar. Server component.
 *
 * Each chip is the side-by-side page's own (<SubjectChip>): a disc with the
 * initial, the name, and the kind chip relative to the viewer. No file count
 * renders here — a count is a fact about another adult's files, and the bar
 * also stands on the blocking screen, before any grant is live — and no
 * "Add a file" action, because nothing on this page takes a file.
 *
 * Attribution lives on claim blocks, never here: each chip carries
 * `data-subject-id` as a column header does, and the bar carries no pair.
 */
import { PAIR_BAR_LABEL } from "@/copy/family/portrait";
import { SubjectChip, type HealthPictureColumn } from "../health-picture-table";

export interface PairBarProps {
  people: readonly [HealthPictureColumn, HealthPictureColumn];
  viewerAccountId: string;
}

export function PairBar({ people, viewerAccountId }: PairBarProps) {
  return (
    <div
      data-slot="pair-bar"
      role="group"
      aria-label={PAIR_BAR_LABEL}
      className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-8 gap-y-2 border-b border-line py-2 text-sm"
    >
      {people.map((person) => (
        <span key={person.dataSubjectId} data-slot="pair-person" data-subject-id={person.dataSubjectId}>
          <SubjectChip column={person} viewerAccountId={viewerAccountId} />
        </span>
      ))}
    </div>
  );
}
