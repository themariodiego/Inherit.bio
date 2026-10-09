/**
 * <RefusalsList> — `#not-shown`, the designed refusals screen (design §2.5;
 * brief line 358, §4 §5.4 lines 1357-1368). Server component.
 *
 * One ruled row per refused item in the same visual language as the shown
 * cards, each with `data-refusal-id`, one line and one reason, and no
 * figure of any kind: the §4 numbers are citations for the science page,
 * not for these cards. Server-rendered, non-collapsed, at least eight items
 * (the copy registry carries eleven). One link follows the list; it routes
 * to the science page until `/science/limits` exists, because a dead link
 * is never shipped.
 */
import Link from "next/link";
import { NOT_SHOWN_ID, REFUSALS, REFUSALS_HEADING, REFUSALS_LINK } from "@/copy/family/portrait";

export function RefusalsList({ limitsHref }: { limitsHref: string }) {
  return (
    <section
      id={NOT_SHOWN_ID}
      data-slot="refusals"
      aria-labelledby="refusals-heading"
      className="space-y-4"
    >
      <h2 id="refusals-heading" className="title text-ink">
        {REFUSALS_HEADING}
      </h2>
      <ul className="surface fam-rows">
        {REFUSALS.map((refusal) => (
          <li
            key={refusal.refusalId}
            data-refusal-id={refusal.refusalId}
            data-slot="refusal-card"
            className="space-y-1 px-4 py-3 md:px-5"
          >
            <p className="font-medium text-ink">{refusal.line}</p>
            <p data-slot="refusal-reason" className="max-w-measure text-sm leading-relaxed text-ink">
              {refusal.reason}
            </p>
          </li>
        ))}
      </ul>
      <Link
        href={limitsHref}
        className="link-target quiet-link text-sm"
      >
        {REFUSALS_LINK}
      </Link>
    </section>
  );
}
