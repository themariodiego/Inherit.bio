"use client";

import { CircleDot, Dna, LayoutDashboard, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  NAV_ITEMS,
  NAV_LANDMARK_LABEL,
  type NavItemId,
} from "@/copy/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<NavItemId, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  "my-genome": Dna,
  family: Users,
  embryos: CircleDot,
  settings: Settings,
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Signed-in navigation — exactly the five items of src/copy/navigation.ts,
 * with current-page indication: `aria-current="page"` plus the tint ground
 * and label weight on the item matching the route (nested routes count,
 * e.g. /genome/me/reports marks "My Genome").
 *
 * - `sidebar`: vertical pill list for the md+ side rail (≥ 16px text,
 *   ≥ 12px gaps). `leading` renders inside the landmark before the list
 *   (the wordmark), so the whole rail is one navigation landmark.
 * - `mobile`: fixed 64px bottom bar below md — five icon-plus-label items,
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

  if (variant === "sidebar") {
    return (
      <nav aria-label={NAV_LANDMARK_LABEL} className="space-y-8">
        {leading ? <div>{leading}</div> : null}
        <div className="flex flex-col gap-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-2 text-base transition-colors",
                  active
                    ? "bg-tint font-medium text-ink"
                    : "text-ink-muted hover:bg-tint hover:text-ink",
                )}
              >
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
      <nav aria-label={NAV_LANDMARK_LABEL} className="grid h-16 grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.id];
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1 px-1 text-center text-sm leading-tight transition-colors",
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
