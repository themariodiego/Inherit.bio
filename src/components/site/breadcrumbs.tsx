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
            // The separator belongs to the crumb it introduces, so a wrap
            // carries the slash with its crumb and never leaves it dangling,
            // and every gap is the separator's own margins: the same at every
            // width whatever the labels' lengths (round-2 N3). The text node
            // keeps " / " for the accessible string "A / B / C".
            <li key={`${item.label}-${index}`} className="flex items-center">
              {index === 0 ? null : <span aria-hidden="true" className="mx-2 select-none">{" / "}</span>}
              {current ? (
                <span aria-current="page" className="font-medium text-ink">
                  {item.label}
                </span>
              ) : item.href ? (
                // A crumb is a link on its own line, never inside a sentence,
                // so SC 2.5.8's Inline exception does not reach it and the
                // 44px control scale does, in both dimensions. Symmetric
                // padding, not centring in a minimum width, keeps the gap to
                // the slash the same for "You" and for "My Genome"; the
                // minimum width only ever catches a two-letter crumb.
                <Link
                  href={item.href}
                  className="-mx-2.5 inline-flex min-h-11 min-w-11 items-center justify-center px-2.5 underline-offset-[0.2em] transition-colors hover:text-ink hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
