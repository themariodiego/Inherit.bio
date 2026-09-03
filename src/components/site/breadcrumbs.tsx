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
                <span aria-current="page" className="text-ink">
                  {item.label}
                </span>
              ) : item.href ? (
                <Link href={item.href} className="underline-offset-2 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span>{item.label}</span>
              )}
              {current ? null : <span aria-hidden="true">{" / "}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
