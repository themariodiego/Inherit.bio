import { EntryBoxGrid, type EntryBox } from "./entry-box";

// One of the three domain sections: an h2 (identical to the nav label),
// ≥ 80 characters of non-heading content (the lede or the state lines) at
// the 68ch measure, then exactly three entry boxes one block-rhythm below.

export function DomainSection({
  id,
  heading,
  boxes,
  children,
}: {
  id: string;
  heading: string;
  boxes: readonly EntryBox[];
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-density-top-level-section
      className="scroll-mt-24"
    >
      <h2 id={headingId} className="display">
        {heading}
      </h2>
      <div className="stack-blocks mt-4">
        <div className="max-w-measure space-y-3">{children}</div>
        <EntryBoxGrid boxes={boxes} />
      </div>
    </section>
  );
}
