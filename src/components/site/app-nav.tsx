"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/uploads", label: "My files" },
  { href: "/reports", label: "Reports" },
  { href: "/browse", label: "Browse genome" },
  { href: "/ancestry", label: "Ancestry" },
  { href: "/chat", label: "Copilot" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Signed-in navigation with current-page indication: `aria-current="page"`
 * plus a visible active style on the item matching the route (nested routes
 * count, e.g. /reports/brca marks "Reports").
 *
 * - `sidebar`: vertical pill list for the md+ side rail.
 * - `mobile`: wrapping row below md — wraps instead of scrolling
 *   horizontally so every destination stays visible at narrow widths.
 */
export function AppNav({ variant }: { variant: "sidebar" | "mobile" }) {
  const pathname = usePathname();

  if (variant === "sidebar") {
    return (
      <nav aria-label="App" className="flex flex-col gap-1">
        {nav.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-tint font-medium text-ink"
                  : "text-ink-muted hover:bg-tint hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="App (mobile)"
      className="flex flex-wrap gap-x-3 gap-y-1 md:hidden"
    >
      {nav.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap text-sm",
              active
                ? "text-ink underline decoration-forest decoration-2 underline-offset-4"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
