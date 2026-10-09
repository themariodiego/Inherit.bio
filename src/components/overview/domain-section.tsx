import { EntryBoxGrid, type EntryBox, type EntryBoxVariant } from "./entry-box";

// One of the three domain sections: an h2 (identical to the nav label),
// ≥ 80 characters of non-heading content (the lede or the state lines) at
// the 68ch measure, then exactly three entry boxes one block-rhythm below.
// A Fraunces ordinal ("01") sits beside the h2, outside it, so the heading
// text stays the nav label and the three sections read as a field guide's
// table of contents.

export function DomainSection({
  id,
  index,
  heading,
  boxes,
  variant,
  children,
}: {
  id: string;
  /** Zero-based position among the sections; rendered as "01", "02", "03". */
  index: number;
  heading: string;
  boxes: readonly EntryBox[];
  variant?: EntryBoxVariant;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-density-top-level-section
    >
      <div className="domain-head">
        <span aria-hidden="true" className="ordinal">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h2 id={headingId} className="display">
          {heading}
        </h2>
      </div>
      <div className="stack-blocks mt-4">
        <div className="max-w-measure space-y-3">{children}</div>
        <EntryBoxGrid boxes={boxes} variant={variant} />
      </div>
    </section>
  );
}
