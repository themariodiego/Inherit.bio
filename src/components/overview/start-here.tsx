import Link from "next/link";
import { Button } from "@/components/ui/button";
import { START_HERE, startHereItems } from "@/copy/overview";

// State A action strip (brief §2 §3, X9.1): a labelled plate, not a heading
// (the page's heading cap is four), with the first item as the page's single
// primary button and the others as quiet links in ruled rows. Every target
// is ≥ 44px tall.

export function StartHere() {
  const items = startHereItems();
  return (
    <section
      aria-labelledby="start-here-title"
      data-density-top-level-section
      className="plate"
    >
      <div className="plate-head">
        <p id="start-here-title" className="eyebrow">
          {START_HERE.heading}
        </p>
      </div>
      <div className="plate-body">
        <ul className="divide-y divide-line">
          {items.map((item, index) => (
            <li key={item.id} className="max-w-measure py-5 first:pt-0 last:pb-0">
              {index === 0 ? (
                <Button asChild size="lg">
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ) : (
                <Link
                  href={item.href}
                  className="quiet-link inline-flex min-h-11 items-center text-base font-medium"
                >
                  {item.label}
                </Link>
              )}
              <p className="mt-2 text-sm text-ink-muted">{item.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
