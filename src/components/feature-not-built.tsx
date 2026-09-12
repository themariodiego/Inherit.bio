import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * A page whose feature has not been written yet.
 *
 * This exists because `<CapabilityUnavailable>` was standing in for it, and
 * the two are not interchangeable in the one way that matters to a reader.
 * That component says a legal review is missing and the feature is therefore
 * off — a true sentence on the four routes that render it behind a real
 * `CapabilityDecision`, and a false one on a route with no jurisdiction guard
 * at all. `/settings/people` rendered it unconditionally, so every visitor was
 * told the law had stopped something that had simply never been built.
 *
 * Blaming a jurisdiction for an unfinished feature is worse than saying
 * nothing: it invents a legal fact, it makes the jurisdiction machinery look
 * like it is doing work it is not doing here, and a reader who moved country
 * would keep waiting for a page that no move will ever unlock. So this frame
 * says the true thing instead, and says explicitly what is NOT the reason.
 */
export function FeatureNotBuilt({
  eyebrow,
  title,
  backHref,
  whatItWouldDo,
}: {
  eyebrow: string;
  title: string;
  backHref: string;
  /** One sentence naming what this page will show once it exists. */
  whatItWouldDo: string;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display text-3xl">{title}</h1>
      </header>
      <section
        role="status"
        data-slot="not-built"
        className="space-y-4 rounded-2xl border border-line bg-card p-6"
      >
        <h2 className="font-medium">Not built yet</h2>
        <p className="text-base leading-relaxed text-ink-muted">{whatItWouldDo}</p>
        <p className="text-base leading-relaxed text-ink-muted">
          Inherit has not written this page yet. No law and nothing about you is
          holding it back, and no record was made when you opened it.
        </p>
        <Button asChild variant="outline">
          <Link href={backHref}>Go back</Link>
        </Button>
      </section>
    </div>
  );
}
