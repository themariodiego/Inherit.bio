"use client";

import { CircleDot, Dna, LayoutDashboard, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import {
  NAV_ITEMS,
  NAV_LANDMARK_LABEL,
  type NavItemId,
} from "@/copy/navigation";
import { route } from "@/lib/primary-routes";
import { cn } from "@/lib/utils";

const ICONS: Record<NavItemId, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  "my-genome": Dna,
  family: Users,
  embryos: CircleDot,
  settings: Settings,
};

// Routes that belong to an item without living under its href: a person's
// own files and copilot are their genome's, so "My Genome" stays current
// there and the page is never without a "where am I" (round-1 M8).
const ALSO_UNDER: Partial<Record<NavItemId, readonly string[]>> = {
  "my-genome": [route("files.index"), route("copilot.scope", { scope: "me" })],
};

function isActive(pathname: string, item: { id: NavItemId; href: string }) {
  return [item.href, ...(ALSO_UNDER[item.id] ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

/**
 * Signed-in navigation — exactly the five items of src/copy/navigation.ts,
 * with current-page indication: `aria-current="page"` plus the tint ground
 * and label weight on the item matching the route (nested routes count,
 * e.g. /genome/me/reports marks "My Genome").
 *
 * - `sidebar`: vertical list for the md+ side rail (16px text, 44px rows,
 *   12px gaps). The current row keeps the tint ground and a 2px marker; an
 *   inset highlight sets out from it to the hovered or focused row and
 *   returns home when the pointer leaves, so the current page never loses
 *   its signifier while another row is hovered. `leading` renders inside the landmark before
 *   the list (the wordmark), so the whole rail is one navigation landmark.
 * - `mobile`: fixed 64px bottom bar below md — five icon-plus-label cells,
 *   each ≥ 44px tall, labels always visible (≥ 13px). No hamburger, never
 *   icon-only. Hidden by CSS at md+, so only one "App" landmark is ever
 *   rendered at a given width.
 */
export function AppNav({
  variant,
  leading,
}: {
  variant: "sidebar" | "mobile";
  leading?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const currentIndex = NAV_ITEMS.findIndex((item) => isActive(pathname, item));
  const highlightIndex = highlighted ?? currentIndex;
  const listRef = useRef<HTMLDivElement>(null);
  const glideRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const glide = glideRef.current;
    if (!list || !glide) return;
    const items = list.querySelectorAll<HTMLElement>("[data-nav-item]");
    const update = () => {
      const item = items[highlightIndex];
      if (!item) return;
      glide.style.height = `${item.offsetHeight}px`;
      glide.style.transform = `translateY(${item.offsetTop}px)`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [highlightIndex]);

  if (variant === "sidebar") {
    return (
      <nav aria-label={NAV_LANDMARK_LABEL} className="space-y-8">
        {leading ? <div>{leading}</div> : null}
        <div
          ref={listRef}
          className="relative isolate flex flex-col gap-3"
          onPointerLeave={() => setHighlighted(null)}
        >
          {highlightIndex >= 0 ? (
            <span
              ref={glideRef}
              aria-hidden="true"
              data-slot="nav-glide"
              className={cn(
                "pointer-events-none absolute inset-x-0 -z-10 h-11 rounded-sm bg-surface-inset transition-[transform,opacity] duration-200 ease-settle motion-reduce:transition-none",
                highlighted === null ? "opacity-0" : "opacity-100",
              )}
              // The server cannot measure rows, so the first position comes
              // from the row rhythm (44px rows, 12px gaps): the highlight
              // rests, invisible, on the current item at first paint and
              // never slides in on load. The layout effect then corrects for
              // wrapped labels and moves it on hover, focus and route change.
              style={{ transform: `translateY(${highlightIndex * 56}px)` }}
            />
          ) : null}
          {NAV_ITEMS.map((item, index) => {
            const active = isActive(pathname, item);
            const Icon = ICONS[item.id];
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-nav-item
                onPointerEnter={() => setHighlighted(index)}
                onFocus={() => setHighlighted(index)}
                onBlur={() => setHighlighted(null)}
                className={cn(
                  "app-nav-link min-h-11 rounded-sm px-3 py-2 text-base transition-colors",
                  active
                    ? "bg-tint font-medium text-ink"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <nav
        aria-label={NAV_LANDMARK_LABEL}
        // Five cells 8px apart (the separation rule), 13px labels so the
        // longest fits one line at 390 and the cell's 56px holds a wrapped
        // label at 320 without touching the icon.
        className="grid h-navbar grid-cols-5 gap-2 px-0.5 py-1"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.id];
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-full min-h-11 flex-col items-center justify-center gap-0.5 rounded-sm px-0 text-center text-[13px] leading-[1.2] tracking-[-0.02em] transition-colors",
                active
                  ? "bg-tint font-medium text-ink"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
