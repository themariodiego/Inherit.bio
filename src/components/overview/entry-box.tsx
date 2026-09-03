import Link from "next/link";

// One Overview entry box (docs/route-register.json →
// navigationContract.overviewBoxContract): the whole box is ONE link whose
// accessible name is exactly the label (aria-labelledby → the label span) and
// whose description is exposed as its description only. Boxes are not
// headings; the label renders in the `title` type role (Inter 600 18px).

export interface EntryBox {
  id: string;
  label: string;
  description: string;
  href: string;
}

export function EntryBoxGrid({ boxes }: { boxes: readonly EntryBox[] }) {
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {boxes.map((box) => {
        const labelId = `${box.id}-label`;
        const descriptionId = `${box.id}-description`;
        return (
          <li key={box.id} data-overview-box>
            <Link
              href={box.href}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              className="block min-h-11 rounded-2xl border border-line bg-card p-5 transition-colors hover:border-forest focus-visible:border-forest focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span id={labelId} className="block text-lg font-semibold text-ink">
                {box.label}
              </span>
              <span
                id={descriptionId}
                className="mt-1 block text-sm leading-relaxed text-ink-muted"
              >
                {box.description}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
