import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

// One Overview entry box (docs/route-register.json →
// navigationContract.overviewBoxContract): the whole box is ONE link whose
// accessible name is exactly the label (aria-labelledby → the label span) and
// whose description is exposed as its description only. Boxes are not
// headings; the label renders in the `title` type role (Inter 600 18px).
// The box is a linked surface: card ground, a hairline, the large radius;
// the outline wakes and the arrow moves on hover (globals `.link-surface`).

export interface EntryBox {
  id: string;
  label: string;
  description: string;
  href: string;
}

export function EntryBoxGrid({ boxes }: { boxes: readonly EntryBox[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {boxes.map((box) => {
        const labelId = `${box.id}-label`;
        const descriptionId = `${box.id}-description`;
        return (
          <li key={box.id} data-overview-box>
            <Link
              href={box.href}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              className="surface link-surface block h-full min-h-11 p-5 text-ink sm:p-6"
            >
              <span id={labelId} className="title flex items-start justify-between gap-4">
                {box.label}
                <ArrowUpRight aria-hidden="true" className="link-arrow mt-1 size-4 shrink-0 text-forest" />
              </span>
              <span id={descriptionId} className="mt-2 block text-sm text-ink-muted">
                {box.description}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
