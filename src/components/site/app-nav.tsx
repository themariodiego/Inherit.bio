"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/overview", label: "Overview" },
  { href: "/genome/me", label: "My Genome" },
  { href: "/family", label: "Family" },
  { href: "/embryos", label: "Embryos" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Signed-in navigation with current-page indication: `aria-current="page"`
 * plus a visible active style on the item matching the route (nested routes
 * count, e.g. /genome/me/reports marks "My Genome").
 *
 * - `sidebar`: vertical pill list for the md+ side rail.
 * - `mobile`: wrapping row below md — wraps instead of scrolling
 *   horizontally so every destination stays visible at narrow widths.
 */
export function AppNav({ variant }: { variant: "sidebar" | "mobile" }) {
  const pathname = usePathname();

  if (variant === "sidebar") {
    return (
      <nav aria-label="App" className="flex flex-col gap-3">
        {nav.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-2 text-base transition-colors",
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
      className="flex flex-wrap gap-x-4 gap-y-3 md:hidden"
    >
      {nav.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap text-base",
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
