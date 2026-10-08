/**
 * <Breadcrumbs> — "{Domain} / {Subject}", "{Domain} / {Subject} / {Section}"
 * or "{Domain} / {Subject} / {Section} / {Item}" (brief §2 §1.4). The
 * subject crumb is always the full display name, never an initial. The last
 * crumb is text with aria-current="page". Server component.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  /** Omit on the current page (the last crumb) and on crumbs that are not links. */
  href?: string;
}

export interface BreadcrumbsProps {
  items: Crumb[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const last = items.length - 1;
  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumbs" className={cn("text-sm", className)}>
      <ol className="flex flex-wrap items-center text-ink-muted">
        {items.map((item, index) => {
          const current = index === last;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center">
              {current ? (
                <span aria-current="page" className="font-medium text-ink">
                  {item.label}
                </span>
              ) : item.href ? (
                // A crumb is a link on its own line, never inside a sentence,
                // so SC 2.5.8's Inline exception does not reach it and the
                // 44px control scale does, in both dimensions: the measured
                // smallest crumb was 30×20. inline-flex keeps the crumb
                // hugging its label so the " / " separators stay beside it.
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 underline-offset-[0.2em] transition-colors hover:text-ink hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span>{item.label}</span>
              )}
              {current ? null : (
                // The separator is its own box with 8px either side: inside a
                // flex row the spaces in " / " are trimmed, so the margin, not
                // the whitespace, sets the rhythm (round-1 M6). The text node
                // keeps the spaces for the accessible string "A / B / C".
                <span aria-hidden="true" className="mx-2 text-ink-muted">{" / "}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
