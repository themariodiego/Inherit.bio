import Link from "next/link";
import { Button } from "@/components/ui/button";
import { START_HERE, startHereItems } from "@/copy/overview";

// State A action strip (brief §2 §3, X9.1): a titled panel, not a heading
// (the page's heading cap is four), with the first item as the page's single
// primary button and the others as plain links. Every target is ≥ 44px tall.

export function StartHere() {
  const items = startHereItems();
  return (
    <section
      aria-labelledby="start-here-title"
      data-density-top-level-section
      className="rounded-2xl border border-line bg-card p-5 sm:p-6"
    >
      <p id="start-here-title" className="text-lg font-semibold">
        {START_HERE.heading}
      </p>
      <ul className="mt-4 space-y-4">
        {items.map((item, index) => (
          <li key={item.id} className="max-w-prose">
            {index === 0 ? (
              <Button asChild size="lg" className="min-h-11">
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ) : (
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center text-base font-medium text-ink underline decoration-forest decoration-2 underline-offset-4 hover:text-forest"
              >
                {item.label}
              </Link>
            )}
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {item.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
